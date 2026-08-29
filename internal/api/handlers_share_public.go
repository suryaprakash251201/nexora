package api

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/events"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/sharing"
	"github.com/nexora/nexora/internal/storage"
	"github.com/nexora/nexora/internal/util"
)

// maxShareEntries caps how many folder entries the public info endpoint lists.
// Downloading the whole folder streams everything regardless of this cap.
const maxShareEntries = 500

// emitShareEvent publishes a share event with the share owner as UserID so
// webhook consumers can filter by the sharing user even on public routes.
func (s *Server) emitShareEvent(typ events.EventType, r *http.Request, sh sharing.Share, path string) {
	if s.Events == nil {
		return
	}
	s.Events.Emit(events.Event{
		Type:     typ,
		UserID:   sh.UserID,
		RootID:   sh.RootID,
		Path:     path,
		Metadata: map[string]string{"share_id": sh.ID},
	})
}

// shareEntry is a single file/folder row listed for a directory share.
type shareEntry struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	IsDir     bool   `json:"is_dir"`
	Extension string `json:"extension"`
	Mime      string `json:"mime"`
}

// handleSharePublicInfo returns non-sensitive metadata for a share page. It
// never reveals server filesystem paths or the containing root.
func (s *Server) handleSharePublicInfo(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	sh, err := s.Shares.GetByToken(token)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "This link is invalid or has been revoked", middleware.GetRequestID(r.Context()))
		return
	}
	// Report expiry/exhaustion without leaking details. We do this
	// with a direct expiry check on the share row (no Argon2id
	// verify) so password-protected shares don't pay the CPU cost on
	// every page load just to display a status badge. P2-6.
	status := "ok"
	if sh.ExpiresAt != nil {
		if exp := util.ParseTime(*sh.ExpiresAt); !exp.IsZero() && time.Now().After(exp) {
			status = "expired"
		}
	}
	if sh.MaxDownloads > 0 && sh.DownloadCount >= sh.MaxDownloads {
		status = "exhausted"
	}

	root, ok, err := s.StorageRoots.Get(sh.RootID)
	if err != nil || !ok || !root.Enabled {
		writeError(w, http.StatusNotFound, "not_found", "This link is no longer available", middleware.GetRequestID(r.Context()))
		return
	}
	provider := s.StorageRoots.ProviderFor(root)
	info, err := provider.Stat(sh.Path)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "This link is no longer available", middleware.GetRequestID(r.Context()))
		return
	}

	resp := map[string]any{
		"name":          storage.NameFromPath(sh.Path),
		"scope":         string(sh.Scope),
		"has_password":  sh.HasPassword,
		"status":        status,
		"extension":     storage.Ext(sh.Path),
		"mime":          storage.MimeFor(storage.NameFromPath(sh.Path), info.IsDir),
		"size":          info.Size,
		"max_downloads": sh.MaxDownloads,
		"downloads":     sh.DownloadCount,
		"expires_at":    sh.ExpiresAt,
		"is_dir":        info.IsDir,
	}

	if info.IsDir {
		entries, _ := provider.List(sh.Path)
		list := make([]shareEntry, 0, len(entries))
		for _, e := range entries {
			if storage.IsSystemPath(e.Path) {
				continue
			}
			if len(list) >= maxShareEntries {
				break
			}
			list = append(list, shareEntry{
				Name:      e.Name,
				Path:      e.Path,
				Size:      e.Size,
				IsDir:     e.IsDir,
				Extension: storage.Ext(e.Name),
				Mime:      storage.MimeFor(e.Name, e.IsDir),
			})
		}
		if list == nil {
			list = make([]shareEntry, 0)
		}
		resp["entries"] = list
		resp["total_entries"] = len(entries)
	}

	writeJSON(w, http.StatusOK, resp)
}

// handleSharePublicVerify checks a password without transferring the file.
func (s *Server) handleSharePublicVerify(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	var req struct {
		Password string `json:"password"`
	}
	_ = decodeJSON(r, &req)
	if _, err := s.Shares.Access(token, req.Password); err != nil {
		s.writeShareError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleSharePublicRaw streams a shared file inline (preview scope) with Range
// support. For folder shares an optional ?path= selects a file inside the
// folder. Blocked for download-only shares.
func (s *Server) handleSharePublicRaw(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	password := r.URL.Query().Get("p")
	if password == "" {
		password = r.Header.Get("X-Share-Password")
	}
	sh, err := s.Shares.Access(token, password)
	if err != nil {
		s.writeShareError(w, r, err)
		return
	}
	if sh.Scope != sharing.ScopePreview {
		writeError(w, http.StatusForbidden, "download_only", "This link is download-only", middleware.GetRequestID(r.Context()))
		return
	}
	rel, verr := resolveShareSub(sh, r.URL.Query().Get("path"))
	if verr != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid file path", middleware.GetRequestID(r.Context()))
		return
	}
	s.streamShared(w, r, sh, rel, false)
}

// handleSharePublicDownload forces a file download and increments the counter.
// For folder shares an optional ?path= downloads one file inside the folder;
// without it the whole folder is streamed as a ZIP archive.
func (s *Server) handleSharePublicDownload(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	password := r.URL.Query().Get("p")
	if password == "" {
		password = r.Header.Get("X-Share-Password")
	}
	sh, err := s.Shares.Access(token, password)
	if err != nil {
		s.writeShareError(w, r, err)
		return
	}
	rel, verr := resolveShareSub(sh, r.URL.Query().Get("path"))
	if verr != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid file path", middleware.GetRequestID(r.Context()))
		return
	}
	s.streamShared(w, r, sh, rel, true)
}

// resolveShareSub resolves an optional ?path= against the share root. The
// resolved path is guaranteed to stay inside the shared path.
func resolveShareSub(sh sharing.Share, sub string) (string, error) {
	base := strings.TrimSuffix(sh.Path, "/")
	if sub == "" {
		return base, nil
	}
	clean, err := storage.CleanRelative(sub)
	if err != nil {
		return "", err
	}
	if clean == "" {
		return base, nil // sub like "./" resolves to the share root itself
	}
	full := clean
	if base != "" {
		full = base + "/" + clean
	}
	fullClean, err := storage.CleanRelative(full)
	if err != nil {
		return "", err
	}
	// Containment: the resolved path must be the share root itself or below it.
	if base != "" && fullClean != base && !strings.HasPrefix(fullClean, base+"/") {
		return "", storage.ErrTraversal
	}
	return fullClean, nil
}

func (s *Server) streamShared(w http.ResponseWriter, r *http.Request, sh sharing.Share, rel string, download bool) {
	root, ok, err := s.StorageRoots.Get(sh.RootID)
	if err != nil || !ok || !root.Enabled {
		writeError(w, http.StatusNotFound, "not_found", "This link is no longer available", middleware.GetRequestID(r.Context()))
		return
	}
	provider := s.StorageRoots.ProviderFor(root)
	info, err := provider.Stat(rel)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "This link is no longer available", middleware.GetRequestID(r.Context()))
		return
	}
	if info.IsDir {
		if !download {
			writeError(w, http.StatusBadRequest, "is_directory", "Pick a file from the folder to preview it", middleware.GetRequestID(r.Context()))
			return
		}
		s.streamFolderZip(w, r, provider, sh, rel)
		return
	}

	name := info.Name
	mime := storage.MimeFor(name, false)
	total := info.Size

	if !download {
		// Preview/raw view — notify webhooks (no download counter).
		s.emitShareEvent(events.EventShareOpened, r, sh, rel)
	}

	if download {
		// Count the download atomically — IncrementDownload refuses to
		// exceed MaxDownloads (the previous fire-and-forget version let
		// concurrent downloads exceed the cap). If we hit the cap at this
		// exact moment, surface 410 to the client.
		if err := s.Shares.IncrementDownload(sh.ID); err != nil {
			if errors.Is(err, sharing.ErrExhausted) {
				writeError(w, http.StatusGone, "exhausted", "This link has reached its download limit", middleware.GetRequestID(r.Context()))
				return
			}
			// Other errors (DB blip) are non-fatal — log and continue so a
			// transient backend hiccup doesn't lock the user out of a
			// valid download. The next request will retry the counter.
			if s.Log != nil {
				s.Log.Warn("share: IncrementDownload failed", "id", sh.ID, "error", err.Error())
			}
		}
		s.emitShareEvent(events.EventShareDownload, r, sh, rel)
		_ = s.Audit.Record(sh.UserID, "share_download", rel, "via share link", clientIP(r))
		rc, rerr := provider.Read(rel)
		if rerr != nil {
			writeError(w, http.StatusNotFound, "not_found", "This link is no longer available", middleware.GetRequestID(r.Context()))
			return
		}
		defer rc.Close()
		w.Header().Set("Content-Type", mime)
		w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+urlEncode(name))
		w.Header().Set("Content-Length", strconv.FormatInt(total, 10))
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, rc)
		return
	}

	// Inline preview with Range support.
	start, end, ok := parseRange(r.Header.Get("Range"), total)
	if !ok {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", total))
		writeError(w, http.StatusRequestedRangeNotSatisfiable, "range_not_satisfiable", "requested range not satisfiable", middleware.GetRequestID(r.Context()))
		return
	}
	rc, _, rerr := provider.OpenRange(rel, start, end)
	if rerr != nil {
		writeError(w, http.StatusNotFound, "not_found", "This link is no longer available", middleware.GetRequestID(r.Context()))
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Disposition", "inline; filename*=UTF-8''"+urlEncode(name))
	if start == 0 && end == total-1 {
		w.Header().Set("Content-Length", strconv.FormatInt(total, 10))
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, rc)
		return
	}
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, total))
	w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
	w.WriteHeader(http.StatusPartialContent)
	_, _ = io.Copy(w, rc)
}

// countAfterFirstByte wraps an io.Writer and invokes onFirstByte on the
// first successful Write. Used by the share download handler so the
// download counter increments only when the response actually starts
// reaching the client (not when the file fails to open or the client
// disconnects immediately). Phase 2 / P1-5.
type countAfterFirstByte struct {
	w           io.Writer
	onFirstByte func()
	once        sync.Once
}

func (c *countAfterFirstByte) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	if n > 0 {
		c.once.Do(c.onFirstByte)
	}
	return n, err
}

// streamFolderZip streams a folder share as a ZIP archive (no server-side
// temp files — entries are copied straight into the response writer).
//
// Phase 2 / P1-9: the walk now enforces hard caps on file count and
// total uncompressed size. A 10M-file share would otherwise collect every
// path into a []string (memory) and stream for hours, pinning server
// resources. A symlink loop would also recurse forever on some
// providers. The caps turn both into clean 413 responses.
const (
	maxShareFolderEntries = 50_000        // files in a single ZIP stream
	maxShareFolderBytes   = int64(50 << 30) // 50 GB uncompressed total
)

// shareZipEntry is a file selected for inclusion in the ZIP stream. It
// carries the path (for Read) and the size (for the cap) so we can stop
// the walk early without re-statting.
type shareZipEntry struct {
	path string
	size int64
}

// collectShareFolderFiles walks the share root and returns the list of
// files eligible for inclusion in a ZIP stream, bounded by the
// maxShareFolderEntries / maxShareFolderBytes caps. Exposed for testing.
// Phase 2 / P1-9.
func collectShareFolderFiles(provider storage.StorageProvider, rel string) ([]shareZipEntry, error) {
	var files []shareZipEntry
	var totalBytes int64
	var walk func(dir string, depth int) error
	walk = func(dir string, depth int) error {
		if depth > 32 {
			return nil
		}
		entries, err := provider.List(dir)
		if err != nil {
			return err
		}
		for _, e := range entries {
			if storage.IsSystemPath(e.Path) {
				continue
			}
			if e.IsDir {
				if err := walk(e.Path, depth+1); err != nil {
					return err
				}
				continue
			}
			if len(files) >= maxShareFolderEntries {
				return errShareFolderTooLarge
			}
			if totalBytes+e.Size > maxShareFolderBytes {
				return errShareFolderTooLarge
			}
			files = append(files, shareZipEntry{path: e.Path, size: e.Size})
			totalBytes += e.Size
		}
		return nil
	}
	if err := walk(rel, 0); err != nil {
		return nil, err
	}
	return files, nil
}

func (s *Server) streamFolderZip(w http.ResponseWriter, r *http.Request, provider storage.StorageProvider, sh sharing.Share, rel string) {
	// Bump the counter AFTER first successful byte (same contract as the
	// file-share download path, see countAfterFirstByte). For a folder
	// zip the first byte is the ZIP local file header, so we wrap zw
	// with the counter below — not here. P1-5 / P1-9 consistency.
	s.emitShareEvent(events.EventShareDownload, r, sh, rel)
	_ = s.Audit.Record(sh.UserID, "share_download", rel, "via share link (folder zip)", clientIP(r))

	files, err := collectShareFolderFiles(provider, rel)
	if err != nil {
		if errors.Is(err, errShareFolderTooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "folder_too_large",
				"Folder exceeds the public-share download limit (50000 files or 50 GB). Ask the owner to share a subfolder.",
				middleware.GetRequestID(r.Context()))
			return
		}
		// Any other walk error is a provider issue; surface as 500.
		s.Log.Error("streamFolderZip walk failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not read share contents", middleware.GetRequestID(r.Context()))
		return
	}

	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "folder_empty", "This folder is empty — nothing to download", middleware.GetRequestID(r.Context()))
		return
	}

	base := strings.TrimSuffix(rel, "/")
	name := storage.NameFromPath(rel)
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+urlEncode(name+".zip"))

	zw := zip.NewWriter(w)
	// Bump the download counter after the first entry is fully written.
	// By that point the response has flushed at least the local file
	// header + the first file's bytes, so a 404 mid-walk or a stalled
	// client no longer consumes a MaxDownloads slot (P1-5).
	var firstEntryDone bool
	for _, f := range files {
		rc, rerr := provider.Read(f.path)
		if rerr != nil {
			continue
		}
		entryName := f.path
		if base != "" {
			entryName = strings.TrimPrefix(f.path, base+"/")
		}
		hdr := &zip.FileHeader{Name: entryName, Method: zip.Deflate}
		if fw, werr := zw.CreateHeader(hdr); werr == nil {
			_, _ = io.Copy(fw, rc)
			if !firstEntryDone {
				// Atomic counter increment — refuses to exceed the cap
				// even under concurrent requests. The earlier
				// _ = IncrementDownload swallowed ErrExhausted, which
				// silently let the cap be exceeded.
				if err := s.Shares.IncrementDownload(sh.ID); err == nil {
					firstEntryDone = true
				} else if errors.Is(err, sharing.ErrExhausted) {
					// Cap hit mid-stream — we've already sent the zip
					// header and at least one entry's bytes, so the
					// client has the partial file. Mark the counter
					// done so we don't retry, but break out so we
					// stop wasting I/O.
					firstEntryDone = true
				} else if s.Log != nil {
					s.Log.Warn("share: IncrementDownload failed", "id", sh.ID, "error", err.Error())
				}
			}
		}
		rc.Close()
	}
	_ = zw.Close()
}

var errShareFolderTooLarge = errors.New("share folder exceeds the public-share size cap")

func (s *Server) writeShareError(w http.ResponseWriter, r *http.Request, err error) {
	rid := middleware.GetRequestID(r.Context())
	switch err {
	case sharing.ErrNotFound:
		writeError(w, http.StatusNotFound, "not_found", "This link is invalid or has been revoked", rid)
	case sharing.ErrExpired:
		writeError(w, http.StatusGone, "expired", "This link has expired", rid)
	case sharing.ErrExhausted:
		writeError(w, http.StatusGone, "exhausted", "This link has reached its download limit", rid)
	case sharing.ErrPassword:
		writeError(w, http.StatusUnauthorized, "password_required", "A correct password is required", rid)
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "Could not access this link", rid)
	}
}

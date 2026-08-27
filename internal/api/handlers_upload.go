package api

import (
	"fmt"
	"github.com/nexora/nexora/internal/events"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	target := queryParam(r, "path", "")
	target, err := storage.CleanRelative(target)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}

	// Stream multipart parts directly into the storage provider. Unlike
	// ParseMultipartForm (which spills large parts to temp files — historically
	// a size-capped tmpfs, killing multi-GB uploads mid-flight), this keeps
	// memory flat and never touches /tmp regardless of file size.
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_multipart", "could not parse upload request", middleware.GetRequestID(r.Context()))
		return
	}

	var uploaded []string
	var lastWriteErr error
	for {
		part, perr := mr.NextPart()
		if perr == io.EOF {
			break
		}
		if perr != nil {
			lastWriteErr = perr
			break
		}
		formName := part.FormName()
		if formName != "files" && formName != "file" {
			part.Close()
			continue
		}
		name := filepath.Base(part.FileName())
		if name == "" || name == "." || strings.ContainsAny(name, "/\\") {
			part.Close()
			writeError(w, http.StatusBadRequest, "invalid_name", "invalid file name", middleware.GetRequestID(r.Context()))
			return
		}
		dest := target
		if dest != "" {
			dest += "/"
		}
		dest += name
		if _, cerr := storage.CleanRelative(dest); cerr != nil {
			part.Close()
			writeError(w, http.StatusBadRequest, "invalid_path", cerr.Error(), middleware.GetRequestID(r.Context()))
			return
		}
		if merr := s.checkAllowedMime(name, part.Header.Get("Content-Type")); merr != nil {
			part.Close()
			writeError(w, http.StatusBadRequest, "mime_not_allowed", merr.Error(), middleware.GetRequestID(r.Context()))
			return
		}
		// Auto-snapshot the existing file before overwriting it, so the
		// user always has a recovery point. Skip if the file doesn't
		// exist yet (first upload is not a "change") or if versioning is
		// disabled / the file exceeds the size cap.
		if existing, serr := acc.provider.Stat(dest); serr == nil && !existing.IsDir {
			s.snapshotIfEnabled(r, rootID, dest, existing.Size)
		}
		werr := acc.provider.Write(dest, part, -1)
		part.Close()
		if werr != nil {
			lastWriteErr = werr
			break
		}
		uploaded = append(uploaded, dest)
		s.indexUpsert(rootID, acc.provider, dest)
		s.recordRecent(r, rootID, dest, "add")
	}
	if len(uploaded) == 0 && lastWriteErr == nil {
		writeError(w, http.StatusBadRequest, "no_files", "no files provided", middleware.GetRequestID(r.Context()))
		return
	}
	if lastWriteErr != nil {
		status, code, msg := classifyUploadError(lastWriteErr)
		if s.Log != nil {
			s.Log.Warn("upload failed",
				"code", code,
				"error", lastWriteErr.Error(),
				"completed_files", len(uploaded),
				"remote_ip", clientIP(r),
			)
		}
		writeError(w, status, code, msg, middleware.GetRequestID(r.Context()))
		return
	}
	totalBytes := int64(0)
	for _, u := range uploaded {
		sz := int64(0)
		if info, serr := acc.provider.Stat(u); serr == nil {
			sz = info.Size
		}
		totalBytes += sz
		s.audit(r, "upload", u, "")
		s.emit(events.EventFileCreated, r, rootID, u, sz)
	}
	if s.Metrics != nil {
		s.Metrics.AddUpload(totalBytes)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "uploaded": uploaded})
}

func (s *Server) checkAllowedMime(filename, contentType string) error {
	if len(s.Cfg.AllowedMimeTypes) == 0 {
		return nil
	}
	mime := storage.MimeFor(filename, false)
	for _, allowed := range s.Cfg.AllowedMimeTypes {
		if allowed == mime || strings.HasPrefix(mime, strings.TrimSuffix(allowed, "*")+"") {
			return nil
		}
		if allowed == "*/*" || allowed == mime {
			return nil
		}
	}
	return os.ErrPermission
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	info, err := acc.provider.Stat(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	if info.IsDir {
		writeError(w, http.StatusBadRequest, "is_directory", "use archive download for directories", middleware.GetRequestID(r.Context()))
		return
	}
	rc, err := acc.provider.Read(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", storage.MimeFor(info.Name, false))
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+urlEncode(info.Name))
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size, 10))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, rc)
	s.audit(r, "download", rel, "")
	s.recordRecent(r, rootID, rel, "access")
}

func (s *Server) handleRaw(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	info, err := acc.provider.Stat(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	if info.IsDir {
		writeError(w, http.StatusBadRequest, "is_directory", "cannot preview a directory", middleware.GetRequestID(r.Context()))
		return
	}
	if r.Header.Get("Range") == "" {
		s.recordRecent(r, rootID, rel, "access")
	}
	total := info.Size
	start, end, ok := parseRange(r.Header.Get("Range"), total)
	if !ok {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", total))
		writeError(w, http.StatusRequestedRangeNotSatisfiable, "range_not_satisfiable", "requested range not satisfiable", middleware.GetRequestID(r.Context()))
		return
	}
	rc, _, err := acc.provider.OpenRange(rel, start, end)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	defer rc.Close()

	mime := storage.MimeFor(info.Name, false)
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Accept-Ranges", "bytes")
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+urlEncode(info.Name))
	} else {
		w.Header().Set("Content-Disposition", "inline; filename*=UTF-8''"+urlEncode(info.Name))
	}

	rangeHeader := r.Header.Get("Range")
	if rangeHeader == "" {
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

// parseRange returns the byte range for a Range header, or (0, 0, false) when
// the request cannot be satisfied (RFC 9110 §14.1.2 — server should reply 416).
// Suffix ranges ("bytes=-N") mean the final N bytes.
func parseRange(rangeHeader string, total int64) (int64, int64, bool) {
	if total <= 0 {
		return 0, 0, false
	}
	start, end := int64(0), total-1
	if rangeHeader == "" || !strings.HasPrefix(rangeHeader, "bytes=") {
		return start, end, true
	}
	spec := strings.TrimPrefix(rangeHeader, "bytes=")
	parts := strings.SplitN(spec, "-", 2)
	if len(parts) != 2 {
		return start, end, true
	}
	// Suffix range: "bytes=-N" → final N bytes. Players use this to read the
	// MP4 moov atom when it sits at the end of the file; returning the wrong
	// bytes breaks playback on iOS AVPlayer / Android ExoPlayer.
	if parts[0] == "" && parts[1] != "" {
		if n, err := strconv.ParseInt(parts[1], 10, 64); err == nil && n > 0 {
			if n < total {
				start = total - n
			}
		}
		return start, end, true // end already = total-1
	}
	if v, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
		start = v
	}
	if parts[1] != "" {
		if v, err := strconv.ParseInt(parts[1], 10, 64); err == nil {
			end = v
		}
	} else {
		end = total - 1 // "bytes=N-" → from N to EOF
	}
	if start < 0 {
		start = 0
	}
	if start >= total {
		return 0, 0, false // starts past EOF → 416
	}
	if end >= total {
		end = total - 1
	}
	if start > end {
		start, end = 0, total-1
	}
	return start, end, true
}

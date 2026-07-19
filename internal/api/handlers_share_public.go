package api

import (
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/sharing"
	"github.com/nexora/nexora/internal/storage"
)

// handleSharePublicInfo returns non-sensitive metadata for a share page. It
// never reveals server filesystem paths or the containing root.
func (s *Server) handleSharePublicInfo(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	sh, err := s.Shares.GetByToken(token)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "This link is invalid or has been revoked", middleware.GetRequestID(r.Context()))
		return
	}
	// Report expiry/exhaustion without leaking details.
	status := "ok"
	if sh.ExpiresAt != nil {
		if _, aerr := s.Shares.Access(token, ""); aerr == sharing.ErrExpired {
			status = "expired"
		}
	}
	if sh.MaxDownloads > 0 && sh.DownloadCount >= sh.MaxDownloads {
		status = "exhausted"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"name":          storage.NameFromPath(sh.Path),
		"scope":         string(sh.Scope),
		"has_password":  sh.HasPassword,
		"status":        status,
		"extension":     storage.Ext(sh.Path),
		"mime":          storage.MimeFor(storage.NameFromPath(sh.Path), false),
		"max_downloads": sh.MaxDownloads,
		"downloads":     sh.DownloadCount,
		"expires_at":    sh.ExpiresAt,
	})
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
// support. Blocked for download-only shares.
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
	s.streamShared(w, r, sh, false)
}

// handleSharePublicDownload forces a file download and increments the counter.
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
	s.streamShared(w, r, sh, true)
}

func (s *Server) streamShared(w http.ResponseWriter, r *http.Request, sh sharing.Share, download bool) {
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
	if info.IsDir {
		writeError(w, http.StatusBadRequest, "is_directory", "Folder shares cannot be downloaded directly", middleware.GetRequestID(r.Context()))
		return
	}

	name := info.Name
	mime := storage.MimeFor(name, false)
	total := info.Size

	if download {
		// Count the download (best-effort) and force attachment.
		_ = s.Shares.IncrementDownload(sh.ID)
		_ = s.Audit.Record(sh.UserID, "share_download", sh.Path, "via share link", clientIP(r))
		rc, rerr := provider.Read(sh.Path)
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
	start, end := parseRange(r.Header.Get("Range"), total)
	rc, _, rerr := provider.OpenRange(sh.Path, start, end)
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

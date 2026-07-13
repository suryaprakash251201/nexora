package api

import (
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/preview"
	"github.com/nexora/nexora/internal/storage"
)

// handleGetContent returns the text content of an editable file plus a version
// token (the modified timestamp) used for optimistic concurrency on save.
func (s *Server) handleGetContent(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "is_directory", "cannot edit a directory", middleware.GetRequestID(r.Context()))
		return
	}
	if !preview.IsEditable(info.Name) {
		writeError(w, http.StatusUnsupportedMediaType, "not_editable", "this file type cannot be edited", middleware.GetRequestID(r.Context()))
		return
	}
	if info.Size > s.Cfg.MaxEditableSize {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "file exceeds the editable size limit", middleware.GetRequestID(r.Context()))
		return
	}
	rc, err := acc.provider.Read(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, s.Cfg.MaxEditableSize+1))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read_error", "could not read file", middleware.GetRequestID(r.Context()))
		return
	}
	if !isProbablyText(data) {
		writeError(w, http.StatusUnsupportedMediaType, "binary_file", "refusing to edit a binary file", middleware.GetRequestID(r.Context()))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"content":   string(data),
		"version":   info.Modified.UTC().Format(time.RFC3339Nano),
		"name":      info.Name,
		"path":      info.Path,
		"extension": storage.Ext(info.Name),
	})
}

// handleSaveContent writes editor changes back, enforcing write permission, the
// editable-size limit, and optimistic concurrency (version conflict handling).
func (s *Server) handleSaveContent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root    string `json:"root"`
		Path    string `json:"path"`
		Content string `json:"content"`
		Version string `json:"version"` // expected current version (from GET)
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	rel, err := storage.CleanRelative(req.Path)
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	if int64(len(req.Content)) > s.Cfg.MaxEditableSize {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "content exceeds the editable size limit", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, req.Root, true) // requires write
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
		writeError(w, http.StatusBadRequest, "is_directory", "cannot edit a directory", middleware.GetRequestID(r.Context()))
		return
	}
	if !preview.IsEditable(info.Name) {
		writeError(w, http.StatusUnsupportedMediaType, "not_editable", "this file type cannot be edited", middleware.GetRequestID(r.Context()))
		return
	}
	// Optimistic concurrency: reject if the file changed since it was loaded.
	if req.Version != "" {
		current := info.Modified.UTC().Format(time.RFC3339Nano)
		if current != req.Version {
			writeError(w, http.StatusConflict, "version_conflict", "file changed on disk since it was opened", middleware.GetRequestID(r.Context()))
			return
		}
	}
	if err := acc.provider.Write(rel, strings.NewReader(req.Content), int64(len(req.Content))); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	// Refresh index + audit the edit.
	if newInfo, serr := acc.provider.Stat(rel); serr == nil && s.Search != nil {
		s.Search.Upsert(req.Root, newInfo)
	}
	s.audit(r, "edit", rel, "saved via editor")
	newVersion := time.Now().UTC().Format(time.RFC3339Nano)
	if newInfo, serr := acc.provider.Stat(rel); serr == nil {
		newVersion = newInfo.Modified.UTC().Format(time.RFC3339Nano)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": newVersion})
}

// isProbablyText rejects content containing NUL bytes (a strong binary signal).
func isProbablyText(data []byte) bool {
	n := len(data)
	if n > 8192 {
		n = 8192
	}
	for i := 0; i < n; i++ {
		if data[i] == 0 {
			return false
		}
	}
	return true
}

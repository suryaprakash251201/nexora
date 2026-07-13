package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/sharing"
	"github.com/nexora/nexora/internal/storage"
)

func (s *Server) handleListShares(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	limit, _ := strconv.Atoi(queryParam(r, "limit", "100"))
	offset, _ := strconv.Atoi(queryParam(r, "offset", "0"))
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	shares, err := s.Shares.ListForUser(user.ID, user.Role == "admin", limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list shares", middleware.GetRequestID(r.Context()))
		return
	}
	out := make([]map[string]any, 0, len(shares))
	for _, sh := range shares {
		out = append(out, shareToMap(sh, s.shareURL(r, sh.Token)))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root         string `json:"root"`
		Path         string `json:"path"`
		Scope        string `json:"scope"`
		Password     string `json:"password"`
		ExpiresInHrs int    `json:"expires_in_hours"`
		MaxDownloads int    `json:"max_downloads"`
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
	// Must be able to read the target.
	acc, err := s.resolveAccess(r, req.Root, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	if _, err := acc.provider.Stat(rel); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	user, _ := auth.UserFromContext(r.Context())
	in := sharing.CreateInput{
		UserID:       user.ID,
		RootID:       req.Root,
		Path:         rel,
		Scope:        sharing.Scope(req.Scope),
		Password:     req.Password,
		MaxDownloads: req.MaxDownloads,
	}
	if req.ExpiresInHrs > 0 {
		exp := time.Now().Add(time.Duration(req.ExpiresInHrs) * time.Hour)
		in.ExpiresAt = &exp
	}
	sh, err := s.Shares.Create(in)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not create share", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "share_create", rel, "token="+sh.Token[:8]+"…")
	writeJSON(w, http.StatusCreated, map[string]any{"share": shareToMap(sh, s.shareURL(r, sh.Token))})
}

func (s *Server) handleRevokeShare(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	if err := s.Shares.Revoke(id, user.ID, user.Role == "admin"); err != nil {
		if err == sharing.ErrNotFound {
			writeError(w, http.StatusNotFound, "not_found", "share not found", middleware.GetRequestID(r.Context()))
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error", "could not revoke share", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "share_revoke", id, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func shareToMap(sh sharing.Share, url string) map[string]any {
	return map[string]any{
		"id":             sh.ID,
		"token":          sh.Token,
		"url":            url,
		"root_id":        sh.RootID,
		"path":           sh.Path,
		"name":           storage.NameFromPath(sh.Path),
		"scope":          string(sh.Scope),
		"has_password":   sh.HasPassword,
		"expires_at":     sh.ExpiresAt,
		"max_downloads":  sh.MaxDownloads,
		"download_count": sh.DownloadCount,
		"created_at":     sh.CreatedAt,
	}
}

func (s *Server) shareURL(r *http.Request, token string) string {
	base := strings.TrimSuffix(s.Cfg.BaseURL, "/")
	if base == "" {
		scheme := "http"
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			scheme = "https"
		}
		base = scheme + "://" + r.Host
	}
	return base + "/s/" + token
}

package api

import (
	"context"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
)

// reindexInBackground kicks off a search-index sweep without blocking the
// request. ScanAll coalesces concurrent invocations and never errors out, so
// calling it on every root create/enable is cheap.
func (s *Server) reindexInBackground() {
	if s.Search == nil {
		return
	}
	go s.Search.ScanAll(context.Background())
}

func (s *Server) handleAdminListRoots(w http.ResponseWriter, r *http.Request) {
	roots, err := s.StorageRoots.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list roots", middleware.GetRequestID(r.Context()))
		return
	}
	out := make([]map[string]any, 0, len(roots))
	for _, root := range roots {
		rootType := root.Type
		if rootType == "" {
			rootType = "local"
		}
		rootConfig := root.Config
		if rootConfig == "" {
			rootConfig = "{}"
		}
		out = append(out, map[string]any{
			"id":         root.ID,
			"name":       root.Name,
			"path":       root.Path,
			"icon":       root.Icon,
			"type":       rootType,
			"config":     rootConfig,
			"read_only":  root.ReadOnly,
			"enabled":    root.Enabled,
			"indexed":    root.Indexed,
			"created_at": root.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"roots": out})
}

func (s *Server) handleAdminCreateRoot(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string `json:"name"`
		Path     string `json:"path"`
		Icon     string `json:"icon"`
		Type     string `json:"type"`
		Config   string `json:"config"`
		ReadOnly bool   `json:"read_only"`
		Indexed  bool   `json:"indexed"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	if req.Name == "" || req.Path == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "name and path are required", middleware.GetRequestID(r.Context()))
		return
	}
	if req.Type == "" {
		req.Type = "local"
	}
	if req.Config == "" {
		req.Config = "{}"
	}
	root, err := s.StorageRoots.Create(storage.Root{
		Name:     req.Name,
		Path:     req.Path,
		Icon:     req.Icon,
		Type:     req.Type,
		Config:   req.Config,
		ReadOnly: req.ReadOnly,
		Enabled:  true,
		Indexed:  req.Indexed,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not create root", middleware.GetRequestID(r.Context()))
		return
	}
	if u, ok := auth.UserFromContext(r.Context()); ok {
		_ = s.StorageRoots.Grant(u.ID, root.ID, storage.PermWrite)
	}
	// A new root is invisible to search, photos and usage stats until it is
	// scanned, and the periodic sweep only runs every 6 hours — so without this
	// a freshly added root silently returns nothing for search until the next
	// sweep (or a manual reindex).
	s.reindexInBackground()
	s.audit(r, "root_create", root.Name, root.Path)
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "id": root.ID})
}

func (s *Server) handleAdminUpdateRoot(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Name     string `json:"name"`
		Path     string `json:"path"`
		Icon     string `json:"icon"`
		Type     string `json:"type"`
		Config   string `json:"config"`
		ReadOnly bool   `json:"read_only"`
		Enabled  bool   `json:"enabled"`
		Indexed  bool   `json:"indexed"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	if req.Type == "" {
		req.Type = "local"
	}
	if req.Config == "" {
		req.Config = "{}"
	}
	if err := s.StorageRoots.Update(id, req.Name, req.Path, req.Icon, req.Type, req.Config, req.ReadOnly, req.Enabled, req.Indexed); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not update root", middleware.GetRequestID(r.Context()))
		return
	}
	// Enabling indexing (or a root that was disabled) has to take effect now,
	// not at the next 6-hourly sweep.
	if req.Enabled && req.Indexed {
		s.reindexInBackground()
	}
	s.audit(r, "root_update", id, req.Name)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminDeleteRoot(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.StorageRoots.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not delete root", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "root_delete", id, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.Users.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list users", middleware.GetRequestID(r.Context()))
		return
	}
	out := make([]map[string]any, 0, len(users))
	for _, u := range users {
		out = append(out, map[string]any{
			"id":           u.ID,
			"username":     u.Username,
			"email":        u.Email,
			"display_name": u.DisplayName,
			"role":         string(u.Role),
			"status":       u.Status,
			"totp_enabled": u.TOTPEnabled,
			"created_at":   u.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

func (s *Server) handleAdminListAudit(w http.ResponseWriter, r *http.Request) {
	limit := atoiOrDefault(queryParam(r, "limit", "100"), 100)
	offset := atoiOrDefault(queryParam(r, "offset", "0"), 0)
	rows, err := s.Audit.List(limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list audit", middleware.GetRequestID(r.Context()))
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, e := range rows {
		out = append(out, map[string]any{
			"id":         e.ID,
			"user_id":    e.UserID,
			"action":     e.Action,
			"target":     e.Target,
			"ip":         e.IP,
			"detail":     e.Detail,
			"created_at": e.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func atoiOrDefault(s string, def int) int {
	var n int
	_, err := fmt.Sscanf(s, "%d", &n)
	if err != nil {
		return def
	}
	return n
}

func (s *Server) handleAdminGetStorageUsage(w http.ResponseWriter, r *http.Request) {
	roots, err := s.StorageRoots.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list roots", middleware.GetRequestID(r.Context()))
		return
	}
	type usageInfo struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Total     int64  `json:"total"`
		Available int64  `json:"available"`
		Used      int64  `json:"used"`
	}
	out := make([]usageInfo, 0, len(roots))
	var aggTotal, aggAvailable, aggUsed int64
	for _, root := range roots {
		prov := s.StorageRoots.ProviderFor(root)
		if prov == nil {
			continue
		}
		q, err := prov.GetQuota()
		if err != nil {
			continue
		}
		out = append(out, usageInfo{
			ID: root.ID, Name: root.Name,
			Total: q.Total, Available: q.Available, Used: q.Used,
		})
		aggTotal += q.Total
		aggAvailable += q.Available
		aggUsed += q.Used
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"roots":     out,
		"total":     aggTotal,
		"available": aggAvailable,
		"used":      aggUsed,
	})
}

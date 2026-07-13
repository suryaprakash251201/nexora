package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
)

func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username    string `json:"username"`
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	if err := validateSignup(req.Username, req.Email, req.Password); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	role := auth.Role(req.Role)
	if role != auth.RoleAdmin && role != auth.RoleUser && role != auth.RoleViewer {
		role = auth.RoleUser
	}
	if req.DisplayName == "" {
		req.DisplayName = req.Username
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not hash password", middleware.GetRequestID(r.Context()))
		return
	}
	created, err := s.Users.Create(auth.User{
		Username:     req.Username,
		Email:        req.Email,
		DisplayName:  req.DisplayName,
		PasswordHash: hash,
		Role:         role,
		Status:       "active",
	})
	if err != nil {
		writeError(w, http.StatusConflict, "conflict", "username or email already exists", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "user_create", created.Username, string(role))
	writeJSON(w, http.StatusCreated, map[string]any{"user": toUserDTO(created)})
}

func (s *Server) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Role     string `json:"role"`
		Status   string `json:"status"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	target, ok, err := s.Users.GetByID(id)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "not_found", "user not found", middleware.GetRequestID(r.Context()))
		return
	}
	// Guard: don't allow demoting/disabling the last active admin.
	if target.Role == auth.RoleAdmin && (req.Role != "" && req.Role != "admin" || req.Status == "disabled") {
		if last, _ := s.isLastAdmin(target.ID); last {
			writeError(w, http.StatusConflict, "last_admin", "cannot demote or disable the last admin", middleware.GetRequestID(r.Context()))
			return
		}
	}
	role := target.Role
	if req.Role != "" {
		r2 := auth.Role(req.Role)
		if r2 == auth.RoleAdmin || r2 == auth.RoleUser || r2 == auth.RoleViewer {
			role = r2
		}
	}
	status := target.Status
	if req.Status == "active" || req.Status == "disabled" {
		status = req.Status
	}
	if err := s.Users.UpdateRole(id, role, status); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not update user", middleware.GetRequestID(r.Context()))
		return
	}
	if req.Password != "" {
		if err := validatePassword(req.Password); err != nil {
			writeError(w, http.StatusBadRequest, "validation_error", err.Error(), middleware.GetRequestID(r.Context()))
			return
		}
		hash, herr := auth.HashPassword(req.Password)
		if herr == nil {
			_ = s.Users.UpdatePassword(id, hash)
			_ = s.Sessions.DeleteAllForUser(id)
		}
	}
	s.audit(r, "user_update", target.Username, string(role)+"/"+status)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	me, _ := auth.UserFromContext(r.Context())
	if id == me.ID {
		writeError(w, http.StatusConflict, "self_delete", "you cannot delete your own account", middleware.GetRequestID(r.Context()))
		return
	}
	target, ok, err := s.Users.GetByID(id)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "not_found", "user not found", middleware.GetRequestID(r.Context()))
		return
	}
	if target.Role == auth.RoleAdmin {
		if last, _ := s.isLastAdmin(id); last {
			writeError(w, http.StatusConflict, "last_admin", "cannot delete the last admin", middleware.GetRequestID(r.Context()))
			return
		}
	}
	if _, err := s.DB.Exec(`DELETE FROM users WHERE id=?`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not delete user", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "user_delete", target.Username, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminGetUserRoots(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	allRoots, err := s.StorageRoots.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list roots", middleware.GetRequestID(r.Context()))
		return
	}
	out := make([]map[string]any, 0, len(allRoots))
	for _, root := range allRoots {
		perm, granted, _ := s.StorageRoots.UserPermission(id, false, root.ID)
		out = append(out, map[string]any{
			"id":         root.ID,
			"name":       root.Name,
			"read_only":  root.ReadOnly,
			"granted":    granted,
			"permission": string(perm),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"roots": out})
}

func (s *Server) handleAdminGrantRoot(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		RootID     string `json:"root_id"`
		Permission string `json:"permission"`
	}
	if err := decodeJSON(r, &req); err != nil || req.RootID == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "root_id required", middleware.GetRequestID(r.Context()))
		return
	}
	perm := storage.PermRead
	if req.Permission == "write" {
		perm = storage.PermWrite
	}
	if err := s.StorageRoots.Grant(id, req.RootID, perm); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not grant access", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "permission_grant", id, req.RootID+":"+string(perm))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminRevokeRoot(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rootID := chi.URLParam(r, "rootId")
	if err := s.StorageRoots.Revoke(id, rootID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not revoke access", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "permission_revoke", id, rootID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) isLastAdmin(excludeID string) (bool, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin' AND status='active' AND id<>?`, excludeID).Scan(&n)
	return n == 0, err
}

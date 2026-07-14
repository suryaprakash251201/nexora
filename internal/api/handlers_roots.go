package api

import (
	"net/http"

	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
)

func (s *Server) handleListRoots(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	roots, err := s.StorageRoots.UserRoots(user.ID, user.Role == "admin")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list roots", middleware.GetRequestID(r.Context()))
		return
	}
	out := make([]map[string]any, 0, len(roots))
	for _, r := range roots {
		perm, _, _ := s.StorageRoots.UserPermission(user.ID, user.Role == "admin", r.ID)
		out = append(out, map[string]any{
			"id":         r.ID,
			"name":       r.Name,
			"icon":       r.Icon,
			"path":       r.Path,
			"read_only":  r.ReadOnly,
			"enabled":    r.Enabled,
			"permission": string(perm),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"roots": out})
}

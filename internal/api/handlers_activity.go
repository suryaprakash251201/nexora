package api

import (
	"net/http"

	"github.com/nexora/nexora/internal/middleware"
)

// handleActivity returns the audit trail for a single file or folder.
//
// GET /api/v1/activity?root=<rootID>&path=<path within root>
//
// The audit log stores root-relative targets, so root is accepted for
// symmetry with the other file endpoints but cannot narrow the match.
// Targets recorded for rename/move are "src -> dest"; both directions are
// matched by audit.ListByTarget.
func (s *Server) handleActivity(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "path is required", middleware.GetRequestID(r.Context()))
		return
	}
	entries, err := s.Audit.ListByTarget(path, 50)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "activity_failed", "could not load activity", middleware.GetRequestID(r.Context()))
		return
	}
	items := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		items = append(items, map[string]any{
			"id":         e.ID,
			"action":     e.Action,
			"user_name":  e.UserName,
			"detail":     e.Detail,
			"created_at": e.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

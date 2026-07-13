package api

import (
	"net/http"
	"strconv"

	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
)

type trashRow struct {
	ID            string
	UserID        string
	RootID        string
	OriginalPath  string
	TrashPath     string
	Name          string
	Size          int64
	IsDir         bool
	DeletedAt     string
	RootName      string
}

func (s *Server) listTrash(r *http.Request, user auth.User) ([]trashRow, error) {
	q := `SELECT t.id,t.user_id,t.root_id,t.original_path,t.trash_path,t.name,t.size,t.is_dir,t.deleted_at,r.name
	      FROM trash t LEFT JOIN storage_roots r ON r.id=t.root_id`
	args := []any{}
	if user.Role != "admin" {
		q += " WHERE t.user_id=?"
		args = append(args, user.ID)
	}
	q += " ORDER BY t.deleted_at DESC LIMIT ? OFFSET ?"
	limit, _ := strconv.Atoi(queryParam(r, "limit", "200"))
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	offset, _ := strconv.Atoi(queryParam(r, "offset", "0"))
	args = append(args, limit, offset)

	rows, err := s.DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []trashRow
	for rows.Next() {
		var t trashRow
		var isDir int
		if err := rows.Scan(&t.ID, &t.UserID, &t.RootID, &t.OriginalPath, &t.TrashPath, &t.Name, &t.Size, &isDir, &t.DeletedAt, &t.RootName); err != nil {
			return nil, err
		}
		t.IsDir = isDir == 1
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Server) handleListTrash(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	rows, err := s.listTrash(r, user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list trash", middleware.GetRequestID(r.Context()))
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, t := range rows {
		out = append(out, map[string]any{
			"id":            t.ID,
			"root_id":       t.RootID,
			"root_name":     t.RootName,
			"original_path": t.OriginalPath,
			"name":          t.Name,
			"size":          t.Size,
			"is_dir":        t.IsDir,
			"deleted_at":    t.DeletedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) handleRestoreTrash(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := decodeJSON(r, &req); err != nil || req.ID == "" {
		writeError(w, http.StatusBadRequest, "invalid_body", "trash id required", middleware.GetRequestID(r.Context()))
		return
	}
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	var t trashRow
	var isDir int
	err := s.DB.QueryRow(
		`SELECT id,user_id,root_id,original_path,trash_path,name,size,is_dir FROM trash WHERE id=?`, req.ID).
		Scan(&t.ID, &t.UserID, &t.RootID, &t.OriginalPath, &t.TrashPath, &t.Name, &t.Size, &isDir)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "trash entry not found", middleware.GetRequestID(r.Context()))
		return
	}
	if user.Role != "admin" && t.UserID != user.ID {
		writeError(w, http.StatusForbidden, "forbidden", "not your trash entry", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, t.RootID, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	// Ensure the target doesn't already exist.
	if _, statErr := acc.provider.Stat(t.OriginalPath); statErr == nil {
		writeError(w, http.StatusConflict, "exists", "original location already exists", middleware.GetRequestID(r.Context()))
		return
	}
	if err := acc.provider.Move(t.TrashPath, t.OriginalPath); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	if _, err := s.DB.Exec(`DELETE FROM trash WHERE id=?`, t.ID); err != nil {
		// Undo the move on failure.
		_ = acc.provider.Move(t.OriginalPath, t.TrashPath)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not update trash", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "restore", t.OriginalPath, "from trash")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDeleteTrash(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_id", "trash id required", middleware.GetRequestID(r.Context()))
		return
	}
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	var t trashRow
	err := s.DB.QueryRow(`SELECT id,user_id,root_id,trash_path FROM trash WHERE id=?`, id).
		Scan(&t.ID, &t.UserID, &t.RootID, &t.TrashPath)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "trash entry not found", middleware.GetRequestID(r.Context()))
		return
	}
	if user.Role != "admin" && t.UserID != user.ID {
		writeError(w, http.StatusForbidden, "forbidden", "not your trash entry", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, t.RootID, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	if err := acc.provider.Delete(t.TrashPath); err != nil && err != storage.ErrNotFound {
		s.writeProviderError(w, r, err)
		return
	}
	if _, err := s.DB.Exec(`DELETE FROM trash WHERE id=?`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not update trash", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "delete_permanent", t.TrashPath, "from trash")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

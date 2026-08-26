package api

import (
	"net/http"
	"strconv"

	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/events"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
	"github.com/nexora/nexora/internal/util"
)

type trashRow struct {
	ID           string
	UserID       string
	RootID       string
	OriginalPath string
	TrashPath    string
	Name         string
	Size         int64
	IsDir        bool
	DeletedAt    string
	RootName     string
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
	// Ensure the target doesn't already exist. The check + restore is a
	// TOCTOU window on the local provider, so we further defend by
	// restoring via a unique temp name and only then moving to the
	// original location (see below). Phase 2 / P1-6.
	if _, statErr := acc.provider.Stat(t.OriginalPath); statErr == nil {
		writeError(w, http.StatusConflict, "exists", "original location already exists", middleware.GetRequestID(r.Context()))
		return
	}
	// Restore to a unique temp name first, then Move onto the original
	// path. This narrows the race window: a concurrent upload that lands
	// in the original location between our Stat and our final Move will
	// either be clobbered (provider.Move semantics) or rejected (provider
	// returns ErrExists) — and if it's rejected, the restored file is
	// still under a temp name we can clean up.
	tempPath := t.OriginalPath + ".restore-" + util.NewID("", 8)
	if err := acc.provider.Move(t.TrashPath, tempPath); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	if err := acc.provider.Move(tempPath, t.OriginalPath); err != nil {
		// Best-effort: try to undo by moving the temp back into the
		// trash path so the file is not lost. We LOG the undo result
		// (not swallow it) so operators can find orphan files; the old
		// code dropped the error on the floor.
		if undoErr := acc.provider.Move(tempPath, t.TrashPath); undoErr != nil {
			if s.Log != nil {
				s.Log.Error("trash restore: undo failed — file is orphaned",
					"trash_id", t.ID,
					"trash_path", t.TrashPath,
					"original_path", t.OriginalPath,
					"temp_path", tempPath,
					"undo_error", undoErr.Error(),
				)
			}
			_ = s.Audit.Record(user.ID, "trash_restore_orphan", t.OriginalPath,
				"file lost between trash and original; original_move_error="+err.Error()+
					" undo_error="+undoErr.Error(), clientIP(r))
		} else {
			if s.Log != nil {
				s.Log.Warn("trash restore: final move failed, file moved back to trash",
					"trash_id", t.ID,
					"original_path", t.OriginalPath,
					"move_error", err.Error(),
				)
			}
		}
		s.writeProviderError(w, r, err)
		return
	}
	if _, err := s.DB.Exec(`DELETE FROM trash WHERE id=?`, t.ID); err != nil {
		// Undo the move on failure. We log the undo result; the old
		// code dropped the error on the floor (the file ended up at the
		// original location but the trash row was gone, leaving an
		// un-trackable orphan in the trash dir).
		if undoErr := acc.provider.Move(t.OriginalPath, t.TrashPath); undoErr != nil {
			if s.Log != nil {
				s.Log.Error("trash restore: DB delete failed AND undo failed — file is at original location but trash row remains",
					"trash_id", t.ID,
					"original_path", t.OriginalPath,
					"db_error", err.Error(),
					"undo_error", undoErr.Error(),
				)
			}
		} else if s.Log != nil {
			s.Log.Warn("trash restore: DB delete failed, file moved back to trash",
				"trash_id", t.ID,
				"db_error", err.Error(),
			)
		}
		writeError(w, http.StatusInternalServerError, "internal_error", "could not update trash", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "restore", t.OriginalPath, "from trash")
	s.emit(events.EventFileRestored, r, t.RootID, t.OriginalPath, t.Size)
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

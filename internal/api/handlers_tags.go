package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/util"
)

// Tag represents a file tag
type Tag struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Count     int    `json:"count,omitempty"`
	CreatedAt string `json:"created_at"`
}

func (s *Server) handleListTags(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized", "")
		return
	}

	rows, err := s.DB.Query(`
		SELECT t.id, t.name, t.color, t.created_at, COUNT(ft.tag_id) as count 
		FROM tags t
		LEFT JOIN file_tags ft ON t.id = ft.tag_id
		WHERE t.user_id = ?
		GROUP BY t.id, t.name, t.color, t.created_at
		ORDER BY t.name ASC
	`, user.ID)
	if err != nil {
		s.Log.Error("failed to query tags", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "database error", "")
		return
	}
	defer rows.Close()

	var tags []Tag
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.CreatedAt, &t.Count); err != nil {
			s.Log.Error("failed to scan tag", "error", err)
			writeError(w, http.StatusInternalServerError, "internal_error", "database error", "")
			return
		}
		tags = append(tags, t)
	}

	if tags == nil {
		tags = []Tag{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}

func (s *Server) handleCreateTag(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized", middleware.GetRequestID(r.Context()))
		return
	}

	var req struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid request", middleware.GetRequestID(r.Context()))
		return
	}
	if req.Color == "" {
		req.Color = "#6366f1"
	}

	id := util.NewID("tag_", 12)
	now := util.NowUTC()

	_, err := s.DB.Exec(`INSERT INTO tags (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)`,
		id, user.ID, req.Name, req.Color, now)
	if err != nil {
		s.Log.Error("failed to create tag", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "database error", middleware.GetRequestID(r.Context()))
		return
	}

	writeJSON(w, http.StatusOK, Tag{
		ID:        id,
		Name:      req.Name,
		Color:     req.Color,
		CreatedAt: now,
		Count:     0,
	})
}

// handleUpdateTag renames and/or recolors an existing tag (PATCH /tags/{id}).
func (s *Server) handleUpdateTag(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized", middleware.GetRequestID(r.Context()))
		return
	}
	tagID := chi.URLParam(r, "id")

	var req struct {
		Name  *string `json:"name"`  // nil = leave unchanged
		Color *string `json:"color"` // nil = leave unchanged
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid request", middleware.GetRequestID(r.Context()))
		return
	}
	if req.Name != nil && strings.TrimSpace(*req.Name) == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "tag name must not be empty", middleware.GetRequestID(r.Context()))
		return
	}

	// Verify ownership before touching anything.
	var count int
	if err := s.DB.QueryRow(`SELECT 1 FROM tags WHERE id = ? AND user_id = ?`, tagID, user.ID).Scan(&count); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "tag not found", middleware.GetRequestID(r.Context()))
		return
	}

	sets := []string{}
	args := []any{}
	if req.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, strings.TrimSpace(*req.Name))
	}
	if req.Color != nil && *req.Color != "" {
		sets = append(sets, "color = ?")
		args = append(args, *req.Color)
	}
	if len(sets) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "nothing to update", middleware.GetRequestID(r.Context()))
		return
	}
	args = append(args, tagID)

	if _, err := s.DB.Exec(`UPDATE tags SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
		s.Log.Error("failed to update tag", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "database error", middleware.GetRequestID(r.Context()))
		return
	}

	// Return the fresh row (including its current usage count).
	var t Tag
	if err := s.DB.QueryRow(`
		SELECT t.id, t.name, t.color, t.created_at, COUNT(ft.tag_id)
		FROM tags t
		LEFT JOIN file_tags ft ON ft.tag_id = t.id
		WHERE t.id = ? AND t.user_id = ?
		GROUP BY t.id, t.name, t.color, t.created_at
	`, tagID, user.ID).Scan(&t.ID, &t.Name, &t.Color, &t.CreatedAt, &t.Count); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "database error", middleware.GetRequestID(r.Context()))
		return
	}

	s.audit(r, "tag_update", tagID, "updated")
	writeJSON(w, http.StatusOK, t)
}

// handleDeleteTag removes a tag and its file_tag associations.
func (s *Server) handleDeleteTag(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized", middleware.GetRequestID(r.Context()))
		return
	}
	tagID := chi.URLParam(r, "id")

	res, err := s.DB.Exec(`DELETE FROM tags WHERE id = ? AND user_id = ?`, tagID, user.ID)
	if err != nil {
		s.Log.Error("failed to delete tag", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "database error", middleware.GetRequestID(r.Context()))
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		writeError(w, http.StatusNotFound, "not_found", "tag not found", middleware.GetRequestID(r.Context()))
		return
	}
	// file_tags rows cascade via the FK (ON DELETE CASCADE).
	s.audit(r, "tag_delete", tagID, "deleted")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleTagFile(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized", middleware.GetRequestID(r.Context()))
		return
	}

	var req struct {
		TagID  string   `json:"tag_id"`
		RootID string   `json:"root_id"`
		Paths  []string `json:"paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TagID == "" || req.RootID == "" || len(req.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid request", middleware.GetRequestID(r.Context()))
		return
	}

	// Tagging is a personal annotation, not a storage mutation: read access
	// suffices so read-only roots can be tagged too.
	if _, err := s.resolveAccess(r, req.RootID, false); err != nil {
		writeError(w, http.StatusForbidden, "forbidden", "access denied", middleware.GetRequestID(r.Context()))
		return
	}

	// Verify tag belongs to user
	var exists int
	if err := s.DB.QueryRow(`SELECT 1 FROM tags WHERE id = ? AND user_id = ?`, req.TagID, user.ID).Scan(&exists); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "tag not found", middleware.GetRequestID(r.Context()))
		return
	}

	tx, err := s.DB.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "database error", middleware.GetRequestID(r.Context()))
		return
	}

	now := util.NowUTC()
	for _, p := range req.Paths {
		_, err := tx.Exec(`INSERT OR IGNORE INTO file_tags (tag_id, root_id, path, created_at) VALUES (?, ?, ?, ?)`,
			req.TagID, req.RootID, p, now)
		if err != nil {
			tx.Rollback()
			s.Log.Error("failed to tag file", "error", err)
			writeError(w, http.StatusInternalServerError, "internal_error", "database error", middleware.GetRequestID(r.Context()))
			return
		}
	}
	tx.Commit()

	s.audit(r, "tag_apply", req.RootID, fmt.Sprintf("tag=%s paths=%d", req.TagID, len(req.Paths)))
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleUntagFile(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized", middleware.GetRequestID(r.Context()))
		return
	}

	// Web client sends DELETE /files/tag?tag_id=&root_id=&paths=comma,sep,list.
	// (It uses the generic del() helper which puts params on the query string.)
	req := struct {
		TagID  string
		RootID string
		Paths  string
	}{
		TagID:  r.URL.Query().Get("tag_id"),
		RootID: r.URL.Query().Get("root_id"),
		Paths:  r.URL.Query().Get("paths"),
	}
	if req.TagID == "" || req.RootID == "" || req.Paths == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid request", middleware.GetRequestID(r.Context()))
		return
	}

	if _, err := s.resolveAccess(r, req.RootID, false); err != nil {
		writeError(w, http.StatusForbidden, "forbidden", "access denied", middleware.GetRequestID(r.Context()))
		return
	}

	// Verify tag belongs to user
	var exists int
	if err := s.DB.QueryRow(`SELECT 1 FROM tags WHERE id = ? AND user_id = ?`, req.TagID, user.ID).Scan(&exists); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "tag not found", middleware.GetRequestID(r.Context()))
		return
	}

	tx, err := s.DB.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "database error", middleware.GetRequestID(r.Context()))
		return
	}

	for _, p := range strings.Split(req.Paths, ",") {
		if p == "" {
			continue
		}
		_, err := tx.Exec(`DELETE FROM file_tags WHERE tag_id = ? AND root_id = ? AND path = ?`,
			req.TagID, req.RootID, p)
		if err != nil {
			tx.Rollback()
			s.Log.Error("failed to untag file", "error", err)
			writeError(w, http.StatusInternalServerError, "internal_error", "database error", middleware.GetRequestID(r.Context()))
			return
		}
	}
	tx.Commit()

	s.audit(r, "tag_remove", req.RootID, fmt.Sprintf("tag=%s paths=%s", req.TagID, req.Paths))
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

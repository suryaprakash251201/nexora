package api

import (
	"encoding/json"
	"net/http"

	"github.com/nexora/nexora/internal/auth"
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
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized", "")
		return
	}

	var req struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid request", "")
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
		writeError(w, http.StatusInternalServerError, "internal_error", "database error", "")
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

func (s *Server) handleTagFile(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized", "")
		return
	}

	var req struct {
		TagID  string   `json:"tag_id"`
		RootID string   `json:"root_id"`
		Paths  []string `json:"paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TagID == "" || req.RootID == "" || len(req.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid request", "")
		return
	}

	_, err := s.resolveAccess(r, req.RootID, true)
	if err != nil {
		writeError(w, http.StatusForbidden, "forbidden", "access denied", "")
		return
	}

	// Verify tag belongs to user
	var exists bool
	if err := s.DB.QueryRow(`SELECT 1 FROM tags WHERE id = ? AND user_id = ?`, req.TagID, user.ID).Scan(&exists); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "tag not found", "")
		return
	}

	tx, err := s.DB.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "database error", "")
		return
	}

	now := util.NowUTC()
	for _, p := range req.Paths {
		_, err := tx.Exec(`INSERT OR IGNORE INTO file_tags (tag_id, root_id, path, created_at) VALUES (?, ?, ?, ?)`,
			req.TagID, req.RootID, p, now)
		if err != nil {
			tx.Rollback()
			s.Log.Error("failed to tag file", "error", err)
			writeError(w, http.StatusInternalServerError, "internal_error", "database error", "")
			return
		}
	}
	tx.Commit()

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleUntagFile(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized", "")
		return
	}

	var req struct {
		TagID  string   `json:"tag_id"`
		RootID string   `json:"root_id"`
		Paths  []string `json:"paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TagID == "" || req.RootID == "" || len(req.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid request", "")
		return
	}

	_, err := s.resolveAccess(r, req.RootID, true)
	if err != nil {
		writeError(w, http.StatusForbidden, "forbidden", "access denied", "")
		return
	}

	// Verify tag belongs to user
	var exists bool
	if err := s.DB.QueryRow(`SELECT 1 FROM tags WHERE id = ? AND user_id = ?`, req.TagID, user.ID).Scan(&exists); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "tag not found", "")
		return
	}

	tx, err := s.DB.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "database error", "")
		return
	}

	for _, p := range req.Paths {
		_, err := tx.Exec(`DELETE FROM file_tags WHERE tag_id = ? AND root_id = ? AND path = ?`,
			req.TagID, req.RootID, p)
		if err != nil {
			tx.Rollback()
			s.Log.Error("failed to untag file", "error", err)
			writeError(w, http.StatusInternalServerError, "internal_error", "database error", "")
			return
		}
	}
	tx.Commit()

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

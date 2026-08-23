package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/util"
)

const maxCommentLength = 2000

type fileComment struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Body      string `json:"body"`
	CreatedAt string `json:"created_at"`
}

// listFileComments GET /files/comments?root=&path=
func (s *Server) listFileComments(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	rootID := queryParam(r, "root", "")
	path := queryParam(r, "path", "")
	if rootID == "" || path == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "root and path required", middleware.GetRequestID(r.Context()))
		return
	}
	if _, err := s.resolveAccess(r, rootID, false); err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	rows, err := s.DB.Query(
		`SELECT id, user_id, username, body, created_at FROM file_comments
		 WHERE root_id = ? AND path = ? ORDER BY created_at ASC LIMIT 200`,
		rootID, path,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not read comments", middleware.GetRequestID(r.Context()))
		return
	}
	defer rows.Close()
	items := []fileComment{}
	for rows.Next() {
		var c fileComment
		if err := rows.Scan(&c.ID, &c.UserID, &c.Username, &c.Body, &c.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "could not read comments", middleware.GetRequestID(r.Context()))
			return
		}
		items = append(items, c)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// createFileComment POST /files/comments {root, path, body}
func (s *Server) createFileComment(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	var body struct{ Root, Path, Body string }
	_ = json.NewDecoder(r.Body).Decode(&body)
	body.Root, body.Path, body.Body = strings.TrimSpace(body.Root), strings.TrimSpace(body.Path), strings.TrimSpace(body.Body)
	if body.Root == "" || body.Path == "" || body.Body == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "root, path and body are required", middleware.GetRequestID(r.Context()))
		return
	}
	if len(body.Body) > maxCommentLength {
		writeError(w, http.StatusBadRequest, "too_long", "comment too long", middleware.GetRequestID(r.Context()))
		return
	}
	// Commenting requires only read access to the target.
	if _, err := s.resolveAccess(r, body.Root, false); err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	id := util.NewID("cmt_", 12)
	if _, err := s.DB.Exec(
		`INSERT INTO file_comments (id, root_id, path, user_id, username, body, created_at) VALUES (?,?,?,?,?,?,?)`,
		id, body.Root, body.Path, user.ID, user.Username, body.Body, util.NowUTC(),
	); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not save comment", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "comment_add", body.Path, "")
	writeJSON(w, http.StatusCreated, map[string]any{
		"item": fileComment{ID: id, UserID: user.ID, Username: user.Username, Body: body.Body, CreatedAt: util.NowUTC()},
	})
}

// deleteFileComment DELETE /files/comments/{id} — own comment or admin.
func (s *Server) deleteFileComment(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	id := chi.URLParam(r, "id")
	var ownerID string
	err := s.DB.QueryRow(`SELECT user_id FROM file_comments WHERE id = ?`, id).Scan(&ownerID)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "comment not found", middleware.GetRequestID(r.Context()))
		return
	}
	if user.Role != "admin" && ownerID != user.ID {
		writeError(w, http.StatusForbidden, "forbidden", "not your comment", middleware.GetRequestID(r.Context()))
		return
	}
	if _, err := s.DB.Exec(`DELETE FROM file_comments WHERE id = ?`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not delete comment", middleware.GetRequestID(r.Context()))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

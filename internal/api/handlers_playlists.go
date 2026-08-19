package api

import (
	"mime"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/playlists"
	"github.com/nexora/nexora/internal/storage"
)

func (s *Server) hydratePlaylistItems(pls []playlists.Playlist) {
	// Collect unique (root, path) pairs to batch-hydrate size/modified from
	// the search index (single query instead of per-item stats).
	type key struct{ root, path string }
	seen := map[key]bool{}
	var keys []key

	for i, p := range pls {
		for j, item := range p.Items {
			name := storage.NameFromPath(item.Path)
			ext := storage.Ext(name)
			pls[i].Items[j].Name = name
			pls[i].Items[j].Extension = ext
			if ext != "" {
				pls[i].Items[j].Mime = mime.TypeByExtension("." + ext)
			}
			if pls[i].Items[j].Mime == "" {
				pls[i].Items[j].Mime = "application/octet-stream"
			}
			k := key{item.RootID, item.Path}
			if !seen[k] {
				seen[k] = true
				keys = append(keys, k)
			}
		}
	}
	if len(keys) == 0 {
		return
	}

	// Batch lookup in search_index (indexed on root_id+path). Items that
	// aren't indexed keep size 0 — the mobile client stats those on play.
	var sb strings.Builder
	sb.WriteString(`SELECT root_id, path, size, modified FROM search_index WHERE `)
	args := make([]any, 0, len(keys)*2)
	for i, k := range keys {
		if i > 0 {
			sb.WriteString(" OR ")
		}
		sb.WriteString("(root_id = ? AND path = ?)")
		args = append(args, k.root, k.path)
	}
	rows, err := s.DB.Query(sb.String(), args...)
	if err != nil {
		return // non-fatal: size/modified simply stay 0
	}
	defer rows.Close()

	sizeByKey := map[key]struct {
		size     int64
		modified string
	}{}
	for rows.Next() {
		var root, path, modified string
		var size int64
		if err := rows.Scan(&root, &path, &size, &modified); err != nil {
			continue
		}
		sizeByKey[key{root, path}] = struct {
			size     int64
			modified string
		}{size, modified}
	}
	rows.Close()

	for i, p := range pls {
		for j, item := range p.Items {
			if m, ok := sizeByKey[key{item.RootID, item.Path}]; ok {
				pls[i].Items[j].Size = m.size
				pls[i].Items[j].Modified = m.modified
			}
		}
	}
}

func (s *Server) handleListPlaylists(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	pls, err := s.Playlists.ListForUser(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to list playlists", middleware.GetRequestID(r.Context()))
		return
	}

	s.hydratePlaylistItems(pls)
	writeJSON(w, http.StatusOK, map[string]any{"items": pls})
}

func (s *Server) handleListPublicPlaylists(w http.ResponseWriter, r *http.Request) {
	pls, err := s.Playlists.ListPublic()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to list public playlists", middleware.GetRequestID(r.Context()))
		return
	}

	s.hydratePlaylistItems(pls)
	writeJSON(w, http.StatusOK, map[string]any{"items": pls})
}

func (s *Server) handleCreatePlaylist(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	// Any authenticated user may create their own playlists.
	var req struct {
		Name  string                   `json:"name"`
		Items []playlists.PlaylistItem `json:"items"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	if req.Name == "" {
		req.Name = "New playlist"
	}

	pl, err := s.Playlists.Create(user.ID, req.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to create playlist", middleware.GetRequestID(r.Context()))
		return
	}

	if len(req.Items) > 0 {
		if _, err := s.Playlists.AddItems(user.ID, pl.ID, req.Items); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Failed to add items to playlist", middleware.GetRequestID(r.Context()))
			return
		}
		// Refresh items
		pls, _ := s.Playlists.ListForUser(user.ID)
		for _, p := range pls {
			if p.ID == pl.ID {
				pl = &p
				break
			}
		}
	}

	writeJSON(w, http.StatusOK, pl)
}

func (s *Server) handleDeletePlaylist(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	id := chi.URLParam(r, "id")

	// Only owner or admin can delete
	if user.Role != auth.RoleAdmin {
		var ownerID string
		err := s.DB.QueryRow(`SELECT user_id FROM playlists WHERE id = ?`, id).Scan(&ownerID)
		if err != nil || ownerID != user.ID {
			writeError(w, http.StatusForbidden, "forbidden", "Only the playlist owner or admin can delete", middleware.GetRequestID(r.Context()))
			return
		}
	}

	if err := s.Playlists.Delete(user.ID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to delete playlist", middleware.GetRequestID(r.Context()))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleRenamePlaylist(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	id := chi.URLParam(r, "id")
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	// Owners and editor collaborators may rename.
	if user.Role != auth.RoleAdmin && !s.Playlists.CanEdit(user.ID, id) {
		writeError(w, http.StatusForbidden, "forbidden", "Only the playlist owner or editors can rename", middleware.GetRequestID(r.Context()))
		return
	}

	if err := s.Playlists.Rename(user.ID, id, req.Name); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to rename playlist", middleware.GetRequestID(r.Context()))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleUpdatePlaylist(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	id := chi.URLParam(r, "id")

	// Only owner or admin can update
	if user.Role != auth.RoleAdmin {
		var ownerID string
		err := s.DB.QueryRow(`SELECT user_id FROM playlists WHERE id = ?`, id).Scan(&ownerID)
		if err != nil || ownerID != user.ID {
			writeError(w, http.StatusForbidden, "forbidden", "Only the playlist owner or admin can update settings", middleware.GetRequestID(r.Context()))
			return
		}
	}

	var req struct {
		CoverRootID *string `json:"cover_root_id"`
		CoverPath   *string `json:"cover_path"`
		IsPublic    *bool   `json:"is_public"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	// Cover changes are allowed for owner/editors; visibility stays owner/admin.
	if req.CoverRootID != nil && req.CoverPath != nil {
		if user.Role != auth.RoleAdmin && !s.Playlists.CanEdit(user.ID, id) {
			writeError(w, http.StatusForbidden, "forbidden", "You don't have permission to update this playlist", middleware.GetRequestID(r.Context()))
			return
		}
		if err := s.Playlists.SetCover(user.ID, id, *req.CoverRootID, *req.CoverPath); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Failed to update cover", middleware.GetRequestID(r.Context()))
			return
		}
	}

	if req.IsPublic != nil {
		if user.Role != auth.RoleAdmin {
			var ownerID string
			err := s.DB.QueryRow(`SELECT user_id FROM playlists WHERE id = ?`, id).Scan(&ownerID)
			if err != nil || ownerID != user.ID {
				writeError(w, http.StatusForbidden, "forbidden", "Only the playlist owner or admin can change visibility", middleware.GetRequestID(r.Context()))
				return
			}
		}
		if err := s.Playlists.SetPublic(user.ID, id, *req.IsPublic); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Failed to update visibility", middleware.GetRequestID(r.Context()))
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAddPlaylistItems(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	id := chi.URLParam(r, "id")

	// Check edit permission (owner, collaborator, or admin)
	if user.Role != auth.RoleAdmin && !s.Playlists.CanEdit(user.ID, id) {
		writeError(w, http.StatusForbidden, "forbidden", "You don't have permission to edit this playlist", middleware.GetRequestID(r.Context()))
		return
	}

	var req struct {
		Items []playlists.PlaylistItem `json:"items"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	added, err := s.Playlists.AddItems(user.ID, id, req.Items)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	skipped := len(req.Items) - added
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "added": added, "skipped": skipped})
}

func (s *Server) handleRemovePlaylistItem(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	id := chi.URLParam(r, "id")

	// Check edit permission
	if user.Role != auth.RoleAdmin && !s.Playlists.CanEdit(user.ID, id) {
		writeError(w, http.StatusForbidden, "forbidden", "You don't have permission to edit this playlist", middleware.GetRequestID(r.Context()))
		return
	}

	itemID := queryParam(r, "item_id", "")
	if itemID == "" {
		writeError(w, http.StatusBadRequest, "invalid_param", "item_id is required", middleware.GetRequestID(r.Context()))
		return
	}

	if err := s.Playlists.RemoveItem(user.ID, id, itemID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleManageCollaborators(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	// Only admin can manage collaborators
	if user.Role != auth.RoleAdmin {
		var ownerID string
		id := chi.URLParam(r, "id")
		err := s.DB.QueryRow(`SELECT user_id FROM playlists WHERE id = ?`, id).Scan(&ownerID)
		if err != nil || ownerID != user.ID {
			writeError(w, http.StatusForbidden, "forbidden", "Only the playlist owner or admin can manage collaborators", middleware.GetRequestID(r.Context()))
			return
		}
	}

	id := chi.URLParam(r, "id")
	var req struct {
		Action string `json:"action"` // "add" or "remove"
		UserID string `json:"user_id"`
		Role   string `json:"role"` // "editor" or "viewer"
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	switch req.Action {
	case "add":
		if req.Role == "" {
			req.Role = "editor"
		}
		if err := s.Playlists.AddCollaborator(user.ID, id, req.UserID, req.Role); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(r.Context()))
			return
		}
	case "remove":
		if err := s.Playlists.RemoveCollaborator(user.ID, id, req.UserID); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(r.Context()))
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "invalid_action", "action must be 'add' or 'remove'", middleware.GetRequestID(r.Context()))
		return
	}

	collabs, _ := s.Playlists.ListCollaborators(id)
	writeJSON(w, http.StatusOK, map[string]any{"collaborators": collabs})
}

func (s *Server) handleCoverConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"cover_path": s.Cfg.PlaylistCoverPath})
}

func (s *Server) handleListCollaborators(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	id := chi.URLParam(r, "id")
	// Owner, admins and editor collaborators may view the collaborator list.
	if user.Role != auth.RoleAdmin && !s.Playlists.CanEdit(user.ID, id) {
		writeError(w, http.StatusForbidden, "forbidden", "You don't have permission to view collaborators", middleware.GetRequestID(r.Context()))
		return
	}
	collabs, err := s.Playlists.ListCollaborators(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to list collaborators", middleware.GetRequestID(r.Context()))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"collaborators": collabs})
}

// handleUserSearch finds users by username prefix for the playlist collaborator
// picker. Only id + username are returned — no emails or roles.
func (s *Server) handleUserSearch(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	q := strings.TrimSpace(queryParam(r, "q", ""))
	if q == "" {
		writeJSON(w, http.StatusOK, map[string]any{"users": []map[string]string{}})
		return
	}
	like := "%" + q + "%"
	rows, err := s.DB.Query(`SELECT id, username FROM users WHERE username LIKE ? AND id != ? ORDER BY username LIMIT 10`, like, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to search users", middleware.GetRequestID(r.Context()))
		return
	}
	defer rows.Close()
	users := make([]map[string]string, 0, 10)
	for rows.Next() {
		var id, username string
		if err := rows.Scan(&id, &username); err != nil {
			continue
		}
		users = append(users, map[string]string{"id": id, "username": username})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

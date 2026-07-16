package api

import (
	"mime"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/playlists"
	"github.com/nexora/nexora/internal/storage"
)

func (s *Server) handleListPlaylists(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	pls, err := s.Playlists.List(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to list playlists", middleware.GetRequestID(r.Context()))
		return
	}

	// We need to hydrate the items with search_index data so the frontend has full FileItems.
	// But to avoid complex queries here, we can just return what we have, and let the frontend
	// fetch the actual file items if needed, OR we can hydrate them here.
	// The frontend FileItem needs name, is_dir, size, mime, extension.
	// We can fetch from search index.
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
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": pls})
}

func (s *Server) handleCreatePlaylist(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

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
		if err := s.Playlists.AddItems(user.ID, pl.ID, req.Items); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Failed to add items to playlist", middleware.GetRequestID(r.Context()))
			return
		}
		// Refresh items
		pls, _ := s.Playlists.List(user.ID)
		for _, p := range pls {
			if p.ID == pl.ID {
				pl = &p
				break
			}
		}
	} else {
		// If no items were added, we just return the empty playlist.
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

	if err := s.Playlists.Rename(user.ID, id, req.Name); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to rename playlist", middleware.GetRequestID(r.Context()))
		return
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
	var req struct {
		Items []playlists.PlaylistItem `json:"items"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	if err := s.Playlists.AddItems(user.ID, id, req.Items); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleRemovePlaylistItem(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	id := chi.URLParam(r, "id")
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

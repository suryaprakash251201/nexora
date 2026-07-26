package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/events"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/util"
)

// handleListWebhooks returns all registered webhook targets.
func (s *Server) handleListWebhooks(w http.ResponseWriter, r *http.Request) {
	_, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	// Webhooks managed in-process (not persisted yet)
	// For now return empty list
	writeJSON(w, http.StatusOK, map[string]any{"webhooks": []events.WebhookTarget{}})
}

// handleCreateWebhook registers a new webhook target.
func (s *Server) handleCreateWebhook(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.Role != "admin" {
		writeError(w, http.StatusForbidden, "forbidden", "Admin access required", middleware.GetRequestID(r.Context()))
		return
	}

	var req struct {
		URL    string   `json:"url"`
		Secret string   `json:"secret"`
		Events []string `json:"events"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "invalid_url", "url is required", middleware.GetRequestID(r.Context()))
		return
	}

	wh := events.WebhookTarget{
		ID:     util.NewID("wh_", 12),
		URL:    req.URL,
		Secret: req.Secret,
		Active: true,
		Events: req.Events,
	}

	if s.Events != nil {
		s.Events.RegisterWebhook(wh)
	}

	s.audit(r, "webhook_create", wh.ID, wh.URL)
	writeJSON(w, http.StatusCreated, map[string]any{"webhook": wh})
}

// handleDeleteWebhook removes a webhook target.
func (s *Server) handleDeleteWebhook(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.Role != "admin" {
		writeError(w, http.StatusForbidden, "forbidden", "Admin access required", middleware.GetRequestID(r.Context()))
		return
	}

	id := chi.URLParam(r, "id")
	if s.Events != nil {
		s.Events.UnregisterWebhook(id)
	}

	s.audit(r, "webhook_delete", id, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
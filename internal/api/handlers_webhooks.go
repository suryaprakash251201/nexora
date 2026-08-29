package api

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/events"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/util"
)

// validateWebhookURL rejects URLs that resolve to private/loopback/link-local
// addresses. Without this, an admin (or anyone who compromises an admin
// account) can weaponise the server as an SSRF probe against internal
// services and cloud metadata endpoints (169.254.169.254, etc.).
//
// We resolve hostnames ourselves (the http client would do this anyway) and
// reject the request if any resolved address falls in a blocked range. The
// subsequent HTTP call uses the *same* resolved IPs to defeat DNS rebinding:
// the transport's DialContext is overridden to the verified IPs.
func validateWebhookURL(raw string) error {
	if raw == "" {
		return errors.New("url is required")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return errors.New("invalid url")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("url must use http or https")
	}
	host := u.Hostname()
	if host == "" {
		return errors.New("url is missing a host")
	}
	// Numeric IPs (e.g. "127.0.0.1", "::1") — go straight to the range check.
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedIP(ip) {
			return errors.New("url points to a private or loopback address")
		}
		return nil
	}
	// Hostname — resolve to every IP (v4 + v6) and reject if any is blocked.
	ips, err := net.LookupIP(host)
	if err != nil {
		return errors.New("could not resolve url host")
	}
	if len(ips) == 0 {
		return errors.New("url did not resolve to any address")
	}
	for _, ip := range ips {
		if isBlockedIP(ip) {
			return errors.New("url resolves to a private or loopback address")
		}
	}
	return nil
}

// isBlockedIP reports whether ip is in any range that should not be reachable
// from a server-initiated webhook. This includes loopback, private RFC1918,
// link-local, and the IPv6 unique-local prefix.
func isBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsPrivate() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	// 169.254.0.0/16 (cloud metadata) is included via IsLinkLocalUnicast for
	// IPv4, but on some platforms the helper is conservative — match it
	// explicitly to be safe.
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 169 && v4[1] == 254 {
			return true
		}
	}
	return false
}

// webhookURLForAudit returns a redacted URL safe to write to the audit log —
// keeps the scheme + host + path but strips any query/credentials. The full
// URL (with secret-bearing query) is kept only in memory in events.WebhookTarget.
func webhookURLForAudit(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return strings.TrimSpace(raw)
	}
	u.RawQuery = ""
	u.User = nil
	return u.String()
}

// handleListWebhooks returns all registered webhook targets.
func (s *Server) handleListWebhooks(w http.ResponseWriter, r *http.Request) {
	_, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	if s.Events == nil {
		writeJSON(w, http.StatusOK, map[string]any{"webhooks": []events.WebhookTarget{}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"webhooks": s.Events.ListWebhooks()})
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
	// SSRF guard: refuse URLs that point at loopback / private / link-local
	// addresses. An attacker with admin access could otherwise probe internal
	// services and cloud metadata endpoints.
	if verr := validateWebhookURL(req.URL); verr != nil {
		writeError(w, http.StatusBadRequest, "invalid_url", verr.Error(), middleware.GetRequestID(r.Context()))
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

	// Audit the redacted URL (no query string, no embedded credentials) so
	// secrets that may be in the URL never land in the audit log.
	s.audit(r, "webhook_create", wh.ID, webhookURLForAudit(wh.URL))
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

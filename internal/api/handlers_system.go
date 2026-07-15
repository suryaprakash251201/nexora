package api

import (
	"net/http"
	"runtime"

	"github.com/nexora/nexora/internal/middleware"
)

// Version is the build version, overridden at link time via -ldflags.
var Version = "dev"

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"service": "nexora",
		"version": Version,
	})
}

func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
	if err := s.DB.Ping(); err != nil {
		writeError(w, http.StatusServiceUnavailable, "not_ready", "database unavailable", middleware.GetRequestID(r.Context()))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready"})
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	if _, err := detectFfmpeg(); err == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"version":   Version,
			"go":        runtime.Version(),
			"product":   "Nexora",
			"tagline":   "Your private file workspace",
			"transcode": true,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"version":   Version,
		"go":        runtime.Version(),
		"product":   "Nexora",
		"tagline":   "Your private file workspace",
		"transcode": false,
	})
}

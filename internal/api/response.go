// Package api implements the versioned REST API (mounted under /api/v1) and the
// embedded static file server for the web UI.
package api

import (
	"encoding/json"
	"net/http"
)

// APIError is the consistent error envelope returned to clients.
type APIError struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
	Request string `json:"request,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, message, requestID string) {
	err := APIError{Error: code, Message: message, Request: requestID}
	writeJSON(w, status, err)
}

// Page is a cursor-style pagination result for list endpoints.
type Page struct {
	Items    any    `json:"items"`
	Next     string `json:"next,omitempty"`
	Prev     string `json:"prev,omitempty"`
	Total    int    `json:"total,omitempty"`
	HasMore  bool   `json:"has_more"`
}

func writePage(w http.ResponseWriter, p Page) {
	writeJSON(w, http.StatusOK, p)
}

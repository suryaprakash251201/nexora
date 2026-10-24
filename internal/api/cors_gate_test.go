package api

import (
	"net/http/httptest"
	"testing"

	"github.com/nexora/nexora/internal/config"
)

// The fallback allow-any-origin CORS mode must never allow credentials:
// a reflected origin plus Allow-Credentials lets any website read
// authenticated responses with the victim's cookies.
func TestCORS_FallbackModeStripsCredentials(t *testing.T) {
	h := newSecHarness(t, &config.Config{}) // no CORSOrigins -> allow-any fallback

	req := httptest.NewRequest("GET", "/api/v1/auth/needs-setup", nil)
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("fallback allow-any mode must strip credentials, got %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got == "" {
		t.Fatal("fallback mode should still echo an origin for token-based clients")
	}
}

func TestCORS_ConfiguredOriginKeepsCredentials(t *testing.T) {
	cfg := &config.Config{CORSOrigins: []string{"https://app.example"}}
	h := newSecHarness(t, cfg)

	// Matching origin keeps credentials.
	req := httptest.NewRequest("GET", "/api/v1/auth/needs-setup", nil)
	req.Header.Set("Origin", "https://app.example")
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("configured origin must keep credentials, got %q", got)
	}

	// Non-matching origin gets no credentials (and no allow-origin either).
	req2 := httptest.NewRequest("GET", "/api/v1/auth/needs-setup", nil)
	req2.Header.Set("Origin", "https://evil.example")
	rec2 := httptest.NewRecorder()
	h.handler.ServeHTTP(rec2, req2)
	if got := rec2.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("non-matching origin must not get credentials, got %q", got)
	}

	// Wildcard in the configured list is not an exact match, so credentials
	// stay stripped (browsers reject "*"+credentials anyway).
	cfg.CORSOrigins = []string{"*"}
	req3 := httptest.NewRequest("GET", "/api/v1/auth/needs-setup", nil)
	req3.Header.Set("Origin", "https://evil.example")
	rec3 := httptest.NewRecorder()
	h.handler.ServeHTTP(rec3, req3)
	if got := rec3.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("wildcard origin must not get credentials, got %q", got)
	}
}

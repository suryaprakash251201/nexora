package api

// Regression tests for the auth/session hardening pass:
//
//  1. Tailscale identity headers are forgeable by anyone who can reach the
//     listener — they must only be honored from loopback or a trusted proxy,
//     and the asserted identity must be validated/sanitized.
//  2. Passwords need a strength floor (letters+digits, common-password
//     denylist), not just a minimum length.
//  3. Password-reset codes are returned in-band (no mail channel), so the
//     endpoint needs a per-account throttle, single-active-token semantics,
//     and must never log token material.
//  4. A raw session token in `?token=` must not exempt unsafe methods from
//     CSRF (URLs leak via Referer/history/logs); only nxr_ API tokens do.
//  5. TOTP enrollment must not silently overwrite an active second factor,
//     and enrollment codes must be throttle-guarded.
//  6. Login lockout must be scoped to account+IP so one attacker cannot
//     hard-lock a victim's account from across the network.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nexora/nexora/internal/audit"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/config"
	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/playlists"
	"github.com/nexora/nexora/internal/storage"
)

type secHarness struct {
	handler  http.Handler
	server   *Server
	sessions *auth.SessionStore
	users    *auth.UserStore
}

func newSecHarness(t *testing.T, cfg *config.Config) *secHarness {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := database.Open("sqlite", dbPath, "")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	users := auth.NewUserStore(db)
	sessions := auth.NewSessionStore(db, 24*time.Hour)
	if cfg == nil {
		cfg = &config.Config{}
	}
	s := NewServer(Deps{
		Cfg:       cfg,
		Log:       logger.New("error", "test"),
		DB:        db,
		Users:     users,
		Sessions:  sessions,
		Tokens:    auth.NewTokenStore(db),
		Audit:     audit.NewStore(db),
		Guard:     auth.NewLoginGuard(5, 15*time.Minute),
		Limiter:   middleware.NewRateLimiter(1000, time.Minute),
		Roots:     storage.NewRootService(db),
		Playlists: playlists.NewStore(db),
	})
	return &secHarness{handler: s.Routes(), server: s, sessions: sessions, users: users}
}

func (h *secHarness) createUser(t *testing.T, username, email, password string) auth.User {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	u, err := h.users.Create(auth.User{
		Username: username, Email: email, DisplayName: username,
		PasswordHash: hash, Role: auth.RoleUser, Status: "active",
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u
}

func (h *secHarness) sessionCookie(t *testing.T, userID string) *http.Cookie {
	t.Helper()
	sess, err := h.sessions.Create(userID, "127.0.0.1", "test")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	return &http.Cookie{Name: auth.SessionCookieName, Value: sess.Token, Path: "/"}
}

// csrfFor performs a safe request to mint the double-submit CSRF cookie.
func (h *secHarness) csrfFor(t *testing.T, sessionCookie *http.Cookie) *http.Cookie {
	t.Helper()
	preReq := httptest.NewRequest("GET", "/api/v1/auth/session", nil)
	if sessionCookie != nil {
		preReq.AddCookie(sessionCookie)
	}
	pre := httptest.NewRecorder()
	h.handler.ServeHTTP(pre, preReq)
	for _, c := range pre.Result().Cookies() {
		if c.Name == "nexora_csrf" {
			return c
		}
	}
	t.Fatal("no csrf cookie issued")
	return nil
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&m); err != nil {
		t.Fatalf("decode body: %v (body %q)", err, rec.Body.String())
	}
	return m
}

// --- 1. Tailscale -----------------------------------------------------------

func TestTailscaleLogin_RejectsUntrustedPeer(t *testing.T) {
	h := newSecHarness(t, &config.Config{TailscaleAuth: true})

	req := httptest.NewRequest("POST", "/api/v1/auth/tailscale", nil)
	req.RemoteAddr = "203.0.113.7:443" // routable public peer, not loopback
	req.Header.Set("Tailscale-User-Login", "victim@example.com")
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("spoofed tailscale login: got %d, want 403 (body %s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "tailscale_untrusted_peer") {
		t.Fatalf("expected tailscale_untrusted_peer code, got %s", rec.Body.String())
	}
}

func TestTailscaleLogin_AcceptsLoopbackAndSanitizes(t *testing.T) {
	h := newSecHarness(t, &config.Config{TailscaleAuth: true})

	req := httptest.NewRequest("POST", "/api/v1/auth/tailscale", nil)
	req.RemoteAddr = "127.0.0.1:45231"
	req.Header.Set("Tailscale-User-Login", "Bob.Smith+tag@Example.COM")
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("loopback tailscale login: got %d (body %s)", rec.Code, rec.Body.String())
	}
	m := decodeBody(t, rec)
	user := m["user"].(map[string]any)
	if user["username"] != "bob.smithtag" {
		t.Fatalf("username not sanitized: got %q", user["username"])
	}
	if user["role"] != "user" {
		t.Fatalf("auto-provisioned role must be user, got %q", user["role"])
	}
}

func TestTailscaleLogin_RejectsMalformedIdentity(t *testing.T) {
	h := newSecHarness(t, &config.Config{TailscaleAuth: true})

	req := httptest.NewRequest("POST", "/api/v1/auth/tailscale", nil)
	req.RemoteAddr = "127.0.0.1:45231"
	// Bypass client-side header validation to simulate a raw malicious value.
	req.Header["Tailscale-User-Login"] = []string{"evil@example.com\nX-Injected: 1"}
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatal("CRLF-laden identity header was accepted")
	}
}

func TestTailscalePeerAllowed_Table(t *testing.T) {
	mk := func(remote string) *http.Request {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = remote
		return r
	}
	if !tailscalePeerAllowed(mk("127.0.0.1:8080"), nil) {
		t.Error("loopback IPv4 must be allowed")
	}
	if !tailscalePeerAllowed(mk("[::1]:8080"), nil) {
		t.Error("loopback IPv6 must be allowed")
	}
	if tailscalePeerAllowed(mk("203.0.113.7:443"), nil) {
		t.Error("public peer must not be allowed without trusted proxies")
	}
	if tailscalePeerAllowed(mk("192.168.1.10:443"), nil) {
		t.Error("LAN peer must not be allowed without trusted proxies")
	}
	if !tailscalePeerAllowed(mk("10.1.2.3:99"), []string{"10.0.0.0/8"}) {
		t.Error("peer inside trusted CIDR must be allowed")
	}
	if tailscalePeerAllowed(mk("11.1.2.3:99"), []string{"10.0.0.0/8"}) {
		t.Error("peer outside trusted CIDR must not be allowed")
	}
}

func TestSanitizeTailscaleUsername_Table(t *testing.T) {
	cases := map[string]string{
		"Alice":       "alice",
		"Bob.Smith-2": "bob.smith-2",
		"ab":          "",    // too short
		"a@b!c":       "abc", // @ and ! stripped, remainder valid
		"../evil":     "evil",
		"":            "",
	}
	for in, want := range cases {
		if got := sanitizeTailscaleUsername(in); got != want {
			t.Errorf("sanitize(%q) = %q, want %q", in, got, want)
		}
	}
}

// --- 2. Password policy -----------------------------------------------------

func TestValidatePassword_Strength(t *testing.T) {
	reject := []string{
		"short1",                  // < 8
		"abcdefgh",                // no digit
		"12345678",                // no letter
		"password123",             // denylist
		"Qwerty123",               // denylist (case-insensitive)
		"!!!!!!!!",                // neither
		strings.Repeat("a1", 200), // > 256
	}
	for _, pw := range reject {
		if err := validatePassword(pw); err == nil {
			t.Errorf("validatePassword(%q) accepted, want rejection", pw)
		}
	}
	accept := []string{"s3cureP4ss!", "correct-horse-9", "N3xora-Rocks-2026"}
	for _, pw := range accept {
		if err := validatePassword(pw); err != nil {
			t.Errorf("validatePassword(%q) rejected: %v", pw, err)
		}
	}
}

// --- 5. TOTP ----------------------------------------------------------------

func TestTOTPSetup_BlockedWhenAlreadyEnabled(t *testing.T) {
	h := newSecHarness(t, nil)
	u, err := h.users.Create(auth.User{
		Username: "totpuser", Email: "totp@x", DisplayName: "totpuser",
		PasswordHash: "x", Role: auth.RoleUser, Status: "active",
		TOTPSecret: "JBSWY3DPEHPK3PXP", TOTPEnabled: true,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	sessCookie := h.sessionCookie(t, u.ID)
	csrfCookie := h.csrfFor(t, sessCookie)

	req := httptest.NewRequest("POST", "/api/v1/auth/totp/setup", nil)
	req.AddCookie(sessCookie)
	req.AddCookie(csrfCookie)
	req.Header.Set("X-CSRF-Token", csrfCookie.Value)
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("setup over enabled 2FA: got %d, want 409 (body %s)", rec.Code, rec.Body.String())
	}
}

// --- 6. Lockout scope -------------------------------------------------------

func TestLoginLockout_ScopedToAccountAndIP(t *testing.T) {
	h := newSecHarness(t, nil)
	h.createUser(t, "alice", "alice@x", "Validpass1")

	badLogin := func(remoteAddr string) int {
		req := httptest.NewRequest("POST", "/api/v1/auth/login",
			strings.NewReader(`{"login":"alice","password":"wrongpass1"}`))
		req.RemoteAddr = remoteAddr
		rec := httptest.NewRecorder()
		h.handler.ServeHTTP(rec, req)
		return rec.Code
	}

	// Exhaust the allowance from one source IP: 5x401 then lockout.
	for i := 0; i < 5; i++ {
		if code := badLogin("10.9.9.1:1111"); code != http.StatusUnauthorized {
			t.Fatalf("attempt %d from attacker IP: got %d, want 401", i+1, code)
		}
	}
	if code := badLogin("10.9.9.1:1111"); code != http.StatusTooManyRequests {
		t.Fatalf("6th attempt from attacker IP: got %d, want 429", code)
	}
	// The same account from a different IP must NOT be locked out.
	if code := badLogin("10.9.9.2:2222"); code != http.StatusUnauthorized {
		t.Fatalf("attempt from victim IP: got %d, want 401 (lockout leaked across IPs)", code)
	}
}

// --- 3. Reset flow ----------------------------------------------------------

func TestForgotPassword_SecondCodeInvalidatesFirst(t *testing.T) {
	h := newSecHarness(t, nil)
	h.createUser(t, "bob", "bob@x", "Validpass1")

	forgot := func() string {
		req := httptest.NewRequest("POST", "/api/v1/auth/forgot-password",
			strings.NewReader(`{"login":"bob"}`))
		req.RemoteAddr = "10.8.8.8:3333"
		rec := httptest.NewRecorder()
		h.handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("forgot-password: got %d (body %s)", rec.Code, rec.Body.String())
		}
		m := decodeBody(t, rec)
		tok, _ := m["token"].(string)
		if tok == "" {
			t.Fatal("forgot-password response missing token")
		}
		return tok
	}

	first := forgot()
	second := forgot()
	if first == second {
		t.Fatal("expected distinct reset codes")
	}

	reset := func(token, pw string) int {
		body := `{"token":` + jsonStr(token) + `,"password":` + jsonStr(pw) + `}`
		req := httptest.NewRequest("POST", "/api/v1/auth/reset-password", strings.NewReader(body))
		req.RemoteAddr = "10.8.8.8:3333"
		rec := httptest.NewRecorder()
		h.handler.ServeHTTP(rec, req)
		return rec.Code
	}

	if code := reset(first, "Newpass123"); code != http.StatusBadRequest {
		t.Fatalf("stale reset code: got %d, want 400 invalid_token", code)
	}
	if code := reset(second, "Newpass123"); code != http.StatusOK {
		t.Fatalf("current reset code: got %d, want 200", code)
	}
}

func jsonStr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// --- 4. CSRF ----------------------------------------------------------------

func TestCSRF_SessionTokenInQueryNotExempt(t *testing.T) {
	h := newSecHarness(t, nil)
	u := h.createUser(t, "carol", "carol@x", "Validpass1")
	sessCookie := h.sessionCookie(t, u.ID)
	raw := sessCookie.Value

	// Unsafe method with a raw session token in ?token= and no CSRF header
	// must be rejected (previously it bypassed CSRF entirely).
	req := httptest.NewRequest("POST", "/api/v1/auth/logout?token="+raw, nil)
	req.AddCookie(sessCookie)
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST with session ?token= and no CSRF header: got %d, want 403", rec.Code)
	}

	// Safe methods with ?token= must still authenticate (mobile media URLs).
	getReq := httptest.NewRequest("GET", "/api/v1/auth/session?token="+raw, nil)
	getRec := httptest.NewRecorder()
	h.handler.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET with session ?token=: got %d, want 200", getRec.Code)
	}
	m := decodeBody(t, getRec)
	user, ok := m["user"].(map[string]any)
	if !ok || user["username"] != "carol" {
		t.Fatalf("GET with session ?token= did not authenticate: %s", getRec.Body.String())
	}
}

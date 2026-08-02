package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// newCSRFCookie GETs the handler so it populates the double-submit cookie,
// then returns that cookie.
func newCSRFCookie(t *testing.T, srv *httptest.Server) *http.Cookie {
	t.Helper()
	resp, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatalf("GET failed: %v", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	for _, c := range resp.Cookies() {
		if c.Name == csrfCookieName {
			return c
		}
	}
	t.Fatalf("no %s cookie in response", csrfCookieName)
	return nil
}

func doCSRF(srv *httptest.Server, method string, cookies []*http.Cookie, header string, bearer string) *http.Response {
	req, _ := http.NewRequest(method, srv.URL+"/", nil)
	if header != "" {
		req.Header.Set("X-CSRF-Token", header)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return resp
}

func TestCSRFUnsafeMethodRequiresToken(t *testing.T) {
	h := CSRF(nil, false)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	srv := httptest.NewServer(h)
	defer srv.Close()

	// POST with no cookie and no token -> rejected.
	if resp := doCSRF(srv, http.MethodPost, nil, "", ""); resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for unsafe method without token, got %v", resp)
	}

	// POST with a matching double-submit cookie + header -> allowed.
	cookie := newCSRFCookie(t, srv)
	resp := doCSRF(srv, http.MethodPost, []*http.Cookie{cookie}, cookie.Value, "")
	if resp == nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 with matching token, got %v", resp)
	}

	// POST with cookie but wrong header -> rejected.
	cookie2 := newCSRFCookie(t, srv)
	if resp := doCSRF(srv, http.MethodPost, []*http.Cookie{cookie2}, "wrong", ""); resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 with mismatched token, got %v", resp)
	}
}

func TestCSRFBearerAuthSkipsValidation(t *testing.T) {
	h := CSRF(nil, false)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	srv := httptest.NewServer(h)
	defer srv.Close()

	// POST authenticated only by a bearer token must not be rejected for CSRF,
	// even with no X-CSRF-Token header (token auth is CSRF-immune).
	resp := doCSRF(srv, http.MethodPost, nil, "", "some-token")
	if resp == nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for bearer-authenticated unsafe request, got %v", resp)
	}
}

func TestCSRFGetAlwaysAllowed(t *testing.T) {
	h := CSRF(nil, false)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	srv := httptest.NewServer(h)
	defer srv.Close()
	if resp := doCSRF(srv, http.MethodGet, nil, "", ""); resp == nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for GET, got %v", resp)
	}
}

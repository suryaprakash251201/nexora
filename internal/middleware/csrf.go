package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
)

const csrfCookieName = "nexora_csrf"

// CSRF implements the double-submit cookie pattern. It issues a random token in
// a readable cookie and requires matching X-CSRF-Token header on unsafe
// methods. Paths whose prefix is in exempt are skipped (e.g. login, share).
func CSRF(exemptPrefixes []string, secure bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := getCookie(r, csrfCookieName)
			if token == "" {
				token = newToken()
				setCSRFCookie(w, token, secure)
			} else {
				setCSRFCookie(w, token, secure)
			}

			if isUnsafeMethod(r.Method) && !isExempt(r.URL.Path, exemptPrefixes) {
				header := r.Header.Get("X-CSRF-Token")
				if header == "" || !constantTimeEqual(header, token) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusForbidden)
					_, _ = w.Write([]byte(`{"error":"csrf_invalid","message":"Invalid or missing CSRF token"}`))
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func isUnsafeMethod(m string) bool {
	switch m {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

func isExempt(path string, exempt []string) bool {
	for _, p := range exempt {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}

func setCSRFCookie(w http.ResponseWriter, token string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     csrfCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: false, // readable by JS to send as header
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
		MaxAge:   86400 * 30,
	})
}

func getCookie(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return c.Value
}

func newToken() string {
	b := make([]byte, 24)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func constantTimeEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for i := 0; i < len(a); i++ {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}

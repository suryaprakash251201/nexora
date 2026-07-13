// Package auth provides HTTP middleware for session authentication built on top
// of the session and user stores.
package auth

import (
	"net/http"
	"strings"
)

const SessionCookieName = "nexora_session"

// SessionAuth enriches the request context with the authenticated user when a
// valid session cookie is present. It does not reject unauthenticated requests.
func SessionAuth(store *SessionStore, users *UserStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(SessionCookieName)
			if err == nil && cookie.Value != "" {
				if sess, ok := store.Lookup(cookie.Value); ok {
					if u, ok, _ := users.GetByID(sess.UserID); ok && u.IsAuthorized() {
						r = r.WithContext(withUser(r.Context(), u))
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAuth rejects requests without an authenticated, active user.
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := UserFromContext(r.Context())
		if !ok || !u.IsAuthorized() {
			writeJSONError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireRole restricts access to the given roles.
func RequireRole(roles ...Role) func(http.Handler) http.Handler {
	allowed := make(map[Role]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, ok := UserFromContext(r.Context())
			if !ok || !allowed[u.Role] {
				writeJSONError(w, http.StatusForbidden, "forbidden", "Insufficient permissions")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// writeJSONError writes a consistent JSON error envelope.
func writeJSONError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"error":` + quote(code) + `,"message":` + quote(message) + `}`))
}

func quote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

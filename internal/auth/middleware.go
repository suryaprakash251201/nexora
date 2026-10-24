// Package auth provides HTTP middleware for session authentication built on top
// of the session and user stores.
package auth

import (
	"net/http"
	"strings"
)

const SessionCookieName = "nexora_session"

// SessionAuth enriches the request context with the authenticated user when a
// valid session cookie is present, or a personal API token bearer is valid.
// It does not reject unauthenticated requests.
func SessionAuth(store *SessionStore, users *UserStore, tokens *TokenStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var token string
			if cookie, err := r.Cookie(SessionCookieName); err == nil && cookie.Value != "" {
				token = cookie.Value
			} else if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
				token = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
			} else if acceptsQueryToken(r) {
				token = r.URL.Query().Get("token")
			}

			if token != "" {
				if sess, ok := store.Lookup(token); ok {
					if u, ok, _ := users.GetByID(sess.UserID); ok && u.IsAuthorized() {
						r = r.WithContext(withUser(r.Context(), u))
					}
				} else if tokens != nil && strings.HasPrefix(token, "nxr_") {
					// Personal API token (scripting access). Session lookup has
					// already failed; "nxr_" prefix avoids extra DB hits.
					if uid, ok := tokens.Lookup(token); ok {
						if u, ok, _ := users.GetByID(uid); ok && u.IsAuthorized() {
							r = r.WithContext(withUser(r.Context(), u))
						}
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// queryTokenPrefixes are the only routes that may authenticate via a
// `?token=` query parameter, and only for safe (read) methods. Tokens in
// URLs leak through server access logs, browser history and Referer
// headers, so query-token auth is limited to the read-only media/job
// endpoints whose clients genuinely cannot set Authorization headers
// (<video>/<img> elements, native PDF/media players, EventSource).
// Everything else must use the session cookie or a Bearer header.
var queryTokenPrefixes = []string{
	"/api/v1/files/raw",
	"/api/v1/files/thumbnail",
	"/api/v1/files/transcode",
	"/api/v1/files/hls/",
	"/api/v1/files/versions/",
	"/api/v1/audio/lyrics",
	"/api/v1/jobs/",
}

// acceptsQueryToken reports whether this request may authenticate with a
// session token carried in the URL query string.
func acceptsQueryToken(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if r.URL.Query().Get("token") == "" {
		return false
	}
	path := r.URL.Path
	for _, prefix := range queryTokenPrefixes {
		if !strings.HasPrefix(path, prefix) {
			continue
		}
		// Exact match, a prefix that already ends in '/', or a '/' right
		// after the prefix. This stops look-alike paths ("/files/rawish")
		// from sneaking in on a media prefix.
		if len(path) == len(prefix) || prefix[len(prefix)-1] == '/' || path[len(prefix)] == '/' {
			return true
		}
	}
	return false
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

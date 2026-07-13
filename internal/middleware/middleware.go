package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/nexora/nexora/internal/config"
	"github.com/nexora/nexora/internal/logger"
)

// RequestID assigns a unique ID to every request and exposes it via header and
// context.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			b := make([]byte, 12)
			rand.Read(b)
			id = hex.EncodeToString(b)
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(WithRequestID(r.Context(), id)))
	})
}

// Recoverer catches panics and returns a generic 500 without leaking stack
// traces.
func Recoverer(log *logger.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic recovered", "path", r.URL.Path, "error", rec)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`{"error":"internal_error","message":"An unexpected error occurred"}`))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// SecurityHeaders applies secure defaults: CSP, HSTS-friendly headers,
// X-Content-Type-Options, Referrer-Policy, and frame restrictions.
func SecurityHeaders(cfg *config.Config) func(http.Handler) http.Handler {
	csp := buildCSP()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("Content-Security-Policy", csp)
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("Referrer-Policy", "same-origin")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
			if !strings.HasPrefix(r.URL.Path, "/api/") {
				h.Set("Cache-Control", "no-store")
			}
			next.ServeHTTP(w, r)
		})
	}
}

func buildCSP() string {
	return strings.Join([]string{
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"media-src 'self' blob: data:",
		"font-src 'self' data:",
		"connect-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"frame-ancestors 'none'",
		"form-action 'self'",
	}, "; ")
}

// RealIP resolves the real client IP taking trusted proxies into account.
func RealIP(trusted []string) func(http.Handler) http.Handler {
	cidrs := parseCIDRs(trusted)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := clientIP(r, cidrs)
			next.ServeHTTP(w, r.WithContext(SetClientIP(r.Context(), ip)))
		})
	}
}

func parseCIDRs(trusted []string) []*net.IPNet {
	var out []*net.IPNet
	for _, c := range trusted {
		if strings.Contains(c, "/") {
			if _, ipnet, err := net.ParseCIDR(c); err == nil {
				out = append(out, ipnet)
			}
		}
	}
	return out
}

func clientIP(r *http.Request, trusted []*net.IPNet) string {
	remote := r.RemoteAddr
	if host, _, err := net.SplitHostPort(remote); err == nil {
		remote = host
	}
	// If the immediate peer is not a trusted proxy, use RemoteAddr directly.
	if !isTrusted(remote, trusted) {
		return remote
	}
	// Otherwise trust X-Forwarded-For (leftmost public) or X-Real-IP.
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	return remote
}

func isTrusted(ipStr string, trusted []*net.IPNet) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	for _, n := range trusted {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// NoCache adds no-store headers to API responses.
func NoCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// Timeout wraps a handler with a request timeout via http.TimeoutHandler.
func Timeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.TimeoutHandler(next, d, `{"error":"timeout","message":"Request timed out"}`)
	}
}

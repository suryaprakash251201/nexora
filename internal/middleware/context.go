// Package middleware contains reusable HTTP middleware: request IDs, security
// headers, real-IP resolution for trusted proxies, panic recovery, rate
// limiting, and CSRF protection. It intentionally does not depend on the auth
// package to avoid import cycles.
package middleware

import "context"

type ctxKey string

const (
	requestIDKey ctxKey = "request_id"
	clientIPKey  ctxKey = "client_ip"
)

// WithRequestID returns a context carrying the given request ID.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

// GetRequestID returns the request ID or an empty string.
func GetRequestID(ctx context.Context) string {
	if v, ok := ctx.Value(requestIDKey).(string); ok {
		return v
	}
	return ""
}

// SetClientIP stores the resolved client IP in the context.
func SetClientIP(ctx context.Context, ip string) context.Context {
	return context.WithValue(ctx, clientIPKey, ip)
}

// GetClientIP returns the resolved client IP or an empty string.
func GetClientIP(ctx context.Context) string {
	if v, ok := ctx.Value(clientIPKey).(string); ok {
		return v
	}
	return ""
}

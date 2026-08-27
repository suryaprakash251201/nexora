package auth

import "context"

type ctxKey string

const userKey ctxKey = "user"

// UserFromContext returns the authenticated user stored in the context.
func UserFromContext(ctx context.Context) (User, bool) {
	if v, ok := ctx.Value(userKey).(User); ok {
		return v, true
	}
	return User{}, false
}

// withUser stores the authenticated user in the context.
func withUser(ctx context.Context, u User) context.Context {
	return WithUser(ctx, u)
}

// WithUser returns a context carrying the authenticated user. Exported so
// alternate auth paths (e.g. the S3 gateway authentication middleware, which
// verifies an AWS4-signature against a personal API token instead of a
// session cookie) can stamp the same context key the rest of the API reads.
func WithUser(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, userKey, u)
}

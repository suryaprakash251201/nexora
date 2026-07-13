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
	return context.WithValue(ctx, userKey, u)
}

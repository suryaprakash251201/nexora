package middleware

import (
	"net/http"
	"sync"
	"time"
)

// RateLimiter is an in-memory, per-key token-bucket limiter. It is adequate for
// a single-instance deployment; multi-instance setups should sit behind a proxy
// that also rate-limits.
type RateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*bucket
	rate     float64 // tokens per second
	burst    int
	lastSeen map[string]time.Time
	ttl      time.Duration
}

type bucket struct {
	tokens   float64
	last     time.Time
}

// NewRateLimiter creates a limiter with the given sustained rate and burst.
func NewRateLimiter(perMinute int, ttl time.Duration) *RateLimiter {
	rate := float64(perMinute) / 60.0
	if rate <= 0 {
		rate = 1
	}
	return &RateLimiter{
		buckets:  make(map[string]*bucket),
		rate:     rate,
		burst:    perMinute,
		lastSeen: make(map[string]time.Time),
		ttl:      ttl,
	}
}

// Allow reports whether a request for key may proceed, consuming a token.
func (r *RateLimiter) Allow(key string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	if b, ok := r.buckets[key]; ok {
		elapsed := now.Sub(b.last).Seconds()
		b.tokens += elapsed * r.rate
		if b.tokens > float64(r.burst) {
			b.tokens = float64(r.burst)
		}
		b.last = now
		if b.tokens >= 1 {
			b.tokens--
			r.lastSeen[key] = now
			return true
		}
		r.lastSeen[key] = now
		return false
	}
	r.buckets[key] = &bucket{tokens: float64(r.burst) - 1, last: now}
	r.lastSeen[key] = now
	return true
}

// Sweep removes stale buckets. Call periodically if the limiter is long-lived.
func (r *RateLimiter) Sweep() {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	for k, t := range r.lastSeen {
		if now.Sub(t) > r.ttl {
			delete(r.buckets, k)
			delete(r.lastSeen, k)
		}
	}
}

// RateLimit returns middleware limiting requests by the given key function.
func (rl *RateLimiter) RateLimit(keyFn func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := keyFn(r)
			if !rl.Allow(key) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", "60")
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"error":"rate_limited","message":"Too many requests, please slow down"}`))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// KeyByClientIP returns a key function based on resolved client IP.
func KeyByClientIP() func(*http.Request) string {
	return func(r *http.Request) string {
		return GetClientIP(r.Context())
	}
}

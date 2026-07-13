package auth

import (
	"sync"
	"time"
)

// LoginGuard implements in-memory exponential backoff for failed login
// attempts per account. It is sufficient for a single-instance deployment;
// behind a reverse proxy with sticky sessions the same instance serves a given
// client's retries.
type LoginGuard struct {
	mu        sync.Mutex
	attempts  map[string]int
	firstFail map[string]time.Time
	window    time.Duration
	maxTries  int
}

// NewLoginGuard returns a guard allowing maxTries within window before locking.
func NewLoginGuard(maxTries int, window time.Duration) *LoginGuard {
	return &LoginGuard{
		attempts:  make(map[string]int),
		firstFail: make(map[string]time.Time),
		window:    window,
		maxTries:  maxTries,
	}
}

// RecordFailure notes a failed attempt and returns the remaining lock duration
// (0 if still allowed).
func (g *LoginGuard) RecordFailure(key string) time.Duration {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	if t, ok := g.firstFail[key]; !ok || now.Sub(t) > g.window {
		g.firstFail[key] = now
		g.attempts[key] = 1
		return 0
	}
	g.attempts[key]++
	if g.attempts[key] > g.maxTries {
		// Exponential backoff: 2^(tries-maxTries) minutes, capped.
		over := g.attempts[key] - g.maxTries
		backoff := time.Duration(1<<min(over, 6)) * time.Minute
		return backoff
	}
	return 0
}

// RecordSuccess clears tracking for a key.
func (g *LoginGuard) RecordSuccess(key string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.attempts, key)
	delete(g.firstFail, key)
}

// IsLocked reports whether a key is currently locked and returns remaining time.
func (g *LoginGuard) IsLocked(key string) (bool, time.Duration) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	t, ok := g.firstFail[key]
	if !ok {
		return false, 0
	}
	if now.Sub(t) > g.window {
		delete(g.attempts, key)
		delete(g.firstFail, key)
		return false, 0
	}
	if g.attempts[key] > g.maxTries {
		return true, g.window - now.Sub(t)
	}
	return false, 0
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

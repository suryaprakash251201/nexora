// Package util holds small shared helpers used across the Nexora backend.
package util

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

// NowUTC returns the current time formatted in RFC3339 with UTC zone.
func NowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// ParseTime parses an RFC3339 timestamp; falls back to zero time on error.
func ParseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

// NewID returns a prefixed random identifier (prefix + hex token).
func NewID(prefix string, n int) string {
	return prefix + RandToken(n)
}

// RandToken returns a hex-encoded random token of n random bytes.
func RandToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand never fails in practice; keep a deterministic fallback
		// only to avoid a panic path.
		return ""
	}
	return hex.EncodeToString(b)
}

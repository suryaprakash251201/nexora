package auth

// Tests for the sliding-window session lifetime (Phase 2 / P1-1).
//
// The old Lookup never extended the expiry: sessions expired exactly
// NEXORA_SESSION_LIFETIME after creation, regardless of activity. The new
// behaviour refreshes the expiry when the session is closer to expiry than
// 50% of its lifetime. These tests pin the new contract.

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"testing"
	"time"

	"github.com/nexora/nexora/internal/database"

	_ "modernc.org/sqlite"
)

func sha256SumRaw(t *testing.T, raw string) string {
	t.Helper()
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func newSessionStoreFixture(t *testing.T, lifetime time.Duration) *SessionStore {
	t.Helper()
	dbh, err := sql.Open("sqlite", "file:"+t.Name()+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { dbh.Close() })
	if _, err := dbh.Exec(`CREATE TABLE sessions (
		id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
		ip TEXT, user_agent TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	return NewSessionStore(database.Wrap(dbh, "sqlite"), lifetime)
}

// sessionRow reads the raw row for direct assertions.
func sessionRow(t *testing.T, s *SessionStore, raw string) (id, userID, expiresAt string) {
	t.Helper()
	sum := sha256SumRaw(t, raw)
	err := s.db.QueryRow(`SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ?`, sum).Scan(&id, &userID, &expiresAt)
	if err != nil {
		t.Fatalf("query session: %v", err)
	}
	return
}

func TestSessionLookup_ExpiredReturnsFalse(t *testing.T) {
	s := newSessionStoreFixture(t, time.Hour)
	// Create a session that expired 1 minute ago.
	sess, err := s.Create("u1", "127.0.0.1", "ua")
	if err != nil {
		t.Fatal(err)
	}
	// Force-expire it.
	_, _ = s.db.Exec(`UPDATE sessions SET expires_at = ? WHERE user_id = ?`,
		time.Now().Add(-time.Minute).UTC().Format(time.RFC3339), "u1")

	if _, ok := s.Lookup(sess.Token); ok {
		t.Fatal("expired session must not resolve")
	}
}

// TestSessionLookup_RefreshesWhenBelowThreshold is the core sliding-window
// test: a session near its expiry gets bumped back to lifetime-from-now.
//
// "Near" is defined as: remaining < 50% of lifetime. With lifetime=1h,
// threshold=30min, so we set remaining=15min (created 45min ago).
func TestSessionLookup_RefreshesWhenBelowThreshold(t *testing.T) {
	lifetime := time.Hour
	s := newSessionStoreFixture(t, lifetime)
	sess, err := s.Create("u1", "127.0.0.1", "ua")
	if err != nil {
		t.Fatal(err)
	}
	// Set expires_at to now+15min (remaining=15m, below the 50% threshold).
	expiry := time.Now().Add(15 * time.Minute).UTC().Format(time.RFC3339)
	if _, err := s.db.Exec(`UPDATE sessions SET expires_at = ? WHERE user_id = ?`, expiry, "u1"); err != nil {
		t.Fatal(err)
	}
	id, _, _ := sessionRow(t, s, sess.Token)

	_, ok := s.Lookup(sess.Token)
	if !ok {
		t.Fatal("session should still resolve (15min remaining is not yet expired)")
	}
	var newExpires string
	if err := s.db.QueryRow(`SELECT expires_at FROM sessions WHERE id = ?`, id).Scan(&newExpires); err != nil {
		t.Fatal(err)
	}
	parsed, err := time.Parse(time.RFC3339, newExpires)
	if err != nil {
		t.Fatalf("bad expiry format %q: %v", newExpires, err)
	}
	// After refresh, expiry should be ~lifetime in the future (was 15min,
	// must now be ~1h).
	remaining := time.Until(parsed)
	if remaining < lifetime-time.Minute || remaining > lifetime+time.Minute {
		t.Errorf("remaining = %v, want ~%v after refresh", remaining, lifetime)
	}
}

// TestSessionLookup_DoesNotRefreshWhenAboveThreshold verifies the throttle:
// a session with plenty of life left is NOT bumped on every Lookup.
//
// With lifetime=1h, threshold=30min, we set remaining=50min (well above
// the threshold). The expiry must NOT be touched.
func TestSessionLookup_DoesNotRefreshWhenAboveThreshold(t *testing.T) {
	lifetime := time.Hour
	s := newSessionStoreFixture(t, lifetime)
	sess, err := s.Create("u1", "127.0.0.1", "ua")
	if err != nil {
		t.Fatal(err)
	}
	id, _, _ := sessionRow(t, s, sess.Token)
	// Set expires_at to now+50min (remaining=50m, above the 50% threshold of 30m).
	expiry := time.Now().Add(50 * time.Minute).UTC().Format(time.RFC3339)
	if _, err := s.db.Exec(`UPDATE sessions SET expires_at = ? WHERE user_id = ?`, expiry, "u1"); err != nil {
		t.Fatal(err)
	}

	if _, ok := s.Lookup(sess.Token); !ok {
		t.Fatal("session should still resolve (50min remaining)")
	}
	var postExpires string
	if err := s.db.QueryRow(`SELECT expires_at FROM sessions WHERE id = ?`, id).Scan(&postExpires); err != nil {
		t.Fatal(err)
	}
	// Expiry must NOT have been bumped: should still be ~50m from now,
	// not ~60m (which would indicate a refresh).
	parsed, _ := time.Parse(time.RFC3339, postExpires)
	remaining := time.Until(parsed)
	if remaining > 55*time.Minute {
		t.Errorf("remaining = %v, want ~50m (no refresh should have happened)", remaining)
	}
}

// TestSessionLookup_ReturnsRefreshedExpires confirms the returned Session
// reflects the new expiry (used by the session-list UI).
func TestSessionLookup_ReturnsRefreshedExpires(t *testing.T) {
	s := newSessionStoreFixture(t, time.Hour)
	sess, err := s.Create("u1", "127.0.0.1", "ua")
	if err != nil {
		t.Fatal(err)
	}
	// 15min remaining → triggers refresh.
	expiry := time.Now().Add(15 * time.Minute).UTC().Format(time.RFC3339)
	_, _ = s.db.Exec(`UPDATE sessions SET expires_at = ? WHERE user_id = ?`, expiry, "u1")

	got, ok := s.Lookup(sess.Token)
	if !ok {
		t.Fatal("session should resolve")
	}
	if d := time.Until(got.ExpiresAt); d < 55*time.Minute {
		t.Errorf("returned ExpiresAt is %v from now; want ~1h after sliding refresh", d)
	}
}

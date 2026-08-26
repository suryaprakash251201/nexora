package auth

// Tests for the transactional ConsumeResetToken (Phase 1 / P0-2).
//
// The old implementation had three bugs:
//   1. The DELETE happened before the expiry check, so a successful
//      consumption of an expired token returned the user ID, not an error.
//   2. Expired tokens were still deleted, masking the cause of subsequent
//      failures (sql.ErrNoRows instead of "expired").
//   3. The SELECT and DELETE were separate statements with no transaction,
//      so two concurrent reset requests could both pass the SELECT, both
//      delete their copy, and both rotate the password.
//
// These tests pin the new contract: race-safe, expiry-checked, with
// distinct error sentinels for "not found" vs "expired".

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nexora/nexora/internal/database"

	_ "modernc.org/sqlite"
)

// newResetTokenStore builds a fresh in-memory store with the reset_tokens
// table pre-created (we don't run migrations because the rest of the schema
// isn't needed for this test).
//
// Each subtest gets its OWN database file: the in-memory shared mode
// (`cache=shared`) would let parallel subtests collide on the same
// underlying DB, causing spurious deadlocks under `go test ./...`.
// We use a unique name per test invocation via t.TempDir() + a
// uniquely-named file, which is also closer to the production
// per-process DB layout.
func newResetTokenStore(t *testing.T) *UserStore {
	t.Helper()
	path := filepath.Join(t.TempDir(), "reset-"+strings.ReplaceAll(t.Name(), "/", "_")+".db")
	dbh, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { dbh.Close() })
	if _, err := dbh.Exec(`CREATE TABLE users (
		id TEXT PRIMARY KEY, username TEXT, email TEXT, display_name TEXT,
		password_hash TEXT, role TEXT, status TEXT, totp_secret TEXT,
		totp_enabled INTEGER, created_at TEXT, updated_at TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := dbh.Exec(`CREATE TABLE reset_tokens (
		id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
		expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := dbh.Exec(`INSERT INTO users(id, username, status) VALUES ('u1','u1','active')`); err != nil {
		t.Fatal(err)
	}
	return NewUserStore(database.Wrap(dbh, "sqlite"))
}

func hash(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

func TestConsumeResetToken_Valid(t *testing.T) {
	s := newResetTokenStore(t)
	expires := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	if err := s.CreateResetToken("u1", hash("valid-token"), expires); err != nil {
		t.Fatal(err)
	}
	uid, err := s.ConsumeResetToken(hash("valid-token"))
	if err != nil {
		t.Fatalf("valid token: %v", err)
	}
	if uid != "u1" {
		t.Fatalf("uid = %q, want u1", uid)
	}
	// Single-use: a second consume must return sql.ErrNoRows.
	if _, err := s.ConsumeResetToken(hash("valid-token")); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("second consume: err = %v, want sql.ErrNoRows", err)
	}
}

func TestConsumeResetToken_Expired(t *testing.T) {
	s := newResetTokenStore(t)
	// Already-expired token.
	expires := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	if err := s.CreateResetToken("u1", hash("old-token"), expires); err != nil {
		t.Fatal(err)
	}
	_, err := s.ConsumeResetToken(hash("old-token"))
	if !errors.Is(err, ErrResetExpired) {
		t.Fatalf("expired token: err = %v, want ErrResetExpired", err)
	}
	// The expired token must still be removed (one-time use) so the user
	// can't keep retrying and eventually have it succeed due to a clock
	// skew or similar.
	if _, err := s.ConsumeResetToken(hash("old-token")); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("after expired consume: err = %v, want sql.ErrNoRows (one-time use)", err)
	}
}

func TestConsumeResetToken_Unknown(t *testing.T) {
	s := newResetTokenStore(t)
	_, err := s.ConsumeResetToken(hash("never-issued"))
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("unknown token: err = %v, want sql.ErrNoRows (NOT ErrResetExpired)", err)
	}
}

// TestConsumeResetToken_RaceFree fires N concurrent consumers at the same
// token. Exactly ONE must succeed; the rest must see sql.ErrNoRows (because
// the winner committed the DELETE inside the transaction). With the old
// non-transactional code, multiple consumers could race past the SELECT.
func TestConsumeResetToken_RaceFree(t *testing.T) {
	s := newResetTokenStore(t)
	expires := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	if err := s.CreateResetToken("u1", hash("race-token"), expires); err != nil {
		t.Fatal(err)
	}

	const N = 16
	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		successes int
	)
	start := make(chan struct{})
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			uid, err := s.ConsumeResetToken(hash("race-token"))
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				if uid != "u1" {
					t.Errorf("uid = %q, want u1", uid)
				}
				successes++
			} else if !errors.Is(err, sql.ErrNoRows) {
				t.Errorf("unexpected error: %v", err)
			}
		}()
	}
	close(start) // unleash all goroutines simultaneously
	wg.Wait()
	if successes != 1 {
		t.Fatalf("successes = %d, want 1 (only one consumer must win)", successes)
	}
}

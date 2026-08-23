package auth

import (
	"database/sql"
	"testing"
	"time"

	"github.com/nexora/nexora/internal/database"

	_ "modernc.org/sqlite"
)

func newTokenStoreFixture(t *testing.T) *TokenStore {
	t.Helper()
	dbh, err := sql.Open("sqlite", "file:"+t.Name()+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { dbh.Close() })
	if _, err := dbh.Exec(`CREATE TABLE api_tokens (
		id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT DEFAULT '',
		token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
		last_used_at TEXT, expires_at TEXT)`); err != nil {
		t.Fatal(err)
	}
	return NewTokenStore(database.Wrap(dbh, "sqlite"))
}

func TestTokenLifecycle(t *testing.T) {
	ts := newTokenStoreFixture(t)

	raw, err := ts.Create("u1", "ci-script", time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) < 10 || raw[:4] != "nxr_" {
		t.Fatalf("unexpected token format: %q", raw[:min(8, len(raw))])
	}

	uid, ok := ts.Lookup(raw)
	if !ok || uid != "u1" {
		t.Fatalf("lookup failed: uid=%q ok=%v", uid, ok)
	}
	items, err := ts.List("u1")
	if err != nil || len(items) != 1 || items[0].Name != "ci-script" {
		t.Fatalf("list: %v %+v", err, items)
	}

	if err := ts.Delete(items[0].ID, "u1"); err != nil {
		t.Fatal(err)
	}
	if _, ok := ts.Lookup(raw); ok {
		t.Fatal("revoked token must not resolve")
	}
}

func TestTokenExpiryAndScoping(t *testing.T) {
	ts := newTokenStoreFixture(t)

	// Expired token (created already-expired).
	rawExpired, _ := ts.Create("u1", "expired", time.Now().Add(-time.Hour))
	if _, ok := ts.Lookup(rawExpired); ok {
		t.Fatal("expired token must not resolve")
	}

	// User scoping: u2 cannot revoke u1's token.
	rawU1, _ := ts.Create("u1", "u1-token", time.Time{})
	items, _ := ts.List("u1")
	if err := ts.Delete(items[0].ID, "u2"); err == nil {
		t.Log("delete of foreign id is a no-op without error")
	}
	if uid, ok := ts.Lookup(rawU1); !ok || uid != "u1" {
		t.Fatal("foreign delete must not affect the token")
	}
}

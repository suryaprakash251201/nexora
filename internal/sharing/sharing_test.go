package sharing

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "test.db")+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	const schema = `CREATE TABLE shares(
		id TEXT PRIMARY KEY,
		token TEXT NOT NULL,
		user_id TEXT NOT NULL,
		root_id TEXT NOT NULL,
		path TEXT NOT NULL,
		scope TEXT NOT NULL,
		password_hash TEXT NOT NULL DEFAULT '',
		expires_at TEXT,
		max_downloads INTEGER NOT NULL DEFAULT 0,
		download_count INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	);`
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("schema: %v", err)
	}
	return db
}

func TestCreateAndAccess(t *testing.T) {
	s := NewStore(newTestDB(t))
	sh, err := s.Create(CreateInput{
		UserID: "u1", RootID: "r1", Path: "a/file.txt", Scope: ScopePreview,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if sh.Token == "" || len(sh.Token) != 48 {
		t.Errorf("token length wrong: %q", sh.Token)
	}
	if sh.HasPassword {
		t.Errorf("expected no password flag false")
	}
	// Access by correct token succeeds.
	got, err := s.Access(sh.Token, "")
	if err != nil {
		t.Errorf("access: %v", err)
	}
	if got.ID != sh.ID {
		t.Errorf("access returned wrong share")
	}
	// Unknown token fails.
	if _, err := s.Access("bogus", ""); err != ErrNotFound {
		t.Errorf("unknown token = %v, want ErrNotFound", err)
	}
}

func TestAccessPassword(t *testing.T) {
	s := NewStore(newTestDB(t))
	sh, err := s.Create(CreateInput{
		UserID: "u1", RootID: "r1", Path: "secret.txt", Scope: ScopeDownload, Password: "hunter2",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !sh.HasPassword {
		t.Fatal("expected HasPassword true")
	}
	if _, err := s.Access(sh.Token, ""); err != ErrPassword {
		t.Errorf("missing password = %v, want ErrPassword", err)
	}
	if _, err := s.Access(sh.Token, "wrong"); err != ErrPassword {
		t.Errorf("wrong password = %v, want ErrPassword", err)
	}
	if _, err := s.Access(sh.Token, "hunter2"); err != nil {
		t.Errorf("correct password: %v", err)
	}
}

func TestAccessExpiryAndLimit(t *testing.T) {
	s := NewStore(newTestDB(t))
	expires := time.Now().Add(-1 * time.Hour)
	sh, err := s.Create(CreateInput{
		UserID: "u1", RootID: "r1", Path: "x", Scope: ScopeDownload, ExpiresAt: &expires,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.Access(sh.Token, ""); err != ErrExpired {
		t.Errorf("expired = %v, want ErrExpired", err)
	}

	s2 := NewStore(newTestDB(t))
	sh2, _ := s2.Create(CreateInput{UserID: "u1", RootID: "r1", Path: "x", Scope: ScopeDownload, MaxDownloads: 1})
	if err := s2.IncrementDownload(sh2.ID); err != nil {
		t.Fatalf("incr: %v", err)
	}
	if _, err := s2.Access(sh2.Token, ""); err != ErrExhausted {
		t.Errorf("exhausted = %v, want ErrExhausted", err)
	}
}

func TestRevoke(t *testing.T) {
	s := NewStore(newTestDB(t))
	sh, _ := s.Create(CreateInput{UserID: "u1", RootID: "r1", Path: "x"})
	if err := s.Revoke(sh.ID, "u1", false); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := s.Access(sh.Token, ""); err != ErrNotFound {
		t.Errorf("after revoke access = %v, want ErrNotFound", err)
	}
	// Non-admin cannot revoke another user's share.
	sh2, _ := s.Create(CreateInput{UserID: "u2", RootID: "r1", Path: "y"})
	if err := s.Revoke(sh2.ID, "u1", false); err != ErrNotFound {
		t.Errorf("cross-user revoke = %v, want ErrNotFound", err)
	}
}

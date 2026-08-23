package storage

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/logger"

	_ "modernc.org/sqlite"
)

func setupTrashFixture(t *testing.T) (*database.DB, *RootService, string) {
	t.Helper()
	dir := t.TempDir()
	dbh, err := sql.Open("sqlite", "file:"+t.Name()+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { dbh.Close() })
	if _, err := dbh.Exec(`CREATE TABLE trash (id TEXT PRIMARY KEY, user_id TEXT, root_id TEXT, original_path TEXT, trash_path TEXT, name TEXT, size INTEGER DEFAULT 0, is_dir INTEGER DEFAULT 0, deleted_at TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := dbh.Exec(`CREATE TABLE storage_roots (id TEXT PRIMARY KEY, name TEXT, path TEXT, icon TEXT, type TEXT, config TEXT, read_only INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, indexed INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT)`); err != nil {
		t.Fatal(err)
	}
	// A local root whose directory we control.
	rootDir := filepath.Join(dir, "root")
	if err := os.MkdirAll(filepath.Join(rootDir, ".nexora-trash"), 0o755); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := dbh.Exec(`INSERT INTO storage_roots (id,name,path,icon,type,config,created_at,updated_at) VALUES ('r1','Test',?, 'folder','local','','`+now+`','`+now+`')`, rootDir); err != nil {
		t.Fatal(err)
	}
	insert := func(id, trashRel, deletedAt string) {
		full := filepath.Join(rootDir, trashRel)
		if err := os.WriteFile(full, []byte("data"), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := dbh.Exec(`INSERT INTO trash (id,user_id,root_id,original_path,trash_path,name,deleted_at) VALUES (?, 'u1', 'r1', ?, ?, 'f', ?)`,
			id, trashRel, filepath.ToSlash(trashRel), deletedAt); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().UTC().Add(-48 * time.Hour).Format(time.RFC3339)
	fresh := time.Now().UTC().Add(-1 * time.Hour).Format(time.RFC3339)
	insert("old", filepath.Join(".nexora-trash", "old.bin"), old)
	insert("fresh", filepath.Join(".nexora-trash", "fresh.bin"), fresh)

	return database.Wrap(dbh, "sqlite"), NewRootService(database.Wrap(dbh, "sqlite")), rootDir
}

func TestPurgeExpiredTrash(t *testing.T) {
	db, rs, rootDir := setupTrashFixture(t)
	log := logger.New("error", "test")

	purged := PurgeExpiredTrash(context.Background(), db, rs, 24*time.Hour, log)
	if purged != 1 {
		t.Fatalf("want 1 purged, got %d", purged)
	}
	// Old file physically gone; fresh still present.
	if _, err := os.Stat(filepath.Join(rootDir, ".nexora-trash", "old.bin")); !os.IsNotExist(err) {
		t.Fatal("old file should be deleted from disk")
	}
	if _, err := os.Stat(filepath.Join(rootDir, ".nexora-trash", "fresh.bin")); err != nil {
		t.Fatal("fresh file must survive")
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM trash`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("want 1 remaining row, got %d", n)
	}

	// Disabled TTL is a no-op.
	if got := PurgeExpiredTrash(context.Background(), db, rs, 0, log); got != 0 {
		t.Fatalf("disabled ttl should purge nothing, got %d", got)
	}
}

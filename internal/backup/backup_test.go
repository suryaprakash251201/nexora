package backup

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/logger"
)

func TestBackupFileName(t *testing.T) {
	name := BackupFileName(time.Date(2026, 8, 23, 14, 5, 9, 0, time.UTC))
	if name != "nexora-backup-20260823-140509.db" {
		t.Fatalf("unexpected name: %s", name)
	}
}

func TestPrune(t *testing.T) {
	dir := t.TempDir()
	names := []string{
		"nexora-backup-20260101-000000.db",
		"nexora-backup-20260102-000000.db",
		"nexora-backup-20260103-000000.db",
		"other-file.db", // must be ignored
	}
	for _, n := range names {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	removed, err := Prune(dir, 2)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("want 1 removed, got %d", removed)
	}
	for _, want := range []string{"nexora-backup-20260103-000000.db", "nexora-backup-20260102-000000.db", "other-file.db"} {
		if _, err := os.Stat(filepath.Join(dir, want)); err != nil {
			t.Fatalf("expected %s to survive: %v", want, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "nexora-backup-20260101-000000.db")); !os.IsNotExist(err) {
		t.Fatal("oldest backup should have been pruned")
	}
}

func TestRunOnceSQLite(t *testing.T) {
	dir := t.TempDir()
	dbh, err := sql.Open("sqlite", "file:"+t.Name()+"?mode=memory&cache=shared")
	if err != nil {
		t.Skip("sqlite driver unavailable:", err)
	}
	defer dbh.Close()
	if _, err := dbh.Exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)"); err != nil {
		t.Fatal(err)
	}
	db := database.Wrap(dbh, "sqlite")

	log := logger.New("error", "text")
	if err := RunOnce(db, dir, 3, log); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("want exactly 1 backup file, got %d", len(entries))
	}

	// Snapshot must be a valid, queryable database containing our table.
	snap, err := sql.Open("sqlite", filepath.Join(dir, entries[0].Name()))
	if err != nil {
		t.Fatal(err)
	}
	defer snap.Close()
	var n int
	if err := snap.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='t'").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatal("snapshot is missing table t")
	}

	// Postgres dialect: RunOnce must no-op cleanly.
	pg := database.Wrap(dbh, "postgres")
	if err := RunOnce(pg, dir, 3, log); err != nil {
		t.Fatalf("postgres mode should skip without error: %v", err)
	}
}

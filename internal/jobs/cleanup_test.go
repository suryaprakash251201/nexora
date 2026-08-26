package jobs

// Tests for CleanupOldArchives (Phase 3 / P2-1).
//
// The old code deleted the DB row FIRST, then removed the on-disk
// .zip. A failed os.Remove left an orphan zip with no DB row, and the
// only signal was a swallowed error. The new code does file-first,
// row-second: a failed file remove leaves the row in place so a future
// run can retry; a failed row delete leaves a row pointing at a
// missing file, which is harmless.
//
// We also now handle TypeExtract jobs (previously leaked forever) by
// logging the destination directory and dropping the row.

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nexora/nexora/internal/database"
	_ "modernc.org/sqlite"
)

func newManagerWithJobs(t *testing.T) (*Manager, *sql.DB) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+t.Name()+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(`CREATE TABLE jobs (
		id TEXT PRIMARY KEY, type TEXT, status TEXT, user_id TEXT, root_id TEXT,
		payload TEXT, progress REAL, error TEXT,
		created_at TEXT, updated_at TEXT)`); err != nil {
		t.Fatal(err)
	}
	cacheDir := t.TempDir()
	m := NewManager(database.Wrap(db, "sqlite"), nil, nil, cacheDir, 0)
	return m, db
}

func insertJob(t *testing.T, db *sql.DB, id, typ, createdAt string, payload any) {
	t.Helper()
	body, _ := json.Marshal(payload)
	if _, err := db.Exec(`INSERT INTO jobs(id, type, status, user_id, root_id, payload, progress, error, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		id, typ, "done", "u1", "r1", string(body), 1.0, "", createdAt, createdAt); err != nil {
		t.Fatal(err)
	}
}

func TestCleanupOldArchives_RemovesFileAndRow(t *testing.T) {
	m, db := newManagerWithJobs(t)
	// Plant a fake archive .zip on disk and a corresponding job row.
	jobID := "job_archive_001"
	zipPath := m.ArchivePath(jobID)
	if err := os.WriteFile(zipPath, []byte("PK fake"), 0o644); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	insertJob(t, db, jobID, TypeArchive, past, ArchivePayload{
		RootID: "r1", Paths: []string{"a"}, Name: "a", OutputID: jobID,
	})

	m.CleanupOldArchives(time.Hour)

	// File must be gone.
	if _, err := os.Stat(zipPath); !os.IsNotExist(err) {
		t.Errorf("archive file still present after cleanup: err=%v", err)
	}
	// Row must be gone.
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM jobs WHERE id=?`, jobID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("archive job row not deleted: count=%d", n)
	}
}

func TestCleanupOldArchives_LeavesRecentJobsAlone(t *testing.T) {
	m, db := newManagerWithJobs(t)
	jobID := "job_archive_002"
	zipPath := m.ArchivePath(jobID)
	if err := os.WriteFile(zipPath, []byte("PK fresh"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Created 10 minutes ago, TTL is 1 hour: must survive.
	recent := time.Now().Add(-10 * time.Minute).UTC().Format(time.RFC3339)
	insertJob(t, db, jobID, TypeArchive, recent, ArchivePayload{
		RootID: "r1", Paths: []string{"a"}, Name: "a", OutputID: jobID,
	})

	m.CleanupOldArchives(time.Hour)

	if _, err := os.Stat(zipPath); err != nil {
		t.Errorf("recent archive file removed: %v", err)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM jobs WHERE id=?`, jobID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("recent job row deleted: count=%d", n)
	}
}

func TestCleanupOldArchives_ExtractJobsLoggedAndDropped(t *testing.T) {
	m, db := newManagerWithJobs(t)
	jobID := "job_extract_001"
	past := time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	insertJob(t, db, jobID, TypeExtract, past, ExtractPayload{
		RootID: "r1",
		Path:   "uploads/old.zip",
		Dest:   "extracted/old",
	})

	m.CleanupOldArchives(time.Hour)

	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM jobs WHERE id=?`, jobID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("extract job row not deleted: count=%d", n)
	}
}

func TestCleanupOldArchives_MissingFileNotFatal(t *testing.T) {
	// If the .zip is already gone (e.g. manually deleted) the cleanup
	// must still drop the row. Phase 3 / P2-1 changed the order so a
	// missing file is treated as success.
	m, db := newManagerWithJobs(t)
	jobID := "job_archive_ghost"
	past := time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	insertJob(t, db, jobID, TypeArchive, past, ArchivePayload{
		RootID: "r1", Paths: []string{"a"}, Name: "a", OutputID: jobID,
	})
	// Note: no zip file planted.

	m.CleanupOldArchives(time.Hour)

	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM jobs WHERE id=?`, jobID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("ghost job row not deleted: count=%d", n)
	}
}

// TestCleanupOldArchives_OnlyArchiveOrExtractTouched pins the type filter:
// pending or non-job rows are not touched.
func TestCleanupOldArchives_OnlyArchiveOrExtractTouched(t *testing.T) {
	m, db := newManagerWithJobs(t)
	// A non-archive, non-extract job (hypothetical future type) must
	// be left alone by this cleanup.
	otherID := "job_other_001"
	past := time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	insertJob(t, db, otherID, "something-else", past, struct{}{})

	m.CleanupOldArchives(time.Hour)

	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM jobs WHERE id=?`, otherID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("unrelated job row deleted: count=%d", n)
	}
	_ = filepath.Separator // keep import
}

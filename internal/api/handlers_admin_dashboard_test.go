package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAdminOverviewAndBackups(t *testing.T) {
	s, sessions, rootDir := setupTagsTest(t) // reuses the standard harness (user + root)
	h := s.Routes()
	tok := mustSession(t, sessions)

	// Seed one file so the index has something to count.
	if err := os.WriteFile(filepath.Join(rootDir, "hello.txt"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Index it via Upsert directly (Search is nil in this harness; counts
	// come from search_index so seed the table by hand).
	_, err := s.DB.Exec(`INSERT INTO search_index(id, root_id, path, name, ext, size, is_dir, mime, modified)
		VALUES('ov1','root_test','hello.txt','hello.txt','txt',4,0,'text/plain','2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}

	// 1) Overview.
	rec := tagReq(t, h, "GET", "/api/v1/admin/overview", tok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("overview: %d %s", rec.Code, rec.Body.String())
	}
	var ov struct {
		Users int64 `json:"users"`
		Roots int64 `json:"roots"`
		Files int64 `json:"files"`
		Bytes int64 `json:"bytes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &ov); err != nil {
		t.Fatal(err)
	}
	if ov.Users != 1 || ov.Roots != 1 || ov.Files != 1 || ov.Bytes != 4 {
		t.Fatalf("overview: %+v", ov)
	}

	// 2) Backups: disabled → empty list, create rejected.
	rec = tagReq(t, h, "GET", "/api/v1/admin/backups", tok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list backups: %d", rec.Code)
	}
	var bk struct {
		Enabled bool          `json:"enabled"`
		Items   []backupEntry `json:"items"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &bk)
	if bk.Enabled || len(bk.Items) != 0 {
		t.Fatalf("expected disabled+empty, got %+v", bk)
	}
	rec = tagReq(t, h, "POST", "/api/v1/admin/backups", tok, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("create backup with dir unset: %d", rec.Code)
	}
}

func TestAdminBackups_Lifecycle(t *testing.T) {
	s, sessions, _ := setupTagsTest(t)
	// Enable backups: point cfg at a temp dir.
	backupDir := t.TempDir()
	s.Cfg.BackupDir = backupDir
	h := s.Routes()
	tok := mustSession(t, sessions)

	// Trigger a manual backup (runs in a goroutine; wait for the file).
	rec := tagReq(t, h, "POST", "/api/v1/admin/backups", tok, nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("create backup: %d %s", rec.Code, rec.Body.String())
	}
	var f *os.File
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		entries, _ := os.ReadDir(backupDir)
		if len(entries) > 0 {
			f, _ = os.Open(filepath.Join(backupDir, entries[0].Name()))
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if f == nil {
		t.Fatal("backup file never appeared")
	}
	name := filepath.Base(f.Name())
	f.Close()

	// List shows exactly one backup.
	rec = tagReq(t, h, "GET", "/api/v1/admin/backups", tok, nil)
	var bk struct {
		Enabled bool          `json:"enabled"`
		Items   []backupEntry `json:"items"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &bk)
	if !bk.Enabled || len(bk.Items) != 1 || bk.Items[0].Name != name {
		t.Fatalf("backups list: %+v", bk)
	}

	// Delete it.
	rec = tagReq(t, h, "DELETE", "/api/v1/admin/backups/"+name, tok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete backup: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(backupDir, name)); !os.IsNotExist(err) {
		t.Fatalf("backup still on disk: %v", err)
	}
	// Traversal attempt is rejected.
	rec = tagReq(t, h, "DELETE", "/api/v1/admin/backups/..%2F..%2Fetc%2Fpasswd", tok, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("traversal delete should 400, got %d", rec.Code)
	}
}

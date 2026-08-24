package api

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/nexora/nexora/internal/logger"
)

func TestTotalChunksFor(t *testing.T) {
	cases := []struct{ size, chunk, want int64 }{
		{0, 8 << 20, 0},             // empty file → zero parts
		{1, 8 << 20, 1},             // tiny
		{8 << 20, 8 << 20, 1},       // exact one chunk
		{(8<<20)*3 + 1, 8 << 20, 4}, // remainder spills into 4th
	}
	for _, c := range cases {
		if got := totalChunksFor(c.size, c.chunk); got != c.want {
			t.Errorf("totalChunksFor(%d,%d)=%d want %d", c.size, c.chunk, got, c.want)
		}
	}
}

func TestScanPartsAndStatusMath(t *testing.T) {
	dataDir := t.TempDir()
	sess := &uploadSession{
		ID: "up_scan01", TotalChunks: 4, ChunkSize: 100, Size: 350,
	}
	dir := uploadSessionDir(dataDir, sess.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name string, n int) {
		if err := os.WriteFile(filepath.Join(dir, name), make([]byte, n), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("000000.part", 100)
	write("000002.part", 100)
	write("000001.part.tmp", 50) // in-flight temp must be ignored
	write("meta.json", 10)       // non-part ignored

	present, total := scanParts(dataDir, sess)
	if !present[0] || !present[2] || present[1] || present[3] {
		t.Fatalf("unexpected present set: %v", present)
	}
	if total != 200 {
		t.Fatalf("uploaded bytes = %d, want 200", total)
	}
}

func TestClassifyUploadErrorENOSPC(t *testing.T) {
	status, code, _ := classifyUploadError(&os.PathError{Op: "write", Err: syscall.ENOSPC})
	if status != 507 || code != "disk_full" {
		t.Fatalf("ENOSPC should map to 507/disk_full, got %d/%s", status, code)
	}
	status, code, _ = classifyUploadError(&os.PathError{Op: "open", Err: syscall.EACCES})
	if status != 403 || code != "permission_denied" {
		t.Fatalf("EACCES should map to 403/permission_denied, got %d/%s", status, code)
	}
}

func TestPurgeStaleUploadSessions(t *testing.T) {
	dataDir := t.TempDir()
	log := logger.New("error", "test")

	mk := func(id string, modTime time.Time) {
		dir := filepath.Join(dataDir, "uploads", id)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "meta.json"), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(dir, modTime, modTime); err != nil {
			t.Fatal(err)
		}
	}
	stale := time.Now().Add(-48 * time.Hour)
	fresh := time.Now().Add(-time.Hour)
	mk("up_staleaaaaaa", stale)
	mk("up_freshaaaaaa", fresh)
	mk("not-a-session-dir", stale) // must be untouched

	removed := PurgeStaleUploadSessions(context.Background(), dataDir, 24*time.Hour, log)
	if removed != 1 {
		t.Fatalf("want 1 purged, got %d", removed)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "uploads", "up_freshaaaaaa")); err != nil {
		t.Fatal("fresh session must survive")
	}
	if _, err := os.Stat(filepath.Join(dataDir, "uploads", "up_staleaaaaaa")); !os.IsNotExist(err) {
		t.Fatal("stale session should be gone")
	}
	if _, err := os.Stat(filepath.Join(dataDir, "uploads", "not-a-session-dir")); err != nil {
		t.Fatal("non-session dir must be untouched")
	}
}

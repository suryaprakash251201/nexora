package versions

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/storage"
	_ "modernc.org/sqlite"
)

// memProvider is a map-backed StorageProvider for tests. The bytes are
// stored in-memory so tests are fast and isolated; no filesystem.
type memProvider struct {
	files map[string][]byte
}

func newMemProvider() *memProvider {
	return &memProvider{files: map[string][]byte{}}
}

func (p *memProvider) Stat(rel string) (storage.FileInfo, error) {
	if b, ok := p.files[rel]; ok {
		return storage.FileInfo{
			Name:     filepath.Base(rel),
			Path:     rel,
			Size:     int64(len(b)),
			IsDir:    false,
			Mime:     "application/octet-stream",
			Modified: testNow,
		}, nil
	}
	return storage.FileInfo{}, storage.ErrNotFound
}
func (p *memProvider) List(rel string) ([]storage.FileInfo, error) {
	// Not exercised by version tests; minimal impl.
	return nil, storage.ErrNotFound
}
func (p *memProvider) Read(rel string) (io.ReadCloser, error) {
	b, ok := p.files[rel]
	if !ok {
		return nil, storage.ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}
func (p *memProvider) Write(rel string, r io.Reader, size int64) error {
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	p.files[rel] = b
	return nil
}
func (p *memProvider) CreateDirectory(string) error { return nil }
func (p *memProvider) Move(src, dst string) error {
	b, ok := p.files[src]
	if !ok {
		return storage.ErrNotFound
	}
	p.files[dst] = b
	delete(p.files, src)
	return nil
}
func (p *memProvider) Copy(src, dst string) error {
	b, ok := p.files[src]
	if !ok {
		return storage.ErrNotFound
	}
	cp := make([]byte, len(b))
	copy(cp, b)
	p.files[dst] = cp
	return nil
}
func (p *memProvider) Delete(rel string) error {
	if _, ok := p.files[rel]; !ok {
		return storage.ErrNotFound
	}
	delete(p.files, rel)
	return nil
}
func (p *memProvider) OpenRange(rel string, start, end int64) (io.ReadCloser, int64, error) {
	b, ok := p.files[rel]
	if !ok {
		return nil, 0, storage.ErrNotFound
	}
	if end < 0 || end >= int64(len(b)) {
		end = int64(len(b)) - 1
	}
	return io.NopCloser(bytes.NewReader(b[start : end+1])), int64(len(b)), nil
}
func (p *memProvider) Search(storage.SearchQuery) ([]storage.FileInfo, error) {
	return nil, nil
}
func (p *memProvider) GetQuota() (storage.Quota, error) { return storage.Quota{}, nil }

// testNow is a fixed instant so tests are deterministic.
var testNow = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func mustDB(t *testing.T) *database.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// Apply just the file_versions-related DDL inline (the full migrations
	// runner requires the schema_migrations table; we only need the table
	// itself for these tests).
	ddl := []string{
		`CREATE TABLE file_versions (
			id          TEXT PRIMARY KEY,
			user_id     TEXT NOT NULL,
			root_id     TEXT NOT NULL,
			path        TEXT NOT NULL,
			version     INTEGER NOT NULL,
			size        INTEGER NOT NULL,
			checksum    TEXT NOT NULL DEFAULT '',
			note        TEXT NOT NULL DEFAULT '',
			stored_path TEXT NOT NULL DEFAULT '',
			created_at  TEXT NOT NULL,
			storage_kind TEXT NOT NULL DEFAULT 'provider',
			storage_key  TEXT NOT NULL DEFAULT '',
			auto         INTEGER NOT NULL DEFAULT 0,
			checksum_alg TEXT NOT NULL DEFAULT 'sha256'
		)`,
		`CREATE UNIQUE INDEX idx_versions_unique ON file_versions(root_id, path, version)`,
		`CREATE TABLE version_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
	}
	for _, q := range ddl {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("ddl %q: %v", q, err)
		}
	}
	return database.Wrap(db, "sqlite")
}

func writeFile(t *testing.T, p *memProvider, rel string, data []byte) {
	t.Helper()
	p.files[rel] = data
}

func sha256Hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func TestCreate_FirstVersion(t *testing.T) {
	db := mustDB(t)
	prov := newMemProvider()
	writeFile(t, prov, "docs/readme.md", []byte("hello world"))
	s := &Store{DB: db, Config: Config{MaxPerFile: 50, MaxFileSize: 1 << 20}}

	v, err := s.Create(CreateInput{
		UserID: "u1", RootID: "r1", Path: "docs/readme.md", Note: "first",
	}, prov)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if v.Version != 1 {
		t.Fatalf("expected version 1, got %d", v.Version)
	}
	if v.Size != int64(len("hello world")) {
		t.Fatalf("expected size %d, got %d", len("hello world"), v.Size)
	}
	if v.Checksum != sha256Hex([]byte("hello world")) {
		t.Fatalf("checksum mismatch: %s", v.Checksum)
	}
	if v.StorageKind != StorageProvider {
		t.Fatalf("expected provider storage, got %q", v.StorageKind)
	}
	// Bytes must be in the provider at HiddenDir/<id>.
	if _, ok := prov.files[v.StorageKey]; !ok {
		t.Fatalf("version bytes not written at %q", v.StorageKey)
	}
	if !strings.HasPrefix(v.StorageKey, HiddenDir+"/") {
		t.Fatalf("storage key not under %s: %s", HiddenDir, v.StorageKey)
	}
}

func TestCreate_IncrementsVersion(t *testing.T) {
	db := mustDB(t)
	prov := newMemProvider()
	writeFile(t, prov, "a.txt", []byte("v1"))
	s := &Store{DB: db, Config: Config{MaxPerFile: 50}}
	for i := 1; i <= 3; i++ {
		v, err := s.Create(CreateInput{UserID: "u", RootID: "r", Path: "a.txt"}, prov)
		if err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
		if v.Version != i {
			t.Fatalf("expected version %d, got %d", i, v.Version)
		}
	}
	if got := len(prov.files); got != 4 { // live + 3 versions
		t.Fatalf("expected 4 files in provider (1 live + 3 versions), got %d", got)
	}
}

func TestCreate_RespectsMaxFileSize(t *testing.T) {
	db := mustDB(t)
	prov := newMemProvider()
	writeFile(t, prov, "big.bin", make([]byte, 1024))
	s := &Store{DB: db, Config: Config{MaxPerFile: 50, MaxFileSize: 100}}
	_, err := s.Create(CreateInput{UserID: "u", RootID: "r", Path: "big.bin"}, prov)
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}
}

func TestCreate_PrunesPerFile(t *testing.T) {
	db := mustDB(t)
	prov := newMemProvider()
	writeFile(t, prov, "a.txt", []byte("v1"))
	s := &Store{DB: db, Config: Config{MaxPerFile: 2}}
	// Create 5 versions.
	for i := 0; i < 5; i++ {
		if _, err := s.Create(CreateInput{UserID: "u", RootID: "r", Path: "a.txt"}, prov); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	// We should keep only the 2 newest (versions 4 and 5).
	all := s.List("r", "a.txt")
	if len(all) != 2 {
		t.Fatalf("expected 2 versions after prune, got %d", len(all))
	}
	if all[0].Version != 5 || all[1].Version != 4 {
		t.Fatalf("expected newest first: [5, 4], got [%d, %d]", all[0].Version, all[1].Version)
	}
}

func TestGet_NotFound(t *testing.T) {
	db := mustDB(t)
	s := &Store{DB: db}
	_, err := s.Get("nonexistent")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestRestore_ClobbersAndIsUndoable(t *testing.T) {
	db := mustDB(t)
	prov := newMemProvider()
	writeFile(t, prov, "a.txt", []byte("v1"))
	s := &Store{DB: db, Config: Config{MaxPerFile: 50}}

	v1, err := s.Create(CreateInput{UserID: "u", RootID: "r", Path: "a.txt", Note: "v1"}, prov)
	if err != nil {
		t.Fatalf("create v1: %v", err)
	}
	// Live file is now "v2".
	prov.files["a.txt"] = []byte("v2")
	v2, err := s.Create(CreateInput{UserID: "u", RootID: "r", Path: "a.txt", Note: "v2"}, prov)
	if err != nil {
		t.Fatalf("create v2: %v", err)
	}

	// Restore v1: this should also auto-snapshot the current "v2" first,
	// then write "v1" back to the live file.
	if _, err := s.Restore(v1.ID, "u", prov); err != nil {
		t.Fatalf("restore v1: %v", err)
	}
	if string(prov.files["a.txt"]) != "v1" {
		t.Fatalf("expected live file to be v1, got %q", prov.files["a.txt"])
	}
	// A new auto-version (v3) was created from "v2".
	all := s.List("r", "a.txt")
	if len(all) != 3 {
		t.Fatalf("expected 3 versions after restore (v1, v2, auto-saved), got %d", len(all))
	}
	// Highest is auto, holds "v2".
	if !all[0].Auto {
		t.Fatalf("expected newest version to be auto=true, got %+v", all[0])
	}
	// Pull its bytes to confirm the snapshot captured "v2".
	rc, err := s.Open(&all[0], prov)
	if err != nil {
		t.Fatalf("open auto: %v", err)
	}
	b, _ := io.ReadAll(rc)
	rc.Close()
	if string(b) != "v2" {
		t.Fatalf("auto-snapshot bytes: expected v2, got %q", b)
	}
	_ = v2 // silence unused
}

func TestDelete_RemovesRowAndBytes(t *testing.T) {
	db := mustDB(t)
	prov := newMemProvider()
	writeFile(t, prov, "a.txt", []byte("hi"))
	s := &Store{DB: db, Config: Config{MaxPerFile: 50}}
	v, err := s.Create(CreateInput{UserID: "u", RootID: "r", Path: "a.txt"}, prov)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	key := v.StorageKey
	if _, ok := prov.files[key]; !ok {
		t.Fatalf("expected version bytes at %q", key)
	}
	if err := s.Delete(v.ID, prov); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, ok := prov.files[key]; ok {
		t.Fatalf("version bytes still present after delete")
	}
	if _, err := s.Get(v.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestPurge_MaxTotalAge(t *testing.T) {
	db := mustDB(t)
	prov := newMemProvider()
	writeFile(t, prov, "a.txt", []byte("v1"))
	s := &Store{DB: db, Config: Config{MaxPerFile: 50, MaxTotalAge: 30 * 24 * time.Hour}}

	// Manually insert a version with an old timestamp.
	_, err := db.Exec(`INSERT INTO file_versions
		(id, user_id, root_id, path, version, size, checksum, note, storage_kind, storage_key, auto, created_at, stored_path)
		VALUES (?, ?, ?, ?, ?, ?, ?, '', 'provider', ?, 0, ?, '')`,
		"old1", "u", "r", "a.txt", 1, 3, "x", HiddenDir+"/old1", "2020-01-01T00:00:00Z")
	if err != nil {
		t.Fatalf("seed old: %v", err)
	}
	prov.files[HiddenDir+"/old1"] = []byte("v1")

	d, f, err := s.Purge(prov)
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	if d != 1 || f != 3 {
		t.Fatalf("expected 1 row / 3 bytes purged, got %d/%d", d, f)
	}
	if _, ok := prov.files[HiddenDir+"/old1"]; ok {
		t.Fatalf("old version bytes still present")
	}
}

func TestPurge_MaxTotalBytes_RespectsNewestPerFile(t *testing.T) {
	db := mustDB(t)
	prov := newMemProvider()
	writeFile(t, prov, "a.txt", []byte("current"))
	s := &Store{DB: db, Config: Config{MaxPerFile: 2, MaxTotalBytes: 5}}

	// Make 4 versions of 10 bytes each = 40 total. Newest 2 must survive
	// (we keep 2 per file). The cap is 5, so the over-age is 35; we
	// should delete the 2 oldest (20 bytes) and stop, leaving 2 newest.
	for i := 0; i < 4; i++ {
		if _, err := s.Create(CreateInput{UserID: "u", RootID: "r", Path: "a.txt"}, prov); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	// All 4 are already 10 bytes each.
	d, _, err := s.Purge(prov)
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	all := s.List("r", "a.txt")
	if len(all) != 2 {
		t.Fatalf("expected 2 surviving versions (newest per file), got %d (deleted=%d)", len(all), d)
	}
	// Survivors must be the newest two.
	if all[0].Version != 4 || all[1].Version != 3 {
		t.Fatalf("expected survivors [4, 3], got [%d, %d]", all[0].Version, all[1].Version)
	}
}

func TestPurgeForPath(t *testing.T) {
	db := mustDB(t)
	prov := newMemProvider()
	writeFile(t, prov, "a.txt", []byte("v1"))
	writeFile(t, prov, "b.txt", []byte("w1"))
	s := &Store{DB: db, Config: Config{MaxPerFile: 50}}
	for i := 0; i < 2; i++ {
		if _, err := s.Create(CreateInput{UserID: "u", RootID: "r", Path: "a.txt"}, prov); err != nil {
			t.Fatalf("create a %d: %v", i, err)
		}
		if _, err := s.Create(CreateInput{UserID: "u", RootID: "r", Path: "b.txt"}, prov); err != nil {
			t.Fatalf("create b %d: %v", i, err)
		}
	}
	d, _, err := s.PurgeForPath("r", "a.txt", prov)
	if err != nil || d != 2 {
		t.Fatalf("PurgeForPath a: d=%d err=%v", d, err)
	}
	if len(s.List("r", "a.txt")) != 0 {
		t.Fatalf("expected a.txt to be empty")
	}
	if len(s.List("r", "b.txt")) != 2 {
		t.Fatalf("expected b.txt to be untouched")
	}
}

func TestShouldSnapshot(t *testing.T) {
	s := &Store{Config: Config{MaxFileSize: 0}}
	if !s.ShouldSnapshot(1 << 30) {
		t.Fatalf("MaxFileSize=0 should mean unlimited")
	}
	s = &Store{Config: Config{MaxFileSize: 100}}
	if s.ShouldSnapshot(101) {
		t.Fatalf("should refuse 101 bytes when cap is 100")
	}
	if !s.ShouldSnapshot(100) {
		t.Fatalf("should accept exactly at the cap")
	}
}

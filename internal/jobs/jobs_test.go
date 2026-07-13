package jobs

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"io"
	"sync"
	"testing"

	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/internal/storage"

	_ "modernc.org/sqlite"
)

// memProvider is an in-memory StorageProvider for tests.
type memProvider struct {
	mu  sync.Mutex
	files map[string][]byte
	dirs  map[string]bool
}

func newMemProvider() *memProvider {
	return &memProvider{files: map[string][]byte{}, dirs: map[string]bool{}}
}

func (m *memProvider) List(path string) ([]storage.FileInfo, error) { return nil, nil }
func (m *memProvider) Stat(path string) (storage.FileInfo, error) {
	m.mu.Lock(); defer m.mu.Unlock()
	if m.dirs[path] {
		return storage.FileInfo{Path: path, IsDir: true}, nil
	}
	if d, ok := m.files[path]; ok {
		return storage.FileInfo{Path: path, Size: int64(len(d))}, nil
	}
	return storage.FileInfo{}, storage.ErrNotFound
}
func (m *memProvider) Read(path string) (io.ReadCloser, error) {
	m.mu.Lock(); defer m.mu.Unlock()
	d, ok := m.files[path]
	if !ok {
		return nil, storage.ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(d)), nil
}
func (m *memProvider) Write(path string, r io.Reader, _ int64) error {
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	m.mu.Lock(); defer m.mu.Unlock()
	m.files[path] = b
	return nil
}
func (m *memProvider) CreateDirectory(path string) error {
	m.mu.Lock(); defer m.mu.Unlock()
	m.dirs[path] = true
	return nil
}
func (m *memProvider) Move(_, _ string) error        { return nil }
func (m *memProvider) Copy(_, _ string) error        { return nil }
func (m *memProvider) Delete(path string) error {
	m.mu.Lock(); defer m.mu.Unlock()
	delete(m.files, path)
	delete(m.dirs, path)
	return nil
}
func (m *memProvider) OpenRange(path string, _, _ int64) (io.ReadCloser, int64, error) {
	rc, err := m.Read(path)
	return rc, 0, err
}
func (m *memProvider) Search(_ storage.SearchQuery) ([]storage.FileInfo, error) { return nil, nil }
func (m *memProvider) GetQuota() (storage.Quota, error)                         { return storage.Quota{}, nil }

// rootedProvider wraps a memProvider but stores the archive file under a
// known path so doExtract can Read it via the same provider.
type rootedProvider struct {
	*memProvider
	archivePath string
}

func makeZipBytes(t *testing.T, entries map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip entry: %v", err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatalf("zip write: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

func newJobsManager(t *testing.T, archiveRel string, archiveData []byte) (*Manager, *memProvider) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:nexora_jobs_test?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`CREATE TABLE jobs(
		id TEXT PRIMARY KEY, type TEXT, status TEXT, user_id TEXT, root_id TEXT,
		payload TEXT, progress REAL, error TEXT, created_at TEXT, updated_at TEXT
	)`); err != nil {
		t.Fatal(err)
	}

	mp := newMemProvider()
	mp.files[archiveRel] = archiveData

	// Build a RootService whose single root hands out our in-memory provider.
	rootsDB, derr := sql.Open("sqlite", "file:nexora_roots_test?mode=memory&cache=shared")
	if derr != nil {
		t.Fatal(derr)
	}
	t.Cleanup(func() { rootsDB.Close() })
	rootsDB.SetMaxOpenConns(1)
	if _, err := rootsDB.Exec(`CREATE TABLE storage_roots(
		id TEXT PRIMARY KEY, name TEXT, path TEXT, read_only INTEGER, enabled INTEGER, indexed INTEGER, created_at TEXT, updated_at TEXT
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := rootsDB.Exec(`INSERT INTO storage_roots(id,name,path,read_only,enabled,indexed,created_at,updated_at)
		VALUES('r1','root','/data',0,1,1,'','')`); err != nil {
		t.Fatal(err)
	}
	rs := storage.NewRootService(rootsDB)
	// Override the cache so ProviderFor returns our memProvider for r1.
	rs.SetProviderForTest("r1", mp)

	m := NewManager(db, rs, logger.New("info", "test"), t.TempDir(), 1)
	t.Cleanup(m.Stop)
	return m, mp
}

func TestDoExtractZipSlipBlocked(t *testing.T) {
	archive := makeZipBytes(t, map[string][]byte{
		"out/../../escape.txt": []byte("pwned"),
		"out/good.txt":         []byte("ok"),
	})
	m, _ := newJobsManager(t, "evil.zip", archive)

	if err := m.doExtract("job_x", ExtractPayload{RootID: "r1", Path: "evil.zip", Dest: "out"}); err == nil {
		t.Fatal("expected zip-slip to be blocked, got nil error")
	}
}

func TestDoExtractSafe(t *testing.T) {
	archive := makeZipBytes(t, map[string][]byte{
		"out/sub/file.txt": []byte("hello"),
		"out/top.txt":      []byte("world"),
	})
	m, mp := newJobsManager(t, "good.zip", archive)

	if err := m.doExtract("job_y", ExtractPayload{RootID: "r1", Path: "good.zip", Dest: "out"}); err != nil {
		t.Fatalf("safe extract failed: %v", err)
	}
	mp.mu.Lock()
	got := mp.files["out/sub/file.txt"]
	mp.mu.Unlock()
	if string(got) != "hello" {
		t.Errorf("extracted content = %q, want hello", got)
	}
}

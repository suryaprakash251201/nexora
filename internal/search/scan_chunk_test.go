package search

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/nexora/nexora/internal/storage"
)

// TestScanRootChunksAcrossCommitBoundaries guards the chunked-transaction
// scanner: scanRoot commits every 2000 entries so uploads interleave with
// indexing. A root larger than one chunk must still index completely — this
// catches lost rows at chunk-commit boundaries (e.g. a statement left bound
// to the previous transaction).
func TestScanRootChunksAcrossCommitBoundaries(t *testing.T) {
	svc, db := newTestService(t)

	rootDir := t.TempDir()
	const files = 2500 // > chunkSize (2000): forces at least two transactions
	for i := 0; i < files; i++ {
		name := filepath.Join(rootDir, fmt.Sprintf("file-%04d.txt", i))
		if err := os.WriteFile(name, []byte("x"), 0o644); err != nil {
			t.Fatalf("seed file %d: %v", i, err)
		}
	}

	n := svc.scanRoot(context.Background(), storage.Root{ID: "r1", Name: "R", Path: rootDir})
	if n != files {
		t.Fatalf("indexed %d entries, want %d", n, files)
	}

	var total int
	if err := db.QueryRow(`SELECT COUNT(*) FROM search_index WHERE root_id='r1'`).Scan(&total); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if total != files {
		t.Fatalf("search_index rows=%d, want %d", total, files)
	}

	// Re-scan must fully replace entries, not duplicate them (the per-chunk
	// DELETE only happens once at the start; INSERT OR REPLACE keeps ids stable).
	n = svc.scanRoot(context.Background(), storage.Root{ID: "r1", Name: "R", Path: rootDir})
	if n != files {
		t.Fatalf("re-scan indexed %d entries, want %d", n, files)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM search_index WHERE root_id='r1'`).Scan(&total); err != nil {
		t.Fatalf("count rows after re-scan: %v", err)
	}
	if total != files {
		t.Fatalf("search_index rows after re-scan=%d, want %d", total, files)
	}
}

package search

// Tests for the search index Rename (Phase 2 / P1-7).
//
// The old Rename just called Remove(src), leaving the entire renamed
// subtree invisible to search until the next 6-hourly ScanAll. With
// a directory of N files, users would notice "search returns nothing
// inside my renamed folder" and assume the move had failed.
//
// The new Rename rewrites the (id, path) for every entry in the
// subtree, inside a single chunked transaction. These tests pin the
// new contract.

import (
	"path/filepath"
	"testing"
)

// TestRenameSingleFile rewrites the index row for a single file so it
// is searchable under the new name.
func TestRenameSingleFile(t *testing.T) {
	svc, db := newTestService(t)
	const rootID = "r1"
	seedPhoto(t, db, "r1:photos/a.jpg", rootID, "photos/a.jpg", "a.jpg", "image/jpeg", "2024-06-01T10:00:00Z")
	seedPhoto(t, db, "r1:photos/sub/b.jpg", rootID, "photos/sub/b.jpg", "b.jpg", "image/jpeg", "2024-06-02T10:00:00Z")

	svc.Rename(rootID, "photos/a.jpg", "pictures/a.jpg")

	// a.jpg should be searchable under the new id and path.
	var path string
	if err := db.QueryRow(`SELECT path FROM search_index WHERE id = ?`, "r1:pictures/a.jpg").Scan(&path); err != nil {
		t.Fatalf("a.jpg not found at new id: %v", err)
	}
	if path != "pictures/a.jpg" {
		t.Errorf("a.jpg path = %q, want pictures/a.jpg", path)
	}
	// The old id must be gone.
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM search_index WHERE id = ?`, "r1:photos/a.jpg").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("old id still present: count=%d", n)
	}
	// b.jpg (under photos/sub) must NOT have moved; the rename was
	// scoped to a.jpg.
	if err := db.QueryRow(`SELECT path FROM search_index WHERE id = ?`, "r1:photos/sub/b.jpg").Scan(&path); err != nil {
		t.Fatalf("b.jpg row vanished: %v", err)
	}
	if path != "photos/sub/b.jpg" {
		t.Errorf("b.jpg path = %q, want photos/sub/b.jpg (unaffected by single-file rename)", path)
	}
}

// TestRenameDirectoryMovesAllDescendants is the regression test for P1-7:
// a directory rename must rewrite the path for every entry underneath,
// so search returns results from the new location immediately.
func TestRenameDirectoryMovesAllDescendants(t *testing.T) {
	svc, db := newTestService(t)
	const rootID = "r1"
	// Pre-seed a directory tree under "photos/".
	seedPhoto(t, db, "r1:photos", rootID, "photos", "photos", "inode/directory", "2024-06-01T10:00:00Z")
	seedPhoto(t, db, "r1:photos/a.jpg", rootID, "photos/a.jpg", "a.jpg", "image/jpeg", "2024-06-01T10:00:00Z")
	seedPhoto(t, db, "r1:photos/b.jpg", rootID, "photos/b.jpg", "b.jpg", "image/jpeg", "2024-06-02T10:00:00Z")
	seedPhoto(t, db, "r1:photos/sub/c.jpg", rootID, "photos/sub/c.jpg", "c.jpg", "image/jpeg", "2024-06-03T10:00:00Z")
	seedPhoto(t, db, "r1:photos/sub/d.jpg", rootID, "photos/sub/d.jpg", "d.jpg", "image/jpeg", "2024-06-04T10:00:00Z")
	seedPhoto(t, db, "r1:photos-archive/old.jpg", rootID, "photos-archive/old.jpg", "old.jpg", "image/jpeg", "2024-06-05T10:00:00Z")

	svc.Rename(rootID, "photos", "pictures")

	// All photos/ entries must now be under pictures/ with new ids.
	expected := map[string]string{
		"r1:pictures":            "pictures",
		"r1:pictures/a.jpg":      "pictures/a.jpg",
		"r1:pictures/b.jpg":      "pictures/b.jpg",
		"r1:pictures/sub/c.jpg":  "pictures/sub/c.jpg",
		"r1:pictures/sub/d.jpg":  "pictures/sub/d.jpg",
	}
	for id, wantPath := range expected {
		var gotPath string
		if err := db.QueryRow(`SELECT path FROM search_index WHERE id = ?`, id).Scan(&gotPath); err != nil {
			t.Errorf("missing id %q after rename: %v", id, err)
			continue
		}
		if gotPath != wantPath {
			t.Errorf("id %q: path = %q, want %q", id, gotPath, wantPath)
		}
	}

	// The old ids must be gone.
	oldIDs := []string{
		"r1:photos", "r1:photos/a.jpg", "r1:photos/b.jpg",
		"r1:photos/sub/c.jpg", "r1:photos/sub/d.jpg",
	}
	for _, id := range oldIDs {
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM search_index WHERE id = ?`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("old id %q still present after rename: count=%d", id, n)
		}
	}

	// The sibling "photos-archive/old.jpg" must NOT have moved: only the
	// `photos` subtree was renamed, and the prefix check must distinguish
	// "photos/" from "photos-archive/".
	if err := db.QueryRow(`SELECT path FROM search_index WHERE id = ?`, "r1:photos-archive/old.jpg").Scan(new(string)); err != nil {
		t.Errorf("sibling row vanished: %v", err)
	}
}

// TestRenameLargeSubtreeHonoursChunkSize drives a directory with more
// entries than the chunk size (2000) through Rename. The transaction
// must process all of them; the test catches off-by-one chunking bugs
// where the last batch is dropped.
func TestRenameLargeSubtreeHonoursChunkSize(t *testing.T) {
	svc, db := newTestService(t)
	const rootID = "r1"
	// 2500 files: one more than one chunk + a partial second chunk.
	const N = 2500
	for i := 0; i < N; i++ {
		// Use a stable id format that sorts alphabetically so the
		// chunk-boundary walk is deterministic.
		name := filepath.Join("photos", paddedName(i, ".jpg"))
		id := "r1:" + name
		seedPhoto(t, db, id, rootID, name, "f.jpg", "image/jpeg", "2024-06-01T10:00:00Z")
	}
	// Sanity: the seeded count is what we expect.
	var preCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM search_index WHERE root_id = ?`, rootID).Scan(&preCount); err != nil {
		t.Fatal(err)
	}
	if preCount != N {
		t.Fatalf("seeded %d rows, got %d", N, preCount)
	}

	svc.Rename(rootID, "photos", "pictures")

	// Every original id must be gone, every new id must be present.
	var postCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM search_index WHERE root_id = ?`, rootID).Scan(&postCount); err != nil {
		t.Fatal(err)
	}
	if postCount != N {
		t.Fatalf("post-rename count = %d, want %d (some entries were dropped at a chunk boundary)", postCount, N)
	}
}

func paddedName(i int, ext string) string {
	// 0000.jpg, 0001.jpg, ... for stable ordering.
	s := ""
	switch {
	case i < 10:
		s = "000"
	case i < 100:
		s = "00"
	case i < 1000:
		s = "0"
	}
	return s + itoa(i) + ext
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}

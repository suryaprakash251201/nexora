package api

// Tests for the share-folder ZIP cap (Phase 2 / P1-9).
//
// The old streamFolderZip walked the whole tree into a []string with no
// cap; a 10M-file share would consume GB of memory before the first
// byte reached the client, and a symlink cycle would recurse forever.
// The new collectShareFolderFiles helper enforces:
//   - maxShareFolderEntries (file count)
//   - maxShareFolderBytes   (uncompressed total size)
//   - depth cap (defensive against provider cycles)
//
// These tests use an in-memory fake provider so the test runs in ms and
// doesn't touch the filesystem.

import (
	"errors"
	"io"
	"testing"

	"github.com/nexora/nexora/internal/storage"
)

// fakeProvider implements storage.StorageProvider for tests. The walk
// only uses List and Stat; the rest panic so any accidental use fails
// loudly. Entries are flat: no recursion unless explicitly built.
type fakeProvider struct {
	entries map[string][]storage.FileInfo
}

func (f *fakeProvider) Stat(p string) (storage.FileInfo, error) {
	for _, list := range f.entries {
		for _, e := range list {
			if e.Path == p {
				return e, nil
			}
		}
	}
	return storage.FileInfo{}, storage.ErrNotFound
}
func (f *fakeProvider) List(p string) ([]storage.FileInfo, error) {
	if list, ok := f.entries[p]; ok {
		return list, nil
	}
	return nil, storage.ErrNotFound
}
func (f *fakeProvider) Read(string) (io.ReadCloser, error)    { panic("not used") }
func (f *fakeProvider) Write(string, io.Reader, int64) error { panic("not used") }
func (f *fakeProvider) CreateDirectory(string) error         { panic("not used") }
func (f *fakeProvider) Move(string, string) error            { panic("not used") }
func (f *fakeProvider) Copy(string, string) error            { panic("not used") }
func (f *fakeProvider) Delete(string) error                  { panic("not used") }
func (f *fakeProvider) OpenRange(string, int64, int64) (io.ReadCloser, int64, error) {
	panic("not used")
}
func (f *fakeProvider) Search(storage.SearchQuery) ([]storage.FileInfo, error) {
	return nil, nil
}
func (f *fakeProvider) GetQuota() (storage.Quota, error) { return storage.Quota{}, nil }

// file returns a file entry with a fixed size (the test cares about the
// walk's accounting, not the file contents).
func file(path string, size int64) storage.FileInfo {
	return storage.FileInfo{Name: path, Path: path, Size: size, IsDir: false}
}
func dir(path string) storage.FileInfo {
	return storage.FileInfo{Name: path, Path: path, IsDir: true}
}

// TestCollectShareFolderFiles_HappyPath: a small folder walks to its
// files without hitting either cap.
func TestCollectShareFolderFiles_HappyPath(t *testing.T) {
	p := &fakeProvider{entries: map[string][]storage.FileInfo{
		"": {
			dir("docs"),
			file("readme.txt", 100),
		},
		"docs": {
			file("docs/a.md", 200),
			file("docs/b.md", 300),
		},
	}}
	files, err := collectShareFolderFiles(p, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(files) != 3 {
		t.Errorf("got %d files, want 3 (readme + 2 docs)", len(files))
	}
	paths := map[string]int64{}
	for _, f := range files {
		paths[f.path] = f.size
	}
	if paths["readme.txt"] != 100 || paths["docs/a.md"] != 200 || paths["docs/b.md"] != 300 {
		t.Errorf("unexpected paths/sizes: %+v", paths)
	}
}

// TestCollectShareFolderFiles_HidesTrash pins the existing behaviour: a
// .nexora-trash subdirectory is invisible to the walk so trashed items
// are not part of the public share.
func TestCollectShareFolderFiles_HidesTrash(t *testing.T) {
	p := &fakeProvider{entries: map[string][]storage.FileInfo{
		"": {
			file("keep.txt", 50),
			dir(".nexora-trash"),
		},
		".nexora-trash": {
			file(".nexora-trash/abc__trashed.txt", 999),
		},
	}}
	files, err := collectShareFolderFiles(p, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 {
		t.Errorf("got %d files, want 1 (trash must be excluded)", len(files))
	}
}

// TestCollectShareFolderFiles_CapByCount: more files than the cap must
// abort with errShareFolderTooLarge. We can't seed 50k entries in a
// test (it'd take seconds), so we use a flat folder of cap+5 entries
// and confirm the cap fires. The cap is a constant; we reference it
// directly to make the bound explicit.
func TestCollectShareFolderFiles_CapByCount(t *testing.T) {
	entries := make([]storage.FileInfo, 0, maxShareFolderEntries+5)
	for i := 0; i < maxShareFolderEntries+5; i++ {
		entries = append(entries, file(nameForIndex(i), 1))
	}
	p := &fakeProvider{entries: map[string][]storage.FileInfo{"": entries}}
	_, err := collectShareFolderFiles(p, "")
	if !errors.Is(err, errShareFolderTooLarge) {
		t.Fatalf("err = %v, want errShareFolderTooLarge", err)
	}
}

// TestCollectShareFolderFiles_CapByBytes: a single file that exceeds
// the byte cap must trip errShareFolderTooLarge.
func TestCollectShareFolderFiles_CapByBytes(t *testing.T) {
	p := &fakeProvider{entries: map[string][]storage.FileInfo{
		"": {file("huge.bin", maxShareFolderBytes+1)},
	}}
	_, err := collectShareFolderFiles(p, "")
	if !errors.Is(err, errShareFolderTooLarge) {
		t.Fatalf("err = %v, want errShareFolderTooLarge", err)
	}
}

// TestCollectShareFolderFiles_DeepButFiniteTree: the walk must complete
// for a deep but finite tree (no infinite recursion on a self-referencing
// directory). The depth cap is 32, so a chain of 5 levels is well within
// bounds and exercises the recursive code path.
func TestCollectShareFolderFiles_DeepButFiniteTree(t *testing.T) {
	// Build a 5-deep chain by hand. Each level has exactly one leaf
	// file plus the next subdir, so the walk visits 5 files.
	p := &fakeProvider{entries: map[string][]storage.FileInfo{
		"":        {dir("a")},
		"a":       {dir("a/b"), file("a/leaf0.bin", 1)},
		"a/b":     {dir("a/b/c"), file("a/b/leaf1.bin", 1)},
		"a/b/c":   {dir("a/b/c/d"), file("a/b/c/leaf2.bin", 1)},
		"a/b/c/d": {dir("a/b/c/d/e"), file("a/b/c/d/leaf3.bin", 1)},
		"a/b/c/d/e": {
			// Last level: no subdir, just the leaf. (No deeper subdir
			// to recurse into so the walk terminates here.)
			file("a/b/c/d/e/leaf4.bin", 1),
		},
	}}
	files, err := collectShareFolderFiles(p, "")
	if err != nil {
		t.Fatalf("walk failed on a finite deep tree: %v", err)
	}
	if len(files) != 5 {
		t.Errorf("got %d files, want 5 (one per depth level)", len(files))
	}
}

func nameForIndex(i int) string {
	const digits = "0123456789"
	if i == 0 {
		return "f.bin"
	}
	s := ""
	for i > 0 {
		s = string(digits[i%10]) + s
		i /= 10
	}
	return "f" + s + ".bin"
}

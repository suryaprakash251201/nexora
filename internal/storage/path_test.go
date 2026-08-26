package storage

import (
	"path/filepath"
	"testing"
)

func TestCleanRelative(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"", "", false},
		{".", "", false},
		{"/", "", false},
		{"a/b/c", "a/b/c", false},
		{"a//b/../c", "a/c", false},
		{"./foo/./bar", "foo/bar", false},
		{"a/b/..", "a", false},
		{"a/./b/", "a/b", false},
		{"a\x00b", "", true}, // null byte rejected
		{"a\\b", "", true},   // backslash rejected
	}
	for _, c := range cases {
		got, err := CleanRelative(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("CleanRelative(%q) = %q, want error", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("CleanRelative(%q) unexpected error: %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("CleanRelative(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestResolveStaysInRoot verifies that Resolve is the real traversal guard:
// it rejects any path that would escape the root directory.
func TestResolveStaysInRoot(t *testing.T) {
	root := filepath.Clean(t.TempDir())
	if _, err := Resolve(root, "docs/report.txt"); err != nil {
		t.Errorf("Resolve valid path error: %v", err)
	}
	if _, err := Resolve(root, "../etc/passwd"); err != ErrTraversal {
		t.Errorf("Resolve traversal = %v, want ErrTraversal", err)
	}
	if _, err := Resolve(root, "../../b"); err != ErrTraversal {
		t.Errorf("Resolve traversal = %v, want ErrTraversal", err)
	}
	if _, err := Resolve(root, "a/../../b"); err != ErrTraversal {
		t.Errorf("Resolve traversal = %v, want ErrTraversal", err)
	}
}

func TestExtAndName(t *testing.T) {
	if Ext("PHOTO.JPG") != "jpg" {
		t.Errorf("Ext casing wrong: %q", Ext("PHOTO.JPG"))
	}
	if Ext("noext") != "" {
		t.Errorf("Ext noext should be empty")
	}
	if NameFromPath("a/b/c.txt") != "c.txt" {
		t.Errorf("NameFromPath wrong: %q", NameFromPath("a/b/c.txt"))
	}
	if NameFromPath("top") != "top" {
		t.Errorf("NameFromPath single wrong: %q", NameFromPath("top"))
	}
}

// TestIsInside pins the boundary-aware containment check used by the
// static-file handler. The naive "starts with root" prefix check would
// falsely accept "/data2" as inside "/data"; the trailing separator is
// what catches that.
func TestIsInside(t *testing.T) {
	sep := string(filepath.Separator)
	cases := []struct {
		root, candidate string
		want            bool
	}{
		{"/app/web" + sep, "/app/web" + sep, true},                                // root itself
		{"/app/web" + sep, "/app/web/index.html", true},                            // file directly under
		{"/app/web" + sep, "/app/web/assets/index-abc.js", true},                   // nested file
		{"/app/web" + sep, "/app/web-archive/index.html", false},                   // sibling
		{"/app/web" + sep, "/app/web2/index.html", false},                          // similar prefix
		{"/app/web" + sep, "/etc/passwd", false},                                   // unrelated
		{"/app/web", "/app/web/index.html", true},                                  // root without trailing sep
		{"/app/web", "/app/web-archive", false},                                    // sibling without trailing sep
		{"/app/web" + sep, filepath.Clean("/app/web/../web/index.html"), true},     // resolves to a child
		{"/app/web" + sep, filepath.Clean("/app/web/../../etc/passwd"), false},     // escapes root
		{"", "/anything", false},                                                   // empty root
		{"/anything", "", false},                                                   // empty candidate
	}
	for _, c := range cases {
		got := IsInside(c.root, c.candidate)
		if got != c.want {
			t.Errorf("IsInside(%q, %q) = %v, want %v", c.root, c.candidate, got, c.want)
		}
	}
}

// TestIsAncestor exercises the "folder-into-itself" guard used by move/copy
// handlers. The empty string is the root and is an ancestor of every other
// path; equal paths are also considered an ancestor (so callers must reject
// src == dst explicitly when they care).
func TestIsAncestor(t *testing.T) {
	cases := []struct {
		ancestor, descendant string
		want                 bool
	}{
		{"", "a", true},
		{"", "", false}, // root is not an ancestor of "nothing"
		{"photos", "photos/2024/jan/img.jpg", true},
		{"photos", "photos", true},
		{"photos", "photos-archive", false}, // sibling, not descendant
		{"photos", "photos2/2024", false},   // sibling with similar name
		{"a/b", "a/b/c", true},
		{"a/b", "a/bc", false}, // "a/b" is NOT a prefix of "a/bc"
		{"a/b", "a/b/c/d", true},
		{"a/b/c", "a/b", false}, // reversed — c is not an ancestor of b
	}
	for _, c := range cases {
		got := IsAncestor(c.ancestor, c.descendant)
		if got != c.want {
			t.Errorf("IsAncestor(%q, %q) = %v, want %v", c.ancestor, c.descendant, got, c.want)
		}
		// Sanity: the function is a strict partial order (irreflexive on
		// non-empty distinct inputs). For distinct inputs, it must not be
		// true in BOTH directions.
		if c.ancestor != c.descendant {
			rev := IsAncestor(c.descendant, c.ancestor)
			if got && rev {
				t.Errorf("IsAncestor bidirectional on distinct inputs: (%q,%q) and (%q,%q) both true",
					c.ancestor, c.descendant, c.descendant, c.ancestor)
			}
		}
	}
}

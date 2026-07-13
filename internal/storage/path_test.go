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

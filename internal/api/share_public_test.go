package api

import (
	"strings"
	"testing"

	"github.com/nexora/nexora/internal/sharing"
)

func TestResolveShareSub(t *testing.T) {
	cases := []struct {
		name    string
		shPath  string
		sub     string
		want    string
		wantErr bool
	}{
		{"no sub on file share", "Music/song.mp3", "", "Music/song.mp3", false},
		{"no sub on folder share", "Music/Album", "", "Music/Album", false},
		{"file inside folder", "Music/Album", "01 Track.wav", "Music/Album/01 Track.wav", false},
		{"nested file inside folder", "Music/Album", "CD1/02 Track.flac", "Music/Album/CD1/02 Track.flac", false},
		{"root share", "", "folder/a.txt", "folder/a.txt", false},
		{"traversal rejected", "Music/Album", "../../etc/passwd", "", true},
		{"traversal via clean", "Music/Album", "..%2f..%2fetc", "", true},
		{"sibling escape rejected", "Music/Album", "../Other/file.txt", "", true},
		{"empty sub cleans to root", "Music/Album", "./", "Music/Album", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveShareSub(sharing.Share{Path: tc.shPath}, tc.sub)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestResolveShareSubRejectsEncodedTraversal(t *testing.T) {
	// URL-decoding happens before this function in the handler (chi/query), so
	// ".." must never survive cleanup.
	_, err := resolveShareSub(sharing.Share{Path: "Music/Album"}, "../..")
	if err == nil {
		t.Fatal("expected traversal error")
	}
	if !strings.Contains(err.Error(), "traversal") {
		t.Fatalf("expected traversal error, got %v", err)
	}
}

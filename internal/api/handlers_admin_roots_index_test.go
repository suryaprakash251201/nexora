package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nexora/nexora/internal/search"
)

// TestAdminCreateRootIndexesIt guards the user-visible symptom: a root added
// through the admin console was not scanned, so search (and photos, usage
// stats, playlist lookups — everything that reads search_index) stayed empty
// until the next 6-hourly sweep. Creating a root now kicks off a scan.
func TestAdminCreateRootIndexesIt(t *testing.T) {
	s, sessions, _ := setupTagsTest(t)
	s.Search = search.NewService(s.DB, s.StorageRoots, s.Log)

	h := s.Routes()
	tok := mustSession(t, sessions)

	mediaDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(mediaDir, "tone test.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	rec := tagReq(t, h, "POST", "/api/v1/admin/roots", tok, map[string]any{
		"name":    "Media",
		"path":    mediaDir,
		"type":    "local",
		"indexed": true,
		"enabled": true,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create root: %d %s", rec.Code, rec.Body.String())
	}

	// The scan runs in the background, so poll for the indexed row.
	deadline := time.Now().Add(5 * time.Second)
	var indexed int
	for time.Now().Before(deadline) {
		if err := s.DB.QueryRow(
			`SELECT COUNT(*) FROM search_index WHERE name = 'tone test.txt'`,
		).Scan(&indexed); err != nil {
			t.Fatal(err)
		}
		if indexed > 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if indexed == 0 {
		t.Fatal("newly created root was never indexed; search would return nothing for it")
	}

	// And the search endpoint actually returns the file.
	rec = tagReq(t, h, "GET", "/api/v1/search?q=tone", tok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("search: %d %s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); !strings.Contains(body, "tone test.txt") {
		t.Fatalf("search response missing the indexed file: %s", body)
	}
}

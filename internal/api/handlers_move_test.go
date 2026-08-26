package api

// Integration tests for the folder-into-self guard (Phase 1 / P0-1).
//
// Without the guard, a user with write access to a root could issue
//   move src=photos dst=photos/2024
// which on a real filesystem becomes an unreachable tree (or, on some
// providers, an infinite recursion). These tests pin the new behavior:
// every (move|copy|rename) request whose destination is the source or
// a strict descendant of the source is rejected with 400 invalid_destination
// before any storage call.
//
// Each subtest gets its own on-disk fixture so a destructive case (sibling
// move) cannot leave the next case without a source file.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nexora/nexora/internal/audit"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/config"
	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/playlists"
	"github.com/nexora/nexora/internal/storage"
)

type moveCase struct {
	name      string
	method    string
	url       string
	body      string
	wantCode  int
	// SetupDirs are the on-disk subdirectories to create under the root
	// before issuing the request. Useful for the "sibling move" test
	// that needs a real destination parent.
	setupDirs []string
}

func TestMoveCopyRenameFolderIntoSelf(t *testing.T) {
	// Subtest-local DBs and roots so each case starts with a clean tree.
	// We still use one outer t to share the fixture plumbing.
	cases := []moveCase{
		{
			name:      "move folder into direct child",
			method:    "POST",
			url:       "/api/v1/files/move",
			body:      `{"root":"root_x","source":"photos","destination":"photos/2024"}`,
			wantCode:  http.StatusBadRequest,
			setupDirs: []string{"photos", "photos/2024", "photos/2024/jan"},
		},
		{
			name:      "move folder into deep descendant",
			method:    "POST",
			url:       "/api/v1/files/move",
			body:      `{"root":"root_x","source":"photos","destination":"photos/2024/jan/img.jpg"}`,
			wantCode:  http.StatusBadRequest,
			setupDirs: []string{"photos", "photos/2024", "photos/2024/jan"},
		},
		{
			name:      "copy folder into direct child",
			method:    "POST",
			url:       "/api/v1/files/copy",
			body:      `{"root":"root_x","source":"photos","destination":"photos/2024"}`,
			wantCode:  http.StatusBadRequest,
			setupDirs: []string{"photos", "photos/2024", "photos/2024/jan"},
		},
		{
			name:      "copy folder into deep descendant",
			method:    "POST",
			url:       "/api/v1/files/copy",
			body:      `{"root":"root_x","source":"photos","destination":"photos/2024/jan"}`,
			wantCode:  http.StatusBadRequest,
			setupDirs: []string{"photos", "photos/2024", "photos/2024/jan"},
		},
		// A *legitimate* sibling move must still succeed: this confirms
		// the guard does not over-reject.
		{
			name:      "move folder to legitimate sibling (allowed)",
			method:    "POST",
			url:       "/api/v1/files/move",
			body:      `{"root":"root_x","source":"photos/2024","destination":"photos-2024-archive"}`,
			wantCode:  http.StatusOK,
			setupDirs: []string{"photos", "photos/2024"},
		},
		// A *legitimate* sibling rename must succeed: `photos/2024` → `jan`
		// resolves to `photos/jan` (a sibling of 2024, not a descendant),
		// so the ancestor guard must NOT fire.
		{
			name:      "rename directory to a same-parent sibling (allowed)",
			method:    "POST",
			url:       "/api/v1/files/rename",
			body:      `{"root":"root_x","path":"photos/2024","name":"jan-renamed"}`,
			wantCode:  http.StatusOK,
			setupDirs: []string{"photos", "photos/2024", "photos/2024/jan"},
		},
		// Sanity: a non-existent source that the guard would not block
		// still ends in a 500 from the provider (os.Rename ENOENT). This
		// pins the *negative* contract: the guard does not over-eagerly
		// reject unknown paths.
		{
			name:     "move a non-existent file to a same-prefix path is not blocked by the guard",
			method:   "POST",
			url:      "/api/v1/files/move",
			body:     `{"root":"root_x","source":"nope/never","destination":"nope-new/never"}`,
			wantCode: http.StatusInternalServerError,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h, csrf, sessionCookie, _ := newMoveTestHarness(t, c.setupDirs)
			req := httptest.NewRequest(c.method, c.url, strings.NewReader(c.body))
			req.Header.Set("Content-Type", "application/json")
			req.AddCookie(sessionCookie)
			req.AddCookie(&http.Cookie{Name: "nexora_csrf", Value: csrf, Path: "/"})
			req.Header.Set("X-CSRF-Token", csrf)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			if rec.Code != c.wantCode {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, c.wantCode, rec.Body.String())
			}
			// For the rejected cases, the response must be the JSON envelope
			// with error="invalid_destination" so the web client can render
			// a clear toast.
			if c.wantCode == http.StatusBadRequest {
				var env map[string]any
				if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
					t.Fatalf("response is not JSON: %s", rec.Body.String())
				}
				if env["error"] != "invalid_destination" {
					t.Errorf("error = %v, want invalid_destination; body=%s", env["error"], rec.Body.String())
				}
			}
		})
	}
}

// newMoveTestHarness builds a fresh DB, root, and session per subtest. It
// also creates any requested on-disk directories under the storage root so
// the storage layer wouldn't reject the request for a missing path when
// the guard is supposed to allow it through.
func newMoveTestHarness(t *testing.T, setupDirs []string) (http.Handler, string, *http.Cookie, string) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := database.Open("sqlite", dbPath, "")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	users := auth.NewUserStore(db)
	sessions := auth.NewSessionStore(db, 24*time.Hour)
	roots := storage.NewRootService(db)
	u := auth.User{ID: "usr_test", Username: "u", Email: "u@x", PasswordHash: "x", Role: auth.RoleUser, Status: "active"}
	if _, err := users.Create(u); err != nil {
		t.Fatalf("create user: %v", err)
	}
	rootDir := t.TempDir()
	for _, rel := range setupDirs {
		if err := os.MkdirAll(filepath.Join(rootDir, rel), 0o755); err != nil {
			t.Fatalf("setup mkdir %q: %v", rel, err)
		}
	}
	if _, err := roots.Create(storage.Root{ID: "root_x", Name: "R", Path: rootDir, Type: "local", Enabled: true, Indexed: true}); err != nil {
		t.Fatalf("create root: %v", err)
	}
	if err := roots.Grant(u.ID, "root_x", storage.PermWrite); err != nil {
		t.Fatalf("grant: %v", err)
	}

	s := NewServer(Deps{
		Cfg:       &config.Config{},
		Log:       logger.New("error", "test"),
		DB:        db,
		Users:     users,
		Sessions:  sessions,
		Audit:     audit.NewStore(db),
		Guard:     auth.NewLoginGuard(5, 15*time.Minute),
		Limiter:   middleware.NewRateLimiter(60, time.Minute),
		Roots:     roots,
		Playlists: playlists.NewStore(db),
	})
	h := s.Routes()

	sess, err := sessions.Create(u.ID, "127.0.0.1", "test")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	sessionCookie := &http.Cookie{Name: auth.SessionCookieName, Value: sess.Token, Path: "/"}
	warm := httptest.NewRequest("GET", "/api/v1/roots", nil)
	warm.AddCookie(sessionCookie)
	pre := httptest.NewRecorder()
	h.ServeHTTP(pre, warm)
	var csrf string
	for _, c := range pre.Result().Cookies() {
		if c.Name == "nexora_csrf" {
			csrf = c.Value
		}
	}
	return h, csrf, sessionCookie, rootDir
}

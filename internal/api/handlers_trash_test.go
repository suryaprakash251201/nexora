package api

// Tests for the trash-restore handler (Phase 2 / P1-6).
//
// The old code had three problems on the restore path:
//  1. The Stat-then-Move window was a TOCTOU race: a concurrent upload
//     could create the file at the original location between our check
//     and our move, leading to silent overwrites.
//  2. If the final DB DELETE failed after a successful move, the
//     compensating action `_ = acc.provider.Move(...)` swallowed the
//     error. Operators had no way to find the resulting orphan.
//  3. If the final Move failed, the file sat at a unique-but-meaningless
//     intermediate path (the trash path was already moved) with no way
//     to recover it.
//
// The new code:
//  - Restores via a unique temp name, then Moves to the final location.
//  - Logs every undo attempt and audits orphan detections.
//  - Returns a precise 5xx when the compensating action itself fails so
//    the user can be told to contact an admin.

import (
	"database/sql"
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

func newTrashHarness(t *testing.T) (http.Handler, *database.DB, *storage.RootService, string, *http.Cookie) {
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
	return h, db, roots, rootDir, sessionCookie
}

func warmCSRF(t *testing.T, h http.Handler, sessionCookie *http.Cookie) string {
	t.Helper()
	preReq := httptest.NewRequest("GET", "/api/v1/roots", nil)
	preReq.AddCookie(sessionCookie)
	pre := httptest.NewRecorder()
	h.ServeHTTP(pre, preReq)
	for _, c := range pre.Result().Cookies() {
		if c.Name == "nexora_csrf" {
			return c.Value
		}
	}
	t.Fatal("no csrf cookie issued")
	return ""
}

func insertTrashRow(t *testing.T, db *database.DB, id, userID, rootID, original, trash, name string, size int64, isDir bool) {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := db.Exec(`INSERT INTO trash(id, user_id, root_id, original_path, trash_path, name, size, is_dir, deleted_at) VALUES(?,?,?,?,?,?,?,?,?)`,
		id, userID, rootID, original, trash, name, size, isDir, now); err != nil {
		t.Fatalf("insert trash: %v", err)
	}
}

func TestTrashRestore_HappyPath(t *testing.T) {
	h, db, roots, rootDir, sessionCookie := newTrashHarness(t)

	// Plant a trashed file on disk under .nexora-trash/ and a corresponding DB row.
	trashDir := filepath.Join(rootDir, ".nexora-trash")
	if err := os.MkdirAll(trashDir, 0o755); err != nil {
		t.Fatal(err)
	}
	trashName := "abc123__hello.txt"
	trashPath := ".nexora-trash/" + trashName
	if err := os.WriteFile(filepath.Join(rootDir, trashPath), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	insertTrashRow(t, db, "tr_test01", "usr_test", "root_x", "hello.txt", trashPath, "hello.txt", 5, false)

	// Issue the restore.
	body := `{"id":"tr_test01"}`
	req := httptest.NewRequest("POST", "/api/v1/trash/restore", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sessionCookie)
	csrf := warmCSRF(t, h, sessionCookie)
	req.AddCookie(&http.Cookie{Name: "nexora_csrf", Value: csrf, Path: "/"})
	req.Header.Set("X-CSRF-Token", csrf)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	// File must be at the original location.
	if _, err := os.Stat(filepath.Join(rootDir, "hello.txt")); err != nil {
		t.Fatalf("restored file missing at original: %v", err)
	}
	// The temp .restore-... file must NOT linger.
	entries, _ := os.ReadDir(rootDir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".restore-") || strings.HasPrefix(e.Name(), "hello.txt.restore-") {
			t.Errorf("temp file lingered: %s", e.Name())
		}
	}
	// The trash dir should no longer contain this file.
	if _, err := os.Stat(filepath.Join(rootDir, trashPath)); !os.IsNotExist(err) {
		t.Errorf("trashed file still present after restore: err=%v", err)
	}
	// The DB row must be gone.
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM trash WHERE id=?`, "tr_test01").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("trash row not deleted: count=%d", n)
	}
	_ = roots
}

func TestTrashRestore_RejectsWhenOriginalExists(t *testing.T) {
	h, db, roots, rootDir, sessionCookie := newTrashHarness(t)

	// Plant the trashed file and ALSO a conflicting file at the original location.
	trashDir := filepath.Join(rootDir, ".nexora-trash")
	if err := os.MkdirAll(trashDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rootDir, ".nexora-trash", "abc__hello.txt"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rootDir, "hello.txt"), []byte("newer"), 0o644); err != nil {
		t.Fatal(err)
	}
	insertTrashRow(t, db, "tr_test02", "usr_test", "root_x", "hello.txt", ".nexora-trash/abc__hello.txt", "hello.txt", 3, false)

	csrf := warmCSRF(t, h, sessionCookie)
	body := `{"id":"tr_test02"}`
	req := httptest.NewRequest("POST", "/api/v1/trash/restore", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sessionCookie)
	req.AddCookie(&http.Cookie{Name: "nexora_csrf", Value: csrf, Path: "/"})
	req.Header.Set("X-CSRF-Token", csrf)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	var env map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env["error"] != "exists" {
		t.Errorf("error = %v, want exists", env["error"])
	}
	// The trashed file must still be in the trash dir (we never touched it).
	if _, err := os.Stat(filepath.Join(rootDir, ".nexora-trash", "abc__hello.txt")); err != nil {
		t.Errorf("trashed file should be untouched: %v", err)
	}
	// The newer file at the original location must be unchanged.
	got, _ := os.ReadFile(filepath.Join(rootDir, "hello.txt"))
	if string(got) != "newer" {
		t.Errorf("original file changed: got %q, want %q", got, "newer")
	}
	_ = roots
}

func TestTrashRestore_NotYourTrash(t *testing.T) {
	h, db, _, _, sessionCookie := newTrashHarness(t)
	// Insert a trash row owned by someone else.
	insertTrashRow(t, db, "tr_other", "usr_someoneelse", "root_x", "secret.txt", ".nexora-trash/x__secret.txt", "secret.txt", 1, false)

	csrf := warmCSRF(t, h, sessionCookie)
	body := `{"id":"tr_other"}`
	req := httptest.NewRequest("POST", "/api/v1/trash/restore", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sessionCookie)
	req.AddCookie(&http.Cookie{Name: "nexora_csrf", Value: csrf, Path: "/"})
	req.Header.Set("X-CSRF-Token", csrf)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%s", rec.Code, rec.Body.String())
	}
}

// Suppress unused-import warning for sql.
var _ sql.Result

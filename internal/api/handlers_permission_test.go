package api

// Regression test for the "Storage operation failed" black box: uploading or
// deleting inside a subdirectory the process cannot write to (e.g. a year
// folder created by another user after nexora-init ran) used to surface as an
// opaque 500 because *fs.PathError wrapping EACCES matched no case in
// writeProviderError's equality switch. It must map to 403 permission_denied.

import (
	"bytes"
	"mime/multipart"
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

func TestSubdirPermissionErrorsAreActionable(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root — permission bits are bypassed, test meaningless")
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := database.Open("sqlite", dbPath, "")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	users := auth.NewUserStore(db)
	sessions := auth.NewSessionStore(db, 24*time.Hour)
	roots := storage.NewRootService(db)

	u := auth.User{ID: "usr_testadmin", Username: "admin", Email: "admin@test.local", PasswordHash: "x", Role: auth.RoleAdmin, Status: "active"}
	if _, err := users.Create(u); err != nil {
		t.Fatalf("create user: %v", err)
	}

	rootDir := t.TempDir()
	lockedDir := filepath.Join(rootDir, "2024")
	if err := os.Mkdir(lockedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(lockedDir, "existing.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Simulate a folder created by another owner: writable by nobody here.
	if err := os.Chmod(lockedDir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(lockedDir, 0o755) }) // allow TempDir cleanup

	if _, err := roots.Create(storage.Root{ID: "root_test", Name: "Test", Path: rootDir, Type: "local", Enabled: true, Indexed: true}); err != nil {
		t.Fatalf("create root: %v", err)
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

	// Warm up to obtain the CSRF double-submit cookie.
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
	if csrf == "" {
		t.Fatal("no csrf cookie issued")
	}
	csrfCookie := &http.Cookie{Name: "nexora_csrf", Value: csrf, Path: "/"}
	withAuth := func(r *http.Request) *http.Request {
		r.AddCookie(sessionCookie)
		r.AddCookie(csrfCookie)
		r.Header.Set("X-CSRF-Token", csrf)
		return r
	}

	// ── Upload INTO the locked directory → must be 403 permission_denied ──
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("files", "movie.mkv")
	_, _ = fw.Write([]byte("data"))
	_ = mw.Close()
	upReq := withAuth(httptest.NewRequest("POST", "/api/v1/files/upload?root=root_test&path=2024", &buf))
	upReq.Header.Set("Content-Type", mw.FormDataContentType())
	upRec := httptest.NewRecorder()
	h.ServeHTTP(upRec, upReq)

	if upRec.Code == http.StatusInternalServerError {
		t.Fatalf("upload into locked dir returned opaque 500: %s", upRec.Body.String())
	}
	if upRec.Code != http.StatusForbidden || !strings.Contains(upRec.Body.String(), "permission_denied") {
		t.Fatalf("upload status=%d body=%s — want 403 permission_denied", upRec.Code, upRec.Body.String())
	}

	// ── Delete of a file INSIDE the locked directory → same treatment ──
	delReq := withAuth(httptest.NewRequest("DELETE", "/api/v1/files?root=root_test&path=2024/existing.txt", nil))
	delRec := httptest.NewRecorder()
	h.ServeHTTP(delRec, delReq)

	if delRec.Code == http.StatusInternalServerError {
		t.Fatalf("delete in locked dir returned opaque 500: %s", delRec.Body.String())
	}
	if delRec.Code != http.StatusForbidden || !strings.Contains(delRec.Body.String(), "permission_denied") {
		t.Fatalf("delete status=%d body=%s — want 403 permission_denied", delRec.Code, delRec.Body.String())
	}
}

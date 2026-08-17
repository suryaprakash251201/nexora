package api

// Regression test: delete must move the file into .nexora-trash and record a
// trash entry. Guards the "could not record trash entry" bug class where the
// DB write silently fails (e.g. read-only DB file) and deletes appear broken.

import (
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

func TestDeleteMovesToTrashAndRecordsEntry(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := database.Open("sqlite", dbPath, "")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	log := logger.New("error", "test")
	users := auth.NewUserStore(db)
	sessions := auth.NewSessionStore(db, 24*time.Hour)
	guard := auth.NewLoginGuard(5, 15*time.Minute)
	limiter := middleware.NewRateLimiter(60, time.Minute)
	roots := storage.NewRootService(db)
	pl := playlists.NewStore(db)
	cfg := &config.Config{}

	u := auth.User{ID: "usr_testadmin", Username: "admin", Email: "admin@test.local", PasswordHash: "x", Role: auth.RoleAdmin, Status: "active"}
	if _, err := users.Create(u); err != nil {
		t.Fatalf("create user: %v", err)
	}

	rootDir := t.TempDir()
	fileName := "testfile.txt"
	if err := os.WriteFile(filepath.Join(rootDir, fileName), []byte("hello world"), 0o644); err != nil {
		t.Fatalf("create file: %v", err)
	}
	if _, err := roots.Create(storage.Root{ID: "root_test", Name: "Test", Path: rootDir, Type: "local", Enabled: true, Indexed: true}); err != nil {
		t.Fatalf("create root: %v", err)
	}

	s := NewServer(Deps{
		Cfg:       cfg,
		Log:       log,
		DB:        db,
		Users:     users,
		Sessions:  sessions,
		Audit:     audit.NewStore(db),
		Guard:     guard,
		Limiter:   limiter,
		Roots:     roots,
		Playlists: pl,
	})
	h := s.Routes()

	sess, err := sessions.Create(u.ID, "127.0.0.1", "test")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	// Warm up: get a CSRF token from the double-submit cookie.
	req := httptest.NewRequest("GET", "/api/v1/roots", nil)
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: sess.Token, Path: "/"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var csrf string
	for _, c := range rec.Result().Cookies() {
		if c.Name == "nexora_csrf" {
			csrf = c.Value
		}
	}
	if csrf == "" {
		t.Fatal("no csrf cookie issued")
	}

	// DELETE the file -> should move to trash and record a trash row.
	req2 := httptest.NewRequest("DELETE", "/api/v1/files?root=root_test&path="+fileName, nil)
	req2.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: sess.Token, Path: "/"})
	req2.AddCookie(&http.Cookie{Name: "nexora_csrf", Value: csrf, Path: "/"})
	req2.Header.Set("X-CSRF-Token", csrf)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("delete status=%d body=%s", rec2.Code, rec2.Body.String())
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM trash`).Scan(&count); err != nil {
		t.Fatalf("count trash: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 trash row, got %d", count)
	}

	// File must be gone from the root and present under .nexora-trash.
	if _, err := os.Stat(filepath.Join(rootDir, fileName)); err == nil {
		t.Error("file still exists in root after delete")
	}
	entries, err := os.ReadDir(filepath.Join(rootDir, ".nexora-trash"))
	if err != nil {
		t.Fatalf("read .nexora-trash: %v", err)
	}
	if len(entries) != 1 || !strings.HasSuffix(entries[0].Name(), "__"+fileName) {
		t.Fatalf("expected one trashed file ending in __%s, got %v", fileName, entries)
	}
}

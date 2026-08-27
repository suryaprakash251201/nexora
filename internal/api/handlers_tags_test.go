package api

import (
	"encoding/json"
	"io"
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

func setupTagsTest(t *testing.T) (*Server, *auth.SessionStore, string) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := database.Open("sqlite", dbPath, "")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	log := logger.New("error", "test")
	users := auth.NewUserStore(db)
	sessions := auth.NewSessionStore(db, 24*time.Hour)
	guard := auth.NewLoginGuard(5, 15*time.Minute)
	limiter := middleware.NewRateLimiter(60, time.Minute)
	roots := storage.NewRootService(db)
	pl := playlists.NewStore(db)

	u := auth.User{ID: "usr_admin", Username: "admin", Email: "admin@test.local", PasswordHash: "x", Role: auth.RoleAdmin, Status: "active"}
	if _, err := users.Create(u); err != nil {
		t.Fatalf("create user: %v", err)
	}

	rootDir := t.TempDir()
	if _, err := roots.Create(storage.Root{ID: "root_test", Name: "Test", Path: rootDir, Type: "local", Enabled: true, Indexed: true}); err != nil {
		t.Fatalf("create root: %v", err)
	}

	cfg := &config.Config{DataDir: filepath.Join(t.TempDir(), "data")}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		t.Fatal(err)
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
	return s, sessions, rootDir
}

// tagSession performs JSON-body requests with session + CSRF cookies (like
// doJSON in handlers_versions_test, but returning both).
func tagReq(t *testing.T, h http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	// Warm-up to obtain CSRF cookie.
	warm := httptest.NewRequest("GET", "/api/v1/roots", nil)
	warm.AddCookie(&http.Cookie{Name: "nexora_session", Value: token})
	warmRec := httptest.NewRecorder()
	h.ServeHTTP(warmRec, warm)
	var csrf string
	for _, c := range warmRec.Result().Cookies() {
		if c.Name == "nexora_csrf" {
			csrf = c.Value
		}
	}

	var bodyReader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		bodyReader = strings.NewReader(string(b))
	}
	req := httptest.NewRequest(method, path, bodyReader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.AddCookie(&http.Cookie{Name: "nexora_session", Value: token})
	if csrf != "" {
		req.AddCookie(&http.Cookie{Name: "nexora_csrf", Value: csrf, Path: "/"})
		req.Header.Set("X-CSRF-Token", csrf)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestTags_CRUDAndAttach(t *testing.T) {
	s, sessions, rootDir := setupTagsTest(t)
	h := s.Routes()
	tok := mustSession(t, sessions)

	// A real file to tag.
	os.WriteFile(filepath.Join(rootDir, "photo.jpg"), []byte("jpeg"), 0o644)

	// 1) Create a tag.
	rec := tagReq(t, h, "POST", "/api/v1/tags", tok, map[string]any{"name": "Vacation", "color": "#22C55E"})
	if rec.Code != http.StatusOK {
		t.Fatalf("create tag: status=%d body=%s", rec.Code, rec.Body.String())
	}
	var created Tag
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.Name != "Vacation" {
		t.Fatalf("bad create response: %+v", created)
	}

	// freshList unmarshals into a fresh struct — json.Unmarshal does NOT
	// reset fields absent from the payload (e.g. omitempty count=0), so
	// reusing one struct across calls would carry stale counts.
	freshList := func() []Tag {
		var lr struct {
			Tags []Tag `json:"tags"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &lr)
		return lr.Tags
	}

	// 2) List includes it.
	rec = tagReq(t, h, "GET", "/api/v1/tags", tok, nil)
	if tags := freshList(); len(tags) != 1 {
		t.Fatalf("list tags: status=%d resp=%s", rec.Code, rec.Body.String())
	}

	// 3) Tag the file (POST body).
	rec = tagReq(t, h, "POST", "/api/v1/files/tag", tok, map[string]any{
		"tag_id": created.ID, "root_id": "root_test", "paths": []string{"photo.jpg"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("tag file: status=%d body=%s", rec.Code, rec.Body.String())
	}

	// 4) List confirms count=1.
	rec = tagReq(t, h, "GET", "/api/v1/tags", tok, nil)
	if tags := freshList(); len(tags) != 1 || tags[0].Count != 1 {
		t.Fatalf("expected tag count=1, got %+v", tags)
	}

	// 5) Rename + recolor.
	rec = tagReq(t, h, "PATCH", "/api/v1/tags/"+created.ID, tok, map[string]any{"name": "Trip", "color": "#3B82F6"})
	if rec.Code != http.StatusOK {
		t.Fatalf("update tag: status=%d body=%s", rec.Code, rec.Body.String())
	}
	var updated Tag
	_ = json.Unmarshal(rec.Body.Bytes(), &updated)
	if updated.Name != "Trip" || updated.Color != "#3B82F6" {
		t.Fatalf("bad update: %+v", updated)
	}

	// 6) Untag via query params (regression: the web client sends DELETE
	//    /files/tag?tag_id=..&root_id=..&paths=photo.jpg).
	rec = tagReq(t, h, "DELETE", "/api/v1/files/tag?tag_id="+created.ID+"&root_id=root_test&paths=photo.jpg", tok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("untag file: status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = tagReq(t, h, "GET", "/api/v1/tags", tok, nil)
	if tags := freshList(); len(tags) != 1 || tags[0].Count != 0 {
		t.Fatalf("expected tag count=0 after untag, got %+v", tags)
	}

	// 7) Delete the tag entirely.
	rec = tagReq(t, h, "DELETE", "/api/v1/tags/"+created.ID, tok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete tag: status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = tagReq(t, h, "GET", "/api/v1/tags", tok, nil)
	if tags := freshList(); len(tags) != 0 {
		t.Fatalf("expected no tags after delete, got %+v", tags)
	}

	// 8) Re-deleting is 404.
	rec = tagReq(t, h, "DELETE", "/api/v1/tags/"+created.ID, tok, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("delete missing tag: expected 404, got %d", rec.Code)
	}
}

func TestTags_ScopedToOwner(t *testing.T) {
	s, sessions, rootDir := setupTagsTest(t)
	h := s.Routes()
	tok := mustSession(t, sessions)
	os.WriteFile(filepath.Join(rootDir, "a.txt"), []byte("x"), 0o644)

	// Create user B (non-admin) with no tag of their own.
	users := s.Users
	u2 := auth.User{ID: "usr_b", Username: "b", Email: "b@test.local", PasswordHash: "x", Role: auth.RoleUser, Status: "active"}
	if _, err := users.Create(u2); err != nil {
		t.Fatal(err)
	}
	// Grant B read+write on the root.
	if _, ok, _ := s.StorageRoots.Get("root_test"); ok {
		_ = s.StorageRoots.Grant("usr_b", "root_test", "readwrite")
	}
	sess2, err := sessions.Create("usr_b", "127.0.0.1", "test")
	if err != nil {
		t.Fatal(err)
	}
	tokB := sess2.Token

	// Admin's tag.
	rec := tagReq(t, h, "POST", "/api/v1/tags", tok, map[string]any{"name": "Private", "color": "#EF4444"})
	freshB := func() []Tag {
		var lr struct {
			Tags []Tag `json:"tags"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &lr)
		return lr.Tags
	}
	var adminTag Tag
	_ = json.Unmarshal(rec.Body.Bytes(), &adminTag)

	// B cannot see it.
	rec = tagReq(t, h, "GET", "/api/v1/tags", tokB, nil)
	if tags := freshB(); len(tags) != 0 {
		t.Fatalf("user B should not see admin's tag, got %+v", tags)
	}

	// B cannot delete it.
	rec = tagReq(t, h, "DELETE", "/api/v1/tags/"+adminTag.ID, tokB, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("user B deleting admin's tag: expected 404, got %d", rec.Code)
	}

	// B cannot attach the admin's tag to a file (tag ownership is checked).
	rec = tagReq(t, h, "POST", "/api/v1/files/tag", tokB, map[string]any{
		"tag_id": adminTag.ID, "root_id": "root_test", "paths": []string{"a.txt"},
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("user B tagging with admin's tag: expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}

	// B can create and use their own tag on a *read-only* root (permission fix).
	rec = tagReq(t, h, "POST", "/api/v1/tags", tokB, map[string]any{"name": "Mine"})
	var bTag Tag
	_ = json.Unmarshal(rec.Body.Bytes(), &bTag)
	// Creating a read-only root and granting B read-only.
	roDir := t.TempDir()
	if _, err := s.StorageRoots.Create(storage.Root{ID: "root_ro", Name: "RO", Path: roDir, Type: "local", Enabled: true, ReadOnly: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.StorageRoots.Grant("usr_b", "root_ro", "read"); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(roDir, "m.txt"), []byte("y"), 0o644)
	rec = tagReq(t, h, "POST", "/api/v1/files/tag", tokB, map[string]any{
		"tag_id": bTag.ID, "root_id": "root_ro", "paths": []string{"m.txt"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("tagging on read-only root: expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

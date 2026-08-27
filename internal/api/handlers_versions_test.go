package api

import (
	"bytes"
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

func setupVersionsTest(t *testing.T) (*Server, *auth.SessionStore, string) {
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

	cfg := &config.Config{
		DataDir:            filepath.Join(t.TempDir(), "data"),
		VersionEnabled:     true,
		VersionAuto:        true,
		VersionMaxPerFile:  50,
		VersionMaxFileSize: 1024 * 1024,
	}
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

func mustSession(t *testing.T, sessions *auth.SessionStore) string {
	t.Helper()
	sess, err := sessions.Create("usr_admin", "127.0.0.1", "test")
	if err != nil {
		t.Fatal(err)
	}
	return sess.Token
}

func doJSON(t *testing.T, h http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	// Warm-up: GET any authed route to obtain a CSRF cookie.
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
	if csrf == "" {
		t.Fatalf("no CSRF cookie from warm-up; status=%d", warmRec.Code)
	}

	var bodyR io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		bodyR = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, bodyR)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "nexora_session", Value: token})
	}
	if csrf != "" {
		// The middleware re-uses the existing token if the cookie is
		// present on the request; otherwise it mints a new one and
		// rejects because the header won't match. Send both.
		req.AddCookie(&http.Cookie{Name: "nexora_csrf", Value: csrf, Path: "/"})
		req.Header.Set("X-CSRF-Token", csrf)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestVersions_CreateListRestoreDelete(t *testing.T) {
	s, sessions, rootDir := setupVersionsTest(t)
	h := s.Routes()
	tok := mustSession(t, sessions)

	// Write an initial file directly on disk (this stands in for "the
	// user uploaded something earlier").
	rel := "docs/readme.md"
	if err := os.MkdirAll(filepath.Join(rootDir, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rootDir, rel), []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}

	// 1) List: must show "current" only.
	w := doJSON(t, h, "GET", "/api/v1/files/versions?root=root_test&path="+rel, tok, nil)
	if w.Code != 200 {
		t.Fatalf("list: code=%d body=%s", w.Code, w.Body.String())
	}
	var listResp struct {
		Versions []map[string]any `json:"versions"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	if len(listResp.Versions) != 1 {
		t.Fatalf("expected 1 entry (current), got %d", len(listResp.Versions))
	}
	if listResp.Versions[0]["id"] != "current" {
		t.Fatalf("expected id=current, got %v", listResp.Versions[0]["id"])
	}

	// 2) Create a snapshot.
	w = doJSON(t, h, "POST", "/api/v1/files/versions", tok, map[string]any{
		"root": "root_test", "path": rel, "note": "first snapshot",
	})
	if w.Code != 201 {
		t.Fatalf("create: code=%d body=%s", w.Code, w.Body.String())
	}
	var createResp struct {
		Version map[string]any `json:"version"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &createResp)
	if createResp.Version["version"].(float64) != 1 {
		t.Fatalf("expected version=1, got %v", createResp.Version["version"])
	}
	versionID := createResp.Version["id"].(string)

	// 3) The version bytes must be inside the provider at
	//    .nexora-versions/<id>, not in the legacy DataDir.
	root, ok, _ := s.StorageRoots.Get("root_test")
	if !ok {
		t.Fatal("root_test not found")
	}
	prov := s.StorageRoots.ProviderFor(root)
	if _, err := prov.Stat(".nexora-versions/" + versionID); err != nil {
		t.Fatalf("version bytes not at .nexora-versions/%s: %v", versionID, err)
	}

	// 4) Now mutate the live file to "v2" and snapshot again.
	if err := os.WriteFile(filepath.Join(rootDir, rel), []byte("v2"), 0o644); err != nil {
		t.Fatal(err)
	}
	w = doJSON(t, h, "POST", "/api/v1/files/versions", tok, map[string]any{
		"root": "root_test", "path": rel, "note": "v2",
	})
	if w.Code != 201 {
		t.Fatalf("create v2: code=%d body=%s", w.Code, w.Body.String())
	}
	var v2Resp struct {
		Version map[string]any `json:"version"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &v2Resp)
	v2ID := v2Resp.Version["id"].(string)

	// 5) List now has: current, v2, v1.
	w = doJSON(t, h, "GET", "/api/v1/files/versions?root=root_test&path="+rel, tok, nil)
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	if len(listResp.Versions) != 3 {
		t.Fatalf("expected 3 entries (current + 2 versions), got %d: %+v", len(listResp.Versions), listResp.Versions)
	}
	if listResp.Versions[1]["id"] != v2ID {
		t.Fatalf("expected newest version id=%s, got %v", v2ID, listResp.Versions[1]["id"])
	}

	// 6) Restore v1. Pre-restore snapshot should be auto-created from "v2".
	w = doJSON(t, h, "POST", "/api/v1/files/versions/"+versionID+"/restore", tok, nil)
	if w.Code != 200 {
		t.Fatalf("restore: code=%d body=%s", w.Code, w.Body.String())
	}
	body, _ := os.ReadFile(filepath.Join(rootDir, rel))
	if string(body) != "v1" {
		t.Fatalf("after restore live file should be v1, got %q", body)
	}
	// Total versions should be 3 now (v1, v2, auto-saved).
	w = doJSON(t, h, "GET", "/api/v1/files/versions?root=root_test&path="+rel, tok, nil)
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	if len(listResp.Versions) != 4 { // current + 3
		t.Fatalf("expected 4 entries after restore (current + 3), got %d", len(listResp.Versions))
	}

	// 7) Delete the auto-saved one to keep the next assertions simple.
	for _, v := range listResp.Versions {
		if v["id"] != "current" && v["note"] != nil && strings.HasPrefix(v["note"].(string), "auto-saved") {
			w = doJSON(t, h, "DELETE", "/api/v1/files/versions/"+v["id"].(string), tok, nil)
			if w.Code != 200 {
				t.Fatalf("delete auto: code=%d body=%s", w.Code, w.Body.String())
			}
		}
	}

	// 8) Download the v1 snapshot; bytes must be "v1".
	w = doJSON(t, h, "GET", "/api/v1/files/versions/"+versionID+"/download", tok, nil)
	if w.Code != 200 {
		t.Fatalf("download: code=%d", w.Code)
	}
	if !bytes.Equal(w.Body.Bytes(), []byte("v1")) {
		t.Fatalf("download bytes: expected v1, got %q", w.Body.String())
	}
}

func TestVersions_RespectsMaxFileSize(t *testing.T) {
	s, sessions, rootDir := setupVersionsTest(t)
	h := s.Routes()
	tok := mustSession(t, sessions)

	rel := "big.bin"
	// Write a file larger than the per-test MaxFileSize (1 MB).
	if err := os.WriteFile(filepath.Join(rootDir, rel), make([]byte, 2<<20), 0o644); err != nil {
		t.Fatal(err)
	}
	w := doJSON(t, h, "POST", "/api/v1/files/versions", tok, map[string]any{
		"root": "root_test", "path": rel,
	})
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d body=%s", w.Code, w.Body.String())
	}
}

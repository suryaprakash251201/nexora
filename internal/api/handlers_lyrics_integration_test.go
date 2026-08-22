package api

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

func setupLyricsTest(t *testing.T) (*Server, *storage.RootService, *auth.SessionStore, string) {
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

	u := auth.User{ID: "usr_testadmin", Username: "admin", Email: "admin@test.local", PasswordHash: "x", Role: auth.RoleAdmin, Status: "active"}
	if _, err := users.Create(u); err != nil {
		t.Fatalf("create user: %v", err)
	}

	rootDir := t.TempDir()
	if _, err := roots.Create(storage.Root{ID: "root_test", Name: "Test", Path: rootDir, Type: "local", Enabled: true, Indexed: true}); err != nil {
		t.Fatalf("create root: %v", err)
	}

	s := NewServer(Deps{
		Cfg:       &config.Config{},
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
	return s, roots, sessions, rootDir
}

func TestAudioLyricsSibling(t *testing.T) {
	s, _, sessions, rootDir := setupLyricsTest(t)
	h := s.Routes()

	audio := filepath.Join(rootDir, "song.flac")
	lrc := filepath.Join(rootDir, "song.lrc")
	if err := os.WriteFile(audio, []byte("FAKEFILE"), 0o644); err != nil {
		t.Fatal(err)
	}
	lrcBody := "[ti:Rediscover]\n[ar:Yuvan]\n[00:01.00]hello\n[00:03.00]world\n"
	if err := os.WriteFile(lrc, []byte(lrcBody), 0o644); err != nil {
		t.Fatal(err)
	}

	sess, err := sessions.Create("usr_testadmin", "127.0.0.1", "test")
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: auth.SessionCookieName, Value: sess.Token, Path: "/"}

	// Warm up to obtain a CSRF cookie.
	h1 := httptest.NewRecorder()
	pre := httptest.NewRequest("GET", "/api/v1/roots", nil)
	pre.AddCookie(cookie)
	h.ServeHTTP(h1, pre)
	var csrf string
	for _, c := range h1.Result().Cookies() {
		if c.Name == "nexora_csrf" {
			csrf = c.Value
		}
	}
	if csrf == "" {
		t.Fatal("no csrf cookie")
	}

	getLyrics := func() lyricsResponse {
		req := httptest.NewRequest("GET", "/api/v1/audio/lyrics?root=root_test&path=song.flac", nil)
		req.AddCookie(cookie)
		req.AddCookie(&http.Cookie{Name: "nexora_csrf", Value: csrf, Path: "/"})
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET lyrics status=%d body=%s", rec.Code, rec.Body.String())
		}
		var r lyricsResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &r); err != nil {
			t.Fatal(err)
		}
		return r
	}

	res := getLyrics()
	if !res.HasLyrics || res.Source != "auto" || !res.Synced {
		t.Fatalf("expected auto synced lyrics, got %+v", res)
	}
	if len(res.Cues) != 2 || res.Cues[0].Text != "hello" || res.Cues[1].Text != "world" {
		t.Fatalf("cues not parsed: %+v", res.Cues)
	}
	if res.Meta.Title != "Rediscover" || res.Meta.Artist != "Yuvan" {
		t.Fatalf("meta wrong: %+v", res.Meta)
	}

	// Save lyrics — STRICT mode: must overwrite the sibling song.lrc on disk.
	saveReq := httptest.NewRequest("POST", "/api/v1/audio/lyrics?root=root_test&path=song.flac",
		strings.NewReader(`{"raw":"[00:00.50]mine","format":"lrc"}`))
	saveReq.Header.Set("Content-Type", "application/json")
	saveReq.AddCookie(cookie)
	saveReq.AddCookie(&http.Cookie{Name: "nexora_csrf", Value: csrf, Path: "/"})
	saveReq.Header.Set("X-CSRF-Token", csrf)
	saveRec := httptest.NewRecorder()
	h.ServeHTTP(saveRec, saveReq)
	if saveRec.Code != http.StatusOK {
		t.Fatalf("POST lyrics status=%d body=%s", saveRec.Code, saveRec.Body.String())
	}
	onDisk, err := os.ReadFile(lrc)
	if err != nil {
		t.Fatalf("sidecar .lrc not written next to song: %v", err)
	}
	if string(onDisk) != "[00:00.50]mine" {
		t.Fatalf("sidecar .lrc content mismatch: %q", onDisk)
	}
	res = getLyrics()
	if res.Source != "auto" || res.Cues[0].Text != "mine" {
		t.Fatalf("saved .lrc not served back: %+v", res)
	}

	// Delete lyrics → the sidecar file is removed from disk entirely.
	delReq := httptest.NewRequest("DELETE", "/api/v1/audio/lyrics?root=root_test&path=song.flac", nil)
	delReq.AddCookie(cookie)
	delReq.AddCookie(&http.Cookie{Name: "nexora_csrf", Value: csrf, Path: "/"})
	delReq.Header.Set("X-CSRF-Token", csrf)
	delRec := httptest.NewRecorder()
	h.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusOK {
		t.Fatalf("DELETE lyrics status=%d body=%s", delRec.Code, delRec.Body.String())
	}
	if _, err := os.Stat(lrc); !os.IsNotExist(err) {
		t.Fatalf("expected song.lrc to be deleted, stat err=%v", err)
	}
	res = getLyrics()
	if res.HasLyrics {
		t.Fatalf("expected no lyrics after delete, got %+v", res)
	}
}

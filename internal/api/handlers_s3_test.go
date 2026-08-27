package api

import (
	"encoding/xml"
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
	"github.com/nexora/nexora/internal/s3gw"
	"github.com/nexora/nexora/internal/storage"
)

func setupS3Test(t *testing.T) (*Server, *auth.SessionStore, *auth.TokenStore, string, string) {
	t.Helper()
	db, err := database.Open("sqlite", filepath.Join(t.TempDir(), "test.db"), "")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	log := logger.New("error", "test")
	users := auth.NewUserStore(db)
	sessions := auth.NewSessionStore(db, 24*time.Hour)
	tokens := auth.NewTokenStore(db)
	guard := auth.NewLoginGuard(5, 15*time.Minute)
	limiter := middleware.NewRateLimiter(60, time.Minute)
	roots := storage.NewRootService(db)
	pl := playlists.NewStore(db)

	u := auth.User{ID: "usr_admin", Username: "admin", Email: "admin@test.local", PasswordHash: "x", Role: auth.RoleAdmin, Status: "active"}
	if _, err := users.Create(u); err != nil {
		t.Fatalf("create user: %v", err)
	}

	rootDir := t.TempDir()
	if _, err := roots.Create(storage.Root{ID: "root_test", Name: "Files", Path: rootDir, Type: "local", Enabled: true, Indexed: true}); err != nil {
		t.Fatalf("create root: %v", err)
	}

	cfg := &config.Config{DataDir: filepath.Join(t.TempDir(), "data"), VersionEnabled: true, VersionAuto: true, VersionMaxPerFile: 50}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		t.Fatal(err)
	}

	s := NewServer(Deps{
		Cfg:       cfg,
		Log:       log,
		DB:        db,
		Users:     users,
		Sessions:  sessions,
		Tokens:    tokens,
		Audit:     audit.NewStore(db),
		Guard:     guard,
		Limiter:   limiter,
		Roots:     roots,
		Playlists: pl,
	})
	raw, err := tokens.Create("usr_admin", "s3test", time.Time{})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	return s, sessions, tokens, raw, rootDir
}

// s3Req signs and performs an S3 request.
func s3Req(t *testing.T, h http.Handler, method, urlPath, token string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	var br io.Reader
	if body != nil {
		br = strings.NewReader(string(body))
	}
	req := httptest.NewRequest(method, "http://nexora.test"+urlPath, br)
	if body != nil {
		req.Header.Set("Content-Type", "application/octet-stream")
	}
	s3gw.Sign(req, token, token, "us-east-1", body)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestS3Gateway_ObjectLifecycle(t *testing.T) {
	s, _, _, token, rootDir := setupS3Test(t)
	h := s.Routes()

	// PUT an object under a nested "folder".
	content := []byte("hello from s3 gateway")
	rec := s3Req(t, h, "PUT", "/s3/Files/docs/hello.txt", token, content)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("ETag") == "" {
		t.Fatal("PUT did not return an ETag")
	}
	// The file must actually exist on disk inside the root.
	if got, err := os.ReadFile(filepath.Join(rootDir, "docs", "hello.txt")); err != nil || string(got) != string(content) {
		t.Fatalf("file on disk: %q err=%v", got, err)
	}

	// HEAD.
	rec = s3Req(t, h, "HEAD", "/s3/Files/docs/hello.txt", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("HEAD: %d", rec.Code)
	}
	if rec.Header().Get("Content-Length") != "21" {
		t.Fatalf("HEAD content-length: %s", rec.Header().Get("Content-Length"))
	}
	if rec.Header().Get("x-amz-meta-mtime") == "" {
		t.Fatal("HEAD missing x-amz-meta-mtime")
	}

	// GET full.
	rec = s3Req(t, h, "GET", "/s3/Files/docs/hello.txt", token, nil)
	if rec.Code != http.StatusOK || rec.Body.String() != string(content) {
		t.Fatalf("GET: %d %q", rec.Code, rec.Body.String())
	}

	// GET range.
	rec = s3Req(t, h, "GET", "/s3/Files/docs/hello.txt", token, nil)
	rec.Result().StatusCode = 0 // discard; range needs a custom request
	req := httptest.NewRequest("GET", "http://nexora.test/s3/Files/docs/hello.txt", nil)
	req.Header.Set("Range", "bytes=0-4")
	s3gw.Sign(req, token, token, "us-east-1", nil)
	rw := httptest.NewRecorder()
	h.ServeHTTP(rw, req)
	if rw.Code != http.StatusPartialContent || rw.Body.String() != "hello" {
		t.Fatalf("GET range: %d %q", rw.Code, rw.Body.String())
	}
	if rw.Header().Get("Content-Range") != "bytes 0-4/21" {
		t.Fatalf("Content-Range: %s", rw.Header().Get("Content-Range"))
	}

	// LIST with delimiter: docs/ must appear as a CommonPrefix.
	rec = s3Req(t, h, "GET", "/s3/Files?delimiter=/", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("LIST: %d %s", rec.Code, rec.Body.String())
	}
	var listRes struct {
		XMLName  xml.Name `xml:"ListBucketResult"`
		Contents []struct {
			Key string `xml:"Key"`
		} `xml:"Contents"`
		CommonPrefixes []struct {
			Prefix string `xml:"Prefix"`
		} `xml:"CommonPrefixes"`
	}
	if err := xml.Unmarshal(rec.Body.Bytes(), &listRes); err != nil {
		t.Fatalf("list xml: %v", err)
	}
	if len(listRes.CommonPrefixes) != 1 || listRes.CommonPrefixes[0].Prefix != "docs/" {
		t.Fatalf("expected CommonPrefix docs/, got %+v", listRes.CommonPrefixes)
	}

	// LIST with prefix=docs/ returns the file.
	rec = s3Req(t, h, "GET", "/s3/Files?prefix=docs/", token, nil)
	_ = xml.Unmarshal(rec.Body.Bytes(), &listRes)
	if len(listRes.Contents) != 1 || listRes.Contents[0].Key != "docs/hello.txt" {
		t.Fatalf("prefix list: %+v", listRes.Contents)
	}

	// DELETE.
	rec = s3Req(t, h, "DELETE", "/s3/Files/docs/hello.txt", token, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(rootDir, "docs", "hello.txt")); !os.IsNotExist(err) {
		t.Fatalf("file should be gone: %v", err)
	}
	// Idempotent re-delete.
	rec = s3Req(t, h, "DELETE", "/s3/Files/docs/hello.txt", token, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("re-DELETE: %d", rec.Code)
	}
	// GET after delete → NoSuchKey.
	rec = s3Req(t, h, "GET", "/s3/Files/docs/hello.txt", token, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET after delete: %d", rec.Code)
	}
}

func TestS3Gateway_Multipart(t *testing.T) {
	s, _, _, token, rootDir := setupS3Test(t)
	h := s.Routes()

	// Create an existing file first so the multipart overwrite must
	// auto-snapshot it (same behaviour as regular uploads).
	rec := s3Req(t, h, "PUT", "/s3/Files/big.bin", token, []byte("old-content-"))
	if rec.Code != http.StatusOK {
		t.Fatalf("initial PUT: %d %s", rec.Code, rec.Body.String())
	}

	// CreateMultipartUpload: POST ?uploads
	rec = s3Req(t, h, "POST", "/s3/Files/big.bin?uploads", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("create mpu: %d %s", rec.Code, rec.Body.String())
	}
	var init struct {
		XMLName  xml.Name `xml:"InitiateMultipartUploadResult"`
		UploadID string   `xml:"UploadId"`
	}
	if err := xml.Unmarshal(rec.Body.Bytes(), &init); err != nil || init.UploadID == "" {
		t.Fatalf("init xml: %v upload=%q", err, init.UploadID)
	}
	uid := init.UploadID

	// UploadPart x3.
	partBodies := []string{"part-one---", "part-two---", "part-three"}
	for i, pb := range partBodies {
		rec := s3Req(t, h, "PUT", "/s3/Files/big.bin?partNumber="+itoa(i+1)+"&uploadId="+uid, token, []byte(pb))
		if rec.Code != http.StatusOK {
			t.Fatalf("upload part %d: %d %s", i+1, rec.Code, rec.Body.String())
		}
		if rec.Header().Get("ETag") == "" {
			t.Fatalf("part %d missing ETag", i+1)
		}
	}

	// ListParts (rclone resume flow).
	rec = s3Req(t, h, "GET", "/s3/Files/big.bin?uploadId="+uid, token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list parts: %d", rec.Code)
	}
	var partsRes struct {
		XMLName xml.Name `xml:"ListPartsResult"`
		Parts   []struct {
			PartNumber int    `xml:"PartNumber"`
			ETag       string `xml:"ETag"`
		} `xml:"Part"`
	}
	if err := xml.Unmarshal(rec.Body.Bytes(), &partsRes); err != nil || len(partsRes.Parts) != 3 {
		t.Fatalf("list parts: %+v err=%v", partsRes, err)
	}

	// CompleteMultipartUpload.
	completeXML := `<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>` + partsRes.Parts[0].ETag + `</ETag></Part><Part><PartNumber>2</PartNumber><ETag>` + partsRes.Parts[1].ETag + `</ETag></Part><Part><PartNumber>3</PartNumber><ETag>` + partsRes.Parts[2].ETag + `</ETag></Part></CompleteMultipartUpload>`
	rec = s3Req(t, h, "POST", "/s3/Files/big.bin?uploadId="+uid, token, []byte(completeXML))
	if rec.Code != http.StatusOK {
		t.Fatalf("complete: %d %s", rec.Code, rec.Body.String())
	}
	var completeRes struct {
		XMLName xml.Name `xml:"CompleteMultipartUploadResult"`
		ETag    string   `xml:"ETag"`
	}
	_ = xml.Unmarshal(rec.Body.Bytes(), &completeRes)
	if completeRes.ETag == "" {
		t.Fatalf("complete result missing etag: %s", rec.Body.String())
	}

	// Assembled object matches the concatenated parts.
	want := strings.Join(partBodies, "")
	if got, err := os.ReadFile(filepath.Join(rootDir, "big.bin")); err != nil || string(got) != want {
		t.Fatalf("assembled: %q err=%v", got, err)
	}

	// The staging namespace must be empty (parts cleaned up).
	entries, _ := os.ReadDir(filepath.Join(rootDir, ".nexora-mpu"))
	if len(entries) != 0 {
		t.Fatalf("staging not cleaned: %v", entries)
	}

	// Multipart upload of an existing file must trigger an auto-version
	// snapshot (same behaviour as regular uploads).
	var verCount int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM file_versions WHERE path = 'big.bin'`).Scan(&verCount)
	if verCount != 1 {
		t.Fatalf("expected 1 auto version after overwrite, got %d", verCount)
	}
}

func TestS3Gateway_AuthFailures(t *testing.T) {
	s, _, _, token, _ := setupS3Test(t)
	h := s.Routes()

	// No Authorization header at all.
	req := httptest.NewRequest("GET", "http://nexora.test/s3/Files", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("no auth: %d", w.Code)
	}

	// Unknown token.
	rec := s3Req(t, h, "GET", "/s3/Files", "nxr_definitely_invalid", nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("unknown token: %d %s", rec.Code, rec.Body.String())
	}

	// Wrong secret (signature must fail even though access key is valid).
	req = httptest.NewRequest("GET", "http://nexora.test/s3/Files", nil)
	s3gw.Sign(req, token, "nxr_wrongsecret", "us-east-1", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("bad signature: %d", w.Code)
	}

	// Bucket listing works with a valid token.
	rec = s3Req(t, h, "GET", "/s3/", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list buckets: %d %s", rec.Code, rec.Body.String())
	}
	var buckets struct {
		XMLName xml.Name `xml:"ListAllMyBucketsResult"`
		Buckets []struct {
			Name string `xml:"Name"`
		} `xml:"Buckets>Bucket"`
	}
	if err := xml.Unmarshal(rec.Body.Bytes(), &buckets); err != nil {
		t.Fatalf("buckets xml: %v", err)
	}
	if len(buckets.Buckets) != 1 || buckets.Buckets[0].Name != "Files" {
		t.Fatalf("buckets: %+v", buckets.Buckets)
	}
}

func TestS3Gateway_VersioningOnOverwrite(t *testing.T) {
	s, _, _, token, rootDir := setupS3Test(t)
	h := s.Routes()

	// First PUT creates the file; second PUT overwrites → auto version.
	s3Req(t, h, "PUT", "/s3/Files/doc.txt", token, []byte("v1"))
	s3Req(t, h, "PUT", "/s3/Files/doc.txt", token, []byte("v2"))
	body, _ := os.ReadFile(filepath.Join(rootDir, "doc.txt"))
	if string(body) != "v2" {
		t.Fatalf("live file: %q", body)
	}
	var verCount int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM file_versions WHERE path = 'doc.txt'`).Scan(&verCount)
	if verCount != 1 {
		t.Fatalf("expected 1 version, got %d", verCount)
	}
}

func itoa(n int) string {
	return strings.TrimSpace(strings.Join([]string{string(rune('0' + n/10)), string(rune('0' + n%10))}, ""))
}

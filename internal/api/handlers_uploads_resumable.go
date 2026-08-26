// Resumable, chunked upload sessions for large files.
//
// Flow:  POST /files/uploads/init                      → create session
//
//	PUT  /files/uploads/{id}/chunk?index=N        → one raw chunk
//	GET  /files/uploads/{id}/status               → uploadedBytes / nextChunk
//	POST /files/uploads/{id}/complete             → verify + assemble
//	DELETE /files/uploads/{id}                    → cancel / cleanup
//
// Design notes:
//   - Chunks live in <DataDir>/uploads/<uploadId>/<6-digit>.part; the session
//     dir is the source of truth (meta.json), so uploads survive server
//     restarts. Duplicate chunks overwrite atomically (.tmp → rename), which
//     makes retries idempotent.
//   - complete() streams every part through io.MultiReader into the provider
//     under a "<dest>.nxpart" staging name, then Move()s it onto the final
//     name — partial files are never user-visible.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/events"
	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
	"github.com/nexora/nexora/internal/util"
)

const (
	uploadIDPrefix         = "up_"
	minChunkSize     int64 = 4 << 20  // 4 MiB floor
	maxChunkSize     int64 = 64 << 20 // 64 MiB ceiling
	defaultChunkSize int64 = 8 << 20  // 8 MiB default
	partialSuffix          = ".nxpart"
	uploadsMetaFile        = "meta.json"
)

var uploadIDRe = regexp.MustCompile(`^up_[A-Za-z0-9]+$`)

type uploadSession struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	RootID      string `json:"root_id"`
	TargetDir   string `json:"target_dir"` // cleaned relative dir ("" = root)
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	Mime        string `json:"mime,omitempty"`
	ChunkSize   int64  `json:"chunk_size"`
	TotalChunks int64  `json:"total_chunks"`
	CreatedAt   string `json:"created_at"`
}

func uploadSessionDir(dataDir, id string) string {
	return filepath.Join(dataDir, "uploads", id)
}

func totalChunksFor(size, chunkSize int64) int64 {
	if size <= 0 {
		return 0 // empty file: no parts, complete() writes an empty file
	}
	return (size + chunkSize - 1) / chunkSize
}

// uploadChunkLocks serialises writes to the same upload session so two
// concurrent PUT /files/uploads/{id}/chunk?index=N requests cannot
// interleave bytes. The lock is per-session: a slow chunk for upload A
// does not block chunks for upload B.
//
// The Map stores *sync.Mutex values; we never delete entries because
// the memory cost is one pointer per active upload, and the janitor
// (PurgeStaleUploadSessions) deletes the underlying session directory
// after the TTL so the lock will fall out of the working set eventually.
//
// Phase 2 / P1-2 fix: without this lock, the "idempotent" .tmp → rename
// pattern was actually racy — two clients could both O_TRUNC, both
// copy, and the last rename wins, with possible off-by-one bytes.
var uploadChunkLocks sync.Map // map[string]*sync.Mutex

func lockForUpload(id string) *sync.Mutex {
	v, _ := uploadChunkLocks.LoadOrStore(id, &sync.Mutex{})
	return v.(*sync.Mutex)
}

// classifyUploadError maps storage failures to precise HTTP responses so the
// client can show "disk full", "permission denied", etc. instead of a generic
// network error.
func classifyUploadError(err error) (int, string, string) {
	var maxErr *http.MaxBytesError
	if errors.As(err, &maxErr) {
		return http.StatusRequestEntityTooLarge, "payload_too_large", "Chunk exceeds the maximum allowed size"
	}
	var errno syscall.Errno
	if errors.As(err, &errno) {
		switch errno {
		case syscall.ENOSPC:
			return http.StatusInsufficientStorage, "disk_full", "Not enough storage space on the server"
		case syscall.EACCES, syscall.EPERM:
			return http.StatusForbidden, "permission_denied", "Server permission denied for the storage location"
		case syscall.ENAMETOOLONG:
			return http.StatusBadRequest, "invalid_name", "File name too long"
		}
	}
	if errors.Is(err, storage.ErrPermission) {
		return http.StatusForbidden, "permission_denied", "Write access denied for this storage"
	}
	return http.StatusInternalServerError, "storage_error", "Storage write failed"
}

var (
	errInvalidUpload   = errors.New("invalid upload id")
	errUploadNotFound  = errors.New("upload session not found")
	errUploadForbidden = errors.New("not your upload session")
)

// loadUploadSession validates the id, loads meta.json and enforces ownership.
func (s *Server) loadUploadSession(r *http.Request, userID string, isAdmin bool) (*uploadSession, error) {
	id := chi.URLParam(r, "id")
	if !uploadIDRe.MatchString(id) {
		return nil, errInvalidUpload
	}
	data, err := os.ReadFile(filepath.Join(uploadSessionDir(s.Cfg.DataDir, id), uploadsMetaFile))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, errUploadNotFound
		}
		return nil, err
	}
	var sess uploadSession
	if err := json.Unmarshal(data, &sess); err != nil || sess.ID != id {
		return nil, errUploadNotFound
	}
	if sess.UserID != userID && !isAdmin {
		return nil, errUploadForbidden
	}
	return &sess, nil
}

// POST /files/uploads/init {root, path, name, size, mime, chunk_size}
func (s *Server) handleUploadInit(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	var body struct {
		Root      string `json:"root"`
		Path      string `json:"path"`
		Name      string `json:"name"`
		Size      int64  `json:"size"`
		Mime      string `json:"mime"`
		ChunkSize int64  `json:"chunk_size"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body", middleware.GetRequestID(r.Context()))
		return
	}
	name := filepath.Base(strings.TrimSpace(body.Name))
	if name == "" || name == "." || strings.ContainsAny(name, "/\\") {
		writeError(w, http.StatusBadRequest, "invalid_name", "invalid file name", middleware.GetRequestID(r.Context()))
		return
	}
	target := ""
	if body.Path != "" {
		t, cerr := storage.CleanRelative(body.Path)
		if cerr != nil {
			writeError(w, http.StatusBadRequest, "invalid_path", cerr.Error(), middleware.GetRequestID(r.Context()))
			return
		}
		target = t
	}
	if _, err := s.resolveAccess(r, body.Root, true); err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	if body.Size < 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "negative size", middleware.GetRequestID(r.Context()))
		return
	}
	chunkSize := body.ChunkSize
	if chunkSize == 0 {
		chunkSize = defaultChunkSize
	}
	chunkSize = minInt64(maxInt64(chunkSize, minChunkSize), maxChunkSize)

	sess := uploadSession{
		ID:          util.NewID(uploadIDPrefix, 16),
		UserID:      user.ID,
		RootID:      body.Root,
		TargetDir:   target,
		Name:        name,
		Size:        body.Size,
		Mime:        strings.TrimSpace(body.Mime),
		ChunkSize:   chunkSize,
		TotalChunks: totalChunksFor(body.Size, chunkSize),
		CreatedAt:   util.NowUTC(),
	}
	dir := uploadSessionDir(s.Cfg.DataDir, sess.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		s.writeUploadError(w, r, err)
		return
	}
	meta, _ := json.Marshal(sess)
	if err := os.WriteFile(filepath.Join(dir, uploadsMetaFile), meta, 0o644); err != nil {
		s.writeUploadError(w, r, err)
		return
	}
	s.logUpload(r, "init", &sess, 0)
	writeJSON(w, http.StatusCreated, map[string]any{
		"uploadId":    sess.ID,
		"chunkSize":   sess.ChunkSize,
		"totalChunks": sess.TotalChunks,
	})
}

// PUT /files/uploads/{id}/chunk?index=N — raw request body is the chunk.
// Idempotent: re-sending a chunk overwrites it atomically (.tmp → rename).
func (s *Server) handleUploadChunk(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	sess, err := s.loadUploadSession(r, user.ID, user.Role == "admin")
	if err != nil {
		writeUploadSessionError(w, r, err)
		return
	}
	index, perr := strconv.ParseInt(queryParam(r, "index", "-1"), 10, 64)
	if perr != nil || index < 0 || index >= sess.TotalChunks {
		writeError(w, http.StatusBadRequest, "invalid_chunk", "chunk index out of range", middleware.GetRequestID(r.Context()))
		return
	}
	if _, err := s.resolveAccess(r, sess.RootID, true); err != nil {
		s.writeAccessError(w, r, err)
		return
	}

	dir := uploadSessionDir(s.Cfg.DataDir, sess.ID)
	tmp := filepath.Join(dir, fmt.Sprintf("%06d.part.tmp", index))
	final := filepath.Join(dir, fmt.Sprintf("%06d.part", index))

	// Serialise all chunk writes for this upload session. Without this
	// lock, two concurrent PUTs at the same index race on the open/write/
	// rename sequence and the last writer wins, potentially with a
	// half-written file as the result. Phase 2 / P1-2.
	chunkLock := lockForUpload(sess.ID)
	chunkLock.Lock()
	defer chunkLock.Unlock()

	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		s.writeUploadError(w, r, err)
		return
	}
	written, copyErr := io.Copy(f, io.LimitReader(r.Body, maxChunkSize+(1<<20)))
	closeErr := f.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(tmp)
		s.writeUploadError(w, r, firstErr(copyErr, closeErr))
		return
	}
	// Size guard: no chunk may exceed chunkSize (last ≤ remainder).
	maxLen := sess.ChunkSize
	if rem := sess.Size - index*sess.ChunkSize; rem > 0 && rem < maxLen {
		maxLen = rem
	}
	if written > maxLen {
		_ = os.Remove(tmp)
		writeError(w, http.StatusBadRequest, "invalid_chunk", "chunk larger than declared size", middleware.GetRequestID(r.Context()))
		return
	}
	if err := os.Rename(tmp, final); err != nil {
		_ = os.Remove(tmp)
		s.writeUploadError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "index": index, "bytes": written})
}

// GET /files/uploads/{id}/status
func (s *Server) handleUploadStatus(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	sess, err := s.loadUploadSession(r, user.ID, user.Role == "admin")
	if err != nil {
		writeUploadSessionError(w, r, err)
		return
	}
	present, uploadedBytes := scanParts(s.Cfg.DataDir, sess)
	next := int64(-1)
	for i := int64(0); i < sess.TotalChunks; i++ {
		if !present[i] {
			next = i
			break
		}
	}
	complete := next == -1 && (sess.TotalChunks == 0 || sess.Size == 0 || uploadedBytes >= sess.Size)
	writeJSON(w, http.StatusOK, map[string]any{
		"uploadId":      sess.ID,
		"totalBytes":    sess.Size,
		"uploadedBytes": uploadedBytes,
		"chunkSize":     sess.ChunkSize,
		"totalChunks":   sess.TotalChunks,
		"nextChunk":     next,
		"complete":      complete,
	})
}

// scanParts returns which chunk indices exist on disk and their total bytes.
func scanParts(dataDir string, sess *uploadSession) (map[int64]bool, int64) {
	present := map[int64]bool{}
	entries, err := os.ReadDir(uploadSessionDir(dataDir, sess.ID))
	if err != nil {
		return present, 0
	}
	total := int64(0)
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".part") {
			continue
		}
		idx, perr := strconv.ParseInt(strings.TrimSuffix(name, ".part"), 10, 64)
		if perr != nil || idx < 0 || idx >= sess.TotalChunks {
			continue
		}
		if info, ierr := e.Info(); ierr == nil {
			present[idx] = true
			total += info.Size()
		}
	}
	return present, total
}

// POST /files/uploads/{id}/complete — verify all chunks, assemble into the
// destination under a staging name, then atomically Move onto the final name.
func (s *Server) handleUploadComplete(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	sess, err := s.loadUploadSession(r, user.ID, user.Role == "admin")
	if err != nil {
		writeUploadSessionError(w, r, err)
		return
	}
	acc, err := s.resolveAccess(r, sess.RootID, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	dest := sess.TargetDir
	if dest != "" {
		dest += "/"
	}
	dest += sess.Name

	present, uploadedBytes := scanParts(s.Cfg.DataDir, sess)
	if sess.Size > 0 {
		missing := []int64{}
		for i := int64(0); i < sess.TotalChunks; i++ {
			if !present[i] {
				missing = append(missing, i)
			}
		}
		if len(missing) > 0 {
			limit := minInt(len(missing), 20)
			writeJSON(w, http.StatusConflict, map[string]any{
				"error":     "chunks_missing",
				"missing":   missing[:limit],
				"nextChunk": missing[0],
			})
			return
		}
		if uploadedBytes != sess.Size {
			writeJSON(w, http.StatusConflict, map[string]any{
				"error":         "size_mismatch",
				"expectedBytes": sess.Size,
				"uploadedBytes": uploadedBytes,
			})
			return
		}
	}

	// Open parts up-front so a vanished file fails before any write happens.
	readers := make([]io.Reader, sess.TotalChunks)
	closers := make([]io.Closer, 0, sess.TotalChunks)
	defer func() {
		for _, c := range closers {
			_ = c.Close()
		}
	}()
	for i := int64(0); i < sess.TotalChunks; i++ {
		f, ferr := os.Open(filepath.Join(uploadSessionDir(s.Cfg.DataDir, sess.ID), fmt.Sprintf("%06d.part", i)))
		if ferr != nil {
			s.writeUploadError(w, r, ferr)
			return
		}
		readers[i] = f
		closers = append(closers, f)
	}
	var stream io.Reader
	if sess.TotalChunks == 0 {
		stream = strings.NewReader("")
	} else {
		stream = io.MultiReader(readers...)
	}

	stagingName := dest + partialSuffix
	if werr := acc.provider.Write(stagingName, stream, sess.Size); werr != nil {
		_ = acc.provider.Delete(stagingName)
		s.writeUploadError(w, r, werr)
		return
	}
	if merr := acc.provider.Move(stagingName, dest); merr != nil {
		_ = acc.provider.Delete(stagingName)
		s.writeUploadError(w, r, merr)
		return
	}

	// Finished — scratch space goes away.
	_ = os.RemoveAll(uploadSessionDir(s.Cfg.DataDir, sess.ID))

	s.indexUpsert(sess.RootID, acc.provider, dest)
	if s.Metrics != nil {
		s.Metrics.AddUpload(sess.Size)
	}
	s.audit(r, "upload", dest, fmt.Sprintf("resumable chunks=%d", sess.TotalChunks))
	s.recordRecent(r, sess.RootID, dest, "add")
	s.emit(events.EventFileCreated, r, sess.RootID, dest, sess.Size)
	if s.Log != nil {
		s.Log.Info("upload complete",
			"upload_id", sess.ID,
			"user_id", sess.UserID,
			"filename", sess.Name,
			"total_size", sess.Size,
			"chunks", sess.TotalChunks,
			"duration", time.Since(started).Round(time.Millisecond).String(),
			"remote_ip", clientIP(r),
		)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": dest, "size": sess.Size})
}

// DELETE /files/uploads/{id} — user-initiated cancel/cleanup.
func (s *Server) handleUploadCancel(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	sess, err := s.loadUploadSession(r, user.ID, user.Role == "admin")
	if err != nil {
		writeUploadSessionError(w, r, err)
		return
	}
	_ = os.RemoveAll(uploadSessionDir(s.Cfg.DataDir, sess.ID))
	if s.Log != nil {
		s.Log.Info("upload cancelled", "upload_id", sess.ID, "filename", sess.Name, "remote_ip", clientIP(r))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// PurgeStaleUploadSessions removes abandoned sessions older than ttl.
// Called periodically from maintenance; ttl <= 0 disables. Never touches
// recently-modified dirs, so active uploads are safe.
func PurgeStaleUploadSessions(ctx context.Context, dataDir string, ttl time.Duration, log *logger.Logger) int64 {
	if ttl <= 0 {
		return 0
	}
	root := filepath.Join(dataDir, "uploads")
	entries, err := os.ReadDir(root)
	if err != nil {
		return 0
	}
	var removed int64
	cutoff := time.Now().Add(-ttl)
	for _, e := range entries {
		if !e.IsDir() || !uploadIDRe.MatchString(e.Name()) {
			continue
		}
		select {
		case <-ctx.Done():
			return removed
		default:
		}
		info, ierr := e.Info()
		if ierr != nil || info.ModTime().After(cutoff) {
			continue
		}
		if rmErr := os.RemoveAll(filepath.Join(root, e.Name())); rmErr == nil {
			removed++
		} else if log != nil {
			log.Warn("upload cleanup failed", "dir", e.Name(), "err", rmErr.Error())
		}
	}
	if removed > 0 && log != nil {
		log.Info("purged stale upload sessions", "count", removed, "ttl", ttl.String())
	}
	return removed
}

// ---- small shared helpers ----

func (s *Server) writeUploadError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, msg := classifyUploadError(err)
	if s.Log != nil {
		s.Log.Warn("upload failed", "code", code, "error", err.Error(), "remote_ip", clientIP(r))
	}
	writeError(w, status, code, msg, middleware.GetRequestID(r.Context()))
}

func writeUploadSessionError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errInvalidUpload):
		writeError(w, http.StatusBadRequest, "invalid_upload", err.Error(), middleware.GetRequestID(r.Context()))
	case errors.Is(err, errUploadNotFound):
		writeError(w, http.StatusNotFound, "upload_expired", "Upload session not found (expired or cancelled)", middleware.GetRequestID(r.Context()))
	case errors.Is(err, errUploadForbidden):
		writeError(w, http.StatusForbidden, "forbidden", "Not your upload session", middleware.GetRequestID(r.Context()))
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(r.Context()))
	}
}

// logUpload emits one structured line per upload phase.
func (s *Server) logUpload(r *http.Request, phase string, sess *uploadSession, bytes int64) {
	if s.Log == nil {
		return
	}
	s.Log.Info("upload "+phase,
		"upload_id", sess.ID,
		"user_id", sess.UserID,
		"filename", sess.Name,
		"total_size", sess.Size,
		"chunk_size", sess.ChunkSize,
		"chunks", sess.TotalChunks,
		"uploaded_bytes", bytes,
		"remote_ip", clientIP(r),
	)
}

func firstErr(a, b error) error {
	if a != nil {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

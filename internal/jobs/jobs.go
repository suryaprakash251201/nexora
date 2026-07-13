// Package jobs runs bounded background work: ZIP archive creation (for folder /
// multi-file downloads) and safe ZIP extraction (with zip-slip protection).
// Concurrency is bounded by a small worker pool so the service stays light on
// low-spec hardware. Progress is persisted and streamed via SSE.
package jobs

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/internal/storage"
	"github.com/nexora/nexora/internal/util"
)

// Job statuses.
const (
	StatusPending = "pending"
	StatusRunning = "running"
	StatusDone    = "done"
	StatusFailed  = "failed"
)

// Job types.
const (
	TypeArchive = "archive"
	TypeExtract = "extract"
)

// Job is a persisted background task.
type Job struct {
	ID        string  `json:"id"`
	Type      string  `json:"type"`
	Status    string  `json:"status"`
	UserID    string  `json:"user_id"`
	RootID    string  `json:"root_id"`
	Progress  float64 `json:"progress"`
	Error     string  `json:"error"`
	Result    string  `json:"result,omitempty"` // archive job: relative output info
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

// ArchivePayload describes a ZIP creation job.
type ArchivePayload struct {
	RootID   string   `json:"root_id"`
	Paths    []string `json:"paths"`     // relative paths to include
	Name     string   `json:"name"`      // archive base name (no extension)
	OutputID string   `json:"output_id"` // cache file id (jobID)
}

// ExtractPayload describes a ZIP extraction job.
type ExtractPayload struct {
	RootID string `json:"root_id"`
	Path   string `json:"path"`        // zip file relative path
	Dest   string `json:"destination"` // relative destination directory
}

// Manager owns the worker pool and job persistence.
type Manager struct {
	db       *sql.DB
	roots    *storage.RootService
	log      *logger.Logger
	cacheDir string

	queue   chan string
	wg      sync.WaitGroup
	ctx     context.Context
	cancel  context.CancelFunc

	subMu sync.Mutex
	subs  map[string][]chan Job

	activeMu sync.Mutex
	active   int
}

// NewManager creates the manager with a bounded worker pool.
func NewManager(db *sql.DB, roots *storage.RootService, log *logger.Logger, cacheDir string, workers int) *Manager {
	if workers <= 0 {
		workers = 2
	}
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{
		db:       db,
		roots:    roots,
		log:      log,
		cacheDir: cacheDir,
		queue:    make(chan string, 128),
		ctx:      ctx,
		cancel:   cancel,
		subs:     make(map[string][]chan Job),
	}
	_ = os.MkdirAll(cacheDir, 0o755)
	for i := 0; i < workers; i++ {
		m.wg.Add(1)
		go m.worker()
	}
	return m
}

// Stop drains the worker pool.
func (m *Manager) Stop() {
	m.cancel()
	close(m.queue)
	m.wg.Wait()
}

// ActiveCount returns the number of currently running jobs (for metrics).
func (m *Manager) ActiveCount() int {
	m.activeMu.Lock()
	defer m.activeMu.Unlock()
	return m.active
}

// EnqueueArchive creates and schedules an archive job.
func (m *Manager) EnqueueArchive(userID string, p ArchivePayload) (Job, error) {
	id := util.NewID("job_", 12)
	p.OutputID = id
	return m.enqueue(id, TypeArchive, userID, p.RootID, p)
}

// EnqueueExtract creates and schedules an extraction job.
func (m *Manager) EnqueueExtract(userID string, p ExtractPayload) (Job, error) {
	id := util.NewID("job_", 12)
	return m.enqueue(id, TypeExtract, userID, p.RootID, p)
}

func (m *Manager) enqueue(id, typ, userID, rootID string, payload any) (Job, error) {
	body, _ := json.Marshal(payload)
	now := util.NowUTC()
	_, err := m.db.Exec(
		`INSERT INTO jobs(id,type,status,user_id,root_id,payload,progress,error,created_at,updated_at)
		 VALUES(?,?,?,?,?,?,0,'',?,?)`,
		id, typ, StatusPending, userID, rootID, string(body), now, now)
	if err != nil {
		return Job{}, err
	}
	j := Job{ID: id, Type: typ, Status: StatusPending, UserID: userID, RootID: rootID, CreatedAt: now, UpdatedAt: now}
	select {
	case m.queue <- id:
	default:
		// Queue full: mark failed rather than block the request.
		m.finish(id, StatusFailed, "job queue is full, try again later", "")
		j.Status = StatusFailed
		j.Error = "job queue is full, try again later"
	}
	return j, nil
}

// Get returns a job by ID.
func (m *Manager) Get(id string) (Job, bool, error) {
	var j Job
	var payload string
	err := m.db.QueryRow(
		`SELECT id,type,status,user_id,root_id,payload,progress,error,created_at,updated_at FROM jobs WHERE id=?`, id).
		Scan(&j.ID, &j.Type, &j.Status, &j.UserID, &j.RootID, &payload, &j.Progress, &j.Error, &j.CreatedAt, &j.UpdatedAt)
	if err == sql.ErrNoRows {
		return Job{}, false, nil
	}
	if err != nil {
		return Job{}, false, err
	}
	j.Result = extractResult(j.Type, payload)
	return j, true, nil
}

// ListForUser returns recent jobs for a user.
func (m *Manager) ListForUser(userID string, isAdmin bool, limit int) ([]Job, error) {
	q := `SELECT id,type,status,user_id,root_id,payload,progress,error,created_at,updated_at FROM jobs`
	args := []any{}
	if !isAdmin {
		q += ` WHERE user_id=?`
		args = append(args, userID)
	}
	q += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)
	rows, err := m.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Job
	for rows.Next() {
		var j Job
		var payload string
		if err := rows.Scan(&j.ID, &j.Type, &j.Status, &j.UserID, &j.RootID, &payload, &j.Progress, &j.Error, &j.CreatedAt, &j.UpdatedAt); err != nil {
			return nil, err
		}
		j.Result = extractResult(j.Type, payload)
		out = append(out, j)
	}
	return out, rows.Err()
}

// ArchivePath returns the on-disk cache path for a completed archive job.
func (m *Manager) ArchivePath(jobID string) string {
	return filepath.Join(m.cacheDir, jobID+".zip")
}

// Subscribe returns a channel that receives job updates for SSE streaming.
func (m *Manager) Subscribe(jobID string) (<-chan Job, func()) {
	ch := make(chan Job, 8)
	m.subMu.Lock()
	m.subs[jobID] = append(m.subs[jobID], ch)
	m.subMu.Unlock()
	cancel := func() {
		m.subMu.Lock()
		defer m.subMu.Unlock()
		list := m.subs[jobID]
		for i, c := range list {
			if c == ch {
				m.subs[jobID] = append(list[:i], list[i+1:]...)
				break
			}
		}
		close(ch)
	}
	return ch, cancel
}

func (m *Manager) publish(jobID string) {
	j, ok, err := m.Get(jobID)
	if err != nil || !ok {
		return
	}
	m.subMu.Lock()
	subs := append([]chan Job(nil), m.subs[jobID]...)
	m.subMu.Unlock()
	for _, ch := range subs {
		select {
		case ch <- j:
		default:
		}
	}
}

func (m *Manager) worker() {
	defer m.wg.Done()
	for id := range m.queue {
		select {
		case <-m.ctx.Done():
			return
		default:
		}
		m.run(id)
	}
}

func (m *Manager) run(id string) {
	m.activeMu.Lock()
	m.active++
	m.activeMu.Unlock()
	defer func() {
		m.activeMu.Lock()
		m.active--
		m.activeMu.Unlock()
	}()

	j, ok, err := m.Get(id)
	if err != nil || !ok {
		return
	}
	m.setStatus(id, StatusRunning)
	m.publish(id)

	var payload string
	_ = m.db.QueryRow(`SELECT payload FROM jobs WHERE id=?`, id).Scan(&payload)

	switch j.Type {
	case TypeArchive:
		var p ArchivePayload
		_ = json.Unmarshal([]byte(payload), &p)
		if err := m.doArchive(id, p); err != nil {
			m.finish(id, StatusFailed, err.Error(), "")
		} else {
			m.finish(id, StatusDone, "", "")
		}
	case TypeExtract:
		var p ExtractPayload
		_ = json.Unmarshal([]byte(payload), &p)
		if err := m.doExtract(id, p); err != nil {
			m.finish(id, StatusFailed, err.Error(), "")
		} else {
			m.finish(id, StatusDone, "", "")
		}
	default:
		m.finish(id, StatusFailed, "unknown job type", "")
	}
	m.publish(id)
}

// doArchive builds a ZIP of the requested paths into the cache dir.
func (m *Manager) doArchive(id string, p ArchivePayload) error {
	root, ok, err := m.roots.Get(p.RootID)
	if err != nil || !ok {
		return errors.New("root not found")
	}
	provider := m.roots.ProviderFor(root)

	outPath := m.ArchivePath(id)
	f, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)

	// Gather the flat list of files first (for progress).
	var files []string
	for _, rel := range p.Paths {
		clean, cerr := storage.CleanRelative(rel)
		if cerr != nil {
			continue
		}
		list, lerr := collectFiles(provider, clean)
		if lerr != nil {
			continue
		}
		files = append(files, list...)
	}
	total := len(files)
	if total == 0 {
		zw.Close()
		return errors.New("nothing to archive")
	}

	// Determine a common base so archive entries are relative and tidy.
	base := commonBase(p.Paths)

	for i, rel := range files {
		select {
		case <-m.ctx.Done():
			zw.Close()
			return context.Canceled
		default:
		}
		rc, rerr := provider.Read(rel)
		if rerr != nil {
			continue
		}
		entryName := rel
		if base != "" {
			entryName = strings.TrimPrefix(rel, base+"/")
		}
		w, werr := zw.Create(entryName)
		if werr != nil {
			rc.Close()
			continue
		}
		_, _ = io.Copy(w, rc)
		rc.Close()
		if i%16 == 0 {
			m.setProgress(id, float64(i+1)/float64(total))
			m.publish(id)
		}
	}
	if err := zw.Close(); err != nil {
		return err
	}
	m.setProgress(id, 1)
	return nil
}

// doExtract unpacks a ZIP into the destination with zip-slip protection.
func (m *Manager) doExtract(id string, p ExtractPayload) error {
	root, ok, err := m.roots.Get(p.RootID)
	if err != nil || !ok {
		return errors.New("root not found")
	}
	if root.ReadOnly {
		return errors.New("destination root is read-only")
	}
	provider := m.roots.ProviderFor(root)

	src, cerr := storage.CleanRelative(p.Path)
	if cerr != nil {
		return errors.New("invalid archive path")
	}
	dest, derr := storage.CleanRelative(p.Dest)
	if derr != nil {
		return errors.New("invalid destination path")
	}

	// Read the whole archive into a temp file (zip.Reader needs io.ReaderAt).
	rc, rerr := provider.Read(src)
	if rerr != nil {
		return rerr
	}
	tmp, terr := os.CreateTemp(m.cacheDir, "extract-*.zip")
	if terr != nil {
		rc.Close()
		return terr
	}
	defer os.Remove(tmp.Name())
	size, cpyErr := io.Copy(tmp, rc)
	rc.Close()
	if cpyErr != nil {
		tmp.Close()
		return cpyErr
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		tmp.Close()
		return err
	}
	defer tmp.Close()

	zr, zerr := zip.NewReader(tmp, size)
	if zerr != nil {
		return errors.New("not a valid zip archive")
	}

	total := len(zr.File)
	for i, zf := range zr.File {
		select {
		case <-m.ctx.Done():
			return context.Canceled
		default:
		}
		// zip-slip protection: reject absolute paths, backslashes, and any
		// entry that would escape the destination after cleaning.
		name := zf.Name
		if strings.ContainsRune(name, 0) || strings.Contains(name, "\\") {
			return fmt.Errorf("unsafe zip entry: %q", name)
		}
		// Zip entries may already include the destination folder (e.g. when the
		// archive was created from inside it). Normalize to a path relative to
		// dest so entries land in the right place without being doubled.
		relName := name
		if dest != "" {
			relName = strings.TrimPrefix(name, dest+"/")
			relName = strings.TrimPrefix(relName, dest+`\`)
		}
		target := path.Join(dest, relName)
		clean, cErr := storage.CleanRelative(target)
		if cErr != nil {
			return fmt.Errorf("unsafe zip entry: %q", name)
		}
		if !strings.HasPrefix(clean+"/", strings.TrimSuffix(dest, "/")+"/") && clean != dest {
			return fmt.Errorf("zip-slip blocked: %q", name)
		}
		if zf.FileInfo().IsDir() {
			_ = provider.CreateDirectory(clean)
			continue
		}
		fr, ferr := zf.Open()
		if ferr != nil {
			return ferr
		}
		if werr := provider.Write(clean, fr, int64(zf.UncompressedSize64)); werr != nil {
			fr.Close()
			return werr
		}
		fr.Close()
		if i%8 == 0 {
			m.setProgress(id, float64(i+1)/float64(total))
			m.publish(id)
		}
	}
	m.setProgress(id, 1)
	return nil
}

// collectFiles recursively lists all non-directory files under rel.
func collectFiles(provider storage.StorageProvider, rel string) ([]string, error) {
	info, err := provider.Stat(rel)
	if err != nil {
		return nil, err
	}
	if !info.IsDir {
		return []string{rel}, nil
	}
	var out []string
	entries, err := provider.List(rel)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Path, ".nexora-trash") {
			continue
		}
		if e.IsDir {
			sub, err := collectFiles(provider, e.Path)
			if err == nil {
				out = append(out, sub...)
			}
			continue
		}
		out = append(out, e.Path)
	}
	return out, nil
}

func commonBase(paths []string) string {
	if len(paths) != 1 {
		return ""
	}
	clean, err := storage.CleanRelative(paths[0])
	if err != nil {
		return ""
	}
	// If a single directory is archived, strip its parent so entries are tidy.
	if idx := strings.LastIndex(clean, "/"); idx >= 0 {
		return clean[:idx]
	}
	return ""
}

func (m *Manager) setStatus(id, status string) {
	_, _ = m.db.Exec(`UPDATE jobs SET status=?, updated_at=? WHERE id=?`, status, util.NowUTC(), id)
}

func (m *Manager) setProgress(id string, p float64) {
	if p > 1 {
		p = 1
	}
	_, _ = m.db.Exec(`UPDATE jobs SET progress=?, updated_at=? WHERE id=?`, p, util.NowUTC(), id)
}

func (m *Manager) finish(id, status, errMsg, _ string) {
	prog := 1.0
	if status == StatusFailed {
		prog = 0
	}
	_, _ = m.db.Exec(`UPDATE jobs SET status=?, error=?, progress=?, updated_at=? WHERE id=?`,
		status, errMsg, prog, util.NowUTC(), id)
}

// CleanupOldArchives removes archive cache files and job rows older than ttl.
func (m *Manager) CleanupOldArchives(ttl time.Duration) {
	rows, err := m.db.Query(`SELECT id FROM jobs WHERE type=? AND created_at < ?`,
		TypeArchive, time.Now().Add(-ttl).UTC().Format(time.RFC3339))
	if err != nil {
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		_ = os.Remove(m.ArchivePath(id))
		_, _ = m.db.Exec(`DELETE FROM jobs WHERE id=?`, id)
	}
}

func extractResult(typ, payload string) string {
	if typ != TypeArchive {
		return ""
	}
	var p ArchivePayload
	if json.Unmarshal([]byte(payload), &p) == nil {
		name := p.Name
		if name == "" {
			name = "archive"
		}
		return name + ".zip"
	}
	return ""
}

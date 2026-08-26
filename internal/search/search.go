// Package search provides a lightweight SQLite-backed metadata index and an
// incremental, low-priority scanner. It never uses Elasticsearch and never
// blocks startup: scanning runs in the background with bounded concurrency and
// respects each root's "indexed" flag and the storage symlink/traversal policy.
package search

import (
	"context"
	"errors"

	"github.com/nexora/nexora/internal/database"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/internal/storage"
	"github.com/nexora/nexora/internal/util"
)

// Result is a single search hit returned to callers.
type Result struct {
	RootID   string    `json:"root_id"`
	Path     string    `json:"path"`
	Name     string    `json:"name"`
	Ext      string    `json:"extension"`
	Size     int64     `json:"size"`
	IsDir    bool      `json:"is_dir"`
	Mime     string    `json:"mime"`
	Modified time.Time `json:"modified"`
}

// Query describes a search request across one or all authorized roots.
type Query struct {
	RootIDs        []string // roots the user may access (required, non-empty)
	RootID         string   // optional: restrict to a single root
	Path           string   // optional: restrict to a path prefix within a root
	Name           string   // substring match on file name (case-insensitive)
	Ext            string   // extension filter (no dot)
	Kind           string   // image|video|audio|document|archive|"" (any)
	MinSize        int64
	MaxSize        int64
	ModifiedAfter  time.Time
	ModifiedBefore time.Time
	Sort           string // relevance|newest|largest|name
	Limit          int
	Offset         int
}

// Service manages the metadata index and scanner.
type Service struct {
	db    *database.DB
	roots *storage.RootService
	log   *logger.Logger

	mu            sync.Mutex
	scanning      bool
	mediaScanning bool
	lastScan      time.Time
	indexed       int64
}

// NewService constructs the search service.
func NewService(db *database.DB, roots *storage.RootService, log *logger.Logger) *Service {
	return &Service{db: db, roots: roots, log: log}
}

// Status reports scanner state for metrics/observability.
func (s *Service) Status() (scanning bool, last time.Time, indexed int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.scanning, s.lastScan, s.indexed
}

// Search executes a metadata query. The RootIDs allow-list is enforced so a
// user can never see results from roots they cannot access.
func (s *Service) Search(ctx context.Context, q Query) ([]Result, error) {
	if len(q.RootIDs) == 0 {
		return nil, nil
	}
	var sb strings.Builder
	sb.WriteString(`SELECT root_id,path,name,ext,size,is_dir,mime,modified FROM search_index WHERE `)
	args := []any{}

	// Root allow-list.
	if q.RootID != "" {
		sb.WriteString("root_id = ? ")
		args = append(args, q.RootID)
	} else {
		sb.WriteString("root_id IN (")
		for i, id := range q.RootIDs {
			if i > 0 {
				sb.WriteString(",")
			}
			sb.WriteString("?")
			args = append(args, id)
		}
		sb.WriteString(") ")
	}

	if q.Path != "" {
		sb.WriteString("AND path LIKE ? ")
		args = append(args, escapeLike(q.Path)+"/%")
	}
	if q.Name != "" {
		sb.WriteString("AND lower(name) LIKE ? ESCAPE '\\' ")
		args = append(args, "%"+escapeLike(strings.ToLower(q.Name))+"%")
	}
	if q.Ext != "" {
		sb.WriteString("AND ext = ? ")
		args = append(args, strings.ToLower(strings.TrimPrefix(q.Ext, ".")))
	}
	if exts := kindExtensions(q.Kind); len(exts) > 0 {
		sb.WriteString("AND ext IN (")
		for i, e := range exts {
			if i > 0 {
				sb.WriteString(",")
			}
			sb.WriteString("?")
			args = append(args, e)
		}
		sb.WriteString(") ")
	}
	if q.MinSize > 0 {
		sb.WriteString("AND size >= ? ")
		args = append(args, q.MinSize)
	}
	if q.MaxSize > 0 {
		sb.WriteString("AND size <= ? ")
		args = append(args, q.MaxSize)
	}
	if !q.ModifiedAfter.IsZero() {
		sb.WriteString("AND modified >= ? ")
		args = append(args, q.ModifiedAfter.UTC().Format(time.RFC3339))
	}
	if !q.ModifiedBefore.IsZero() {
		sb.WriteString("AND modified <= ? ")
		args = append(args, q.ModifiedBefore.UTC().Format(time.RFC3339))
	}

	switch q.Sort {
	case "newest":
		sb.WriteString("ORDER BY modified DESC ")
	case "largest":
		sb.WriteString("ORDER BY size DESC ")
	case "name":
		sb.WriteString("ORDER BY lower(name) ASC ")
	default: // relevance: prefix matches first, then name
		if q.Name != "" {
			sb.WriteString("ORDER BY (CASE WHEN lower(name) LIKE ? THEN 0 ELSE 1 END), lower(name) ASC ")
			args = append(args, escapeLike(strings.ToLower(q.Name))+"%")
		} else {
			sb.WriteString("ORDER BY lower(name) ASC ")
		}
	}

	limit := q.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	sb.WriteString("LIMIT ? OFFSET ?")
	args = append(args, limit, q.Offset)

	rows, err := s.db.QueryContext(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Result
	for rows.Next() {
		var r Result
		var isDir int
		var mod string
		if err := rows.Scan(&r.RootID, &r.Path, &r.Name, &r.Ext, &r.Size, &isDir, &r.Mime, &mod); err != nil {
			return nil, err
		}
		r.IsDir = isDir == 1
		r.Modified = util.ParseTime(mod)
		out = append(out, r)
	}
	return out, rows.Err()
}

// Upsert indexes (or refreshes) a single entry. Called after Nexora file
// operations so the index stays warm without a full rescan.
func (s *Service) Upsert(rootID string, fi storage.FileInfo) {
	if strings.HasPrefix(fi.Path, ".nexora-trash") {
		return
	}
	_, _ = s.db.Exec(
		`INSERT INTO search_index(id,root_id,path,name,ext,size,is_dir,mime,modified)
		 VALUES(?,?,?,?,?,?,?,?,?)
		 ON CONFLICT(id) DO UPDATE SET
		   name=excluded.name, ext=excluded.ext, size=excluded.size,
		   is_dir=excluded.is_dir, mime=excluded.mime, modified=excluded.modified`,
		entryID(rootID, fi.Path), rootID, fi.Path, fi.Name, storage.Ext(fi.Name),
		fi.Size, boolToInt(fi.IsDir), fi.Mime, fi.Modified.UTC().Format(time.RFC3339))
}

// Remove deletes an entry (and any children if it was a directory prefix).
func (s *Service) Remove(rootID, path string) {
	_, _ = s.db.Exec(`DELETE FROM search_index WHERE id=?`, entryID(rootID, path))
	_, _ = s.db.Exec(`DELETE FROM search_index WHERE root_id=? AND path LIKE ?`, rootID, escapeLike(path)+"/%")
}

// RemoveRoot purges all index entries for a root.
func (s *Service) RemoveRoot(rootID string) {
	_, _ = s.db.Exec(`DELETE FROM search_index WHERE root_id=?`, rootID)
}

// Rename moves index entries from one path (and its subtree) to a new
// destination. Without this, files inside a renamed directory would be
// invisible to search until the next 6-hourly ScanAll reconciled the
// index (P1-7: stale search results for renamed subtrees).
//
// Implementation note: the index's primary key is `id = rootID + ":" + path`,
// so a rename is logically "delete the old rows, insert new rows at the
// new paths". We do both in one transaction with a temp-table approach
// to keep memory bounded for huge subtrees: read up to chunkSize rows
// at a time, compute the new (id, path), and INSERT OR REPLACE.
func (s *Service) Rename(rootID, src, dst string) {
	// src == "" is the root and is not a valid rename source.
	if src == "" {
		return
	}
	// Fast path: rename of a single file. The Move/Copy handlers only
	// call Rename after the on-disk move, so we know the dst already
	// exists and is likely a single file. We update the row in place
	// and recurse for any subtree.
	if dst == "" {
		// Renaming to root is not a real use case; just remove.
		s.Remove(rootID, src)
		return
	}
	srcPrefix := src
	if !strings.HasSuffix(srcPrefix, "/") {
		srcPrefix += "/"
	}
	dstPrefix := dst
	if !strings.HasSuffix(dstPrefix, "/") {
		dstPrefix += "/"
	}

	tx, err := s.db.Begin()
	if err != nil {
		// Fallback to a non-transactional update on the cheap path.
		s.renameSingle(rootID, src, dst)
		return
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	const chunkSize = 2000
	var lastID string
	for {
		var (
			id, path, name, ext, mime, modified string
			size                                 int64
			isDir                                int
		)
		query := `SELECT id, path, name, ext, size, is_dir, mime, modified FROM search_index WHERE root_id = ? AND (id = ? OR path LIKE ?)`
		args := []any{rootID, entryID(rootID, src), escapeLike(src) + "/%"}
		if lastID != "" {
			query += ` AND id > ?`
			args = append(args, lastID)
		}
		query += ` ORDER BY id LIMIT ?`
		args = append(args, chunkSize)

		rows, err := tx.Query(query, args...)
		if err != nil {
			s.log.Error("search.Rename: query failed", "error", err)
			return
		}
		batch := make([]renameOp, 0, chunkSize)
		for rows.Next() {
			if err := rows.Scan(&id, &path, &name, &ext, &size, &isDir, &mime, &modified); err != nil {
				rows.Close()
				s.log.Error("search.Rename: scan failed", "error", err)
				return
			}
			// Compute the new path. If this is the source itself, dst is
			// the new path; otherwise it's src's path with the src prefix
			// replaced by dst's prefix (preserving the trailing slashes).
			var newPath string
			if path == src {
				newPath = dst
			} else if strings.HasPrefix(path, srcPrefix) {
				newPath = dstPrefix + strings.TrimPrefix(path, srcPrefix)
			} else {
				// Defensive: the LIKE filter should have ensured this never
				// happens, but if it does we leave the path alone and move on.
				newPath = path
			}
			batch = append(batch, renameOp{
				oldID:   id,
				newID:   entryID(rootID, newPath),
				newPath: newPath,
				name:    name, ext: ext, size: size, isDir: isDir, mime: mime, modified: modified,
			})
			lastID = id
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			s.log.Error("search.Rename: rows error", "error", err)
			return
		}
		// Apply batch: delete the old id, insert with the new id+path.
		// INSERT OR REPLACE is a no-op for the common case where the
		// row's other fields haven't changed.
		for _, op := range batch {
			if _, err := tx.Exec(`DELETE FROM search_index WHERE id = ?`, op.oldID); err != nil {
				s.log.Error("search.Rename: delete failed", "error", err)
				return
			}
			if _, err := tx.Exec(
				`INSERT INTO search_index(id, root_id, path, name, ext, size, is_dir, mime, modified)
				 VALUES(?,?,?,?,?,?,?,?,?)
				 ON CONFLICT(id) DO UPDATE SET
				   name=excluded.name, ext=excluded.ext, size=excluded.size,
				   is_dir=excluded.is_dir, mime=excluded.mime, modified=excluded.modified`,
				op.newID, rootID, op.newPath, op.name, op.ext, op.size, op.isDir, op.mime, op.modified,
			); err != nil {
				s.log.Error("search.Rename: insert failed", "error", err)
				return
			}
		}
		if len(batch) < chunkSize {
			break
		}
	}
	if err := tx.Commit(); err != nil {
		s.log.Error("search.Rename: commit failed", "error", err)
		return
	}
	committed = true
}

// renameOp carries the data needed to update a single search_index row.
type renameOp struct {
	oldID, newID, newPath, name, ext, mime, modified string
	size                                            int64
	isDir                                           int
}

// renameSingle is the cheap path for a single-file rename outside a
// transaction. It is correct but unbounded for subtrees; the
// transaction-based Rename is the path used by Move/rename handlers.
func (s *Service) renameSingle(rootID, src, dst string) {
	var name, ext, mime, modified string
	var size int64
	var isDir int
	err := s.db.QueryRow(
		`SELECT name, ext, size, is_dir, mime, modified FROM search_index WHERE id = ?`,
		entryID(rootID, src),
	).Scan(&name, &ext, &size, &isDir, &mime, &modified)
	if err != nil {
		return // not indexed; nothing to do
	}
	_, _ = s.db.Exec(`DELETE FROM search_index WHERE id = ?`, entryID(rootID, src))
	_, _ = s.db.Exec(
		`INSERT INTO search_index(id, root_id, path, name, ext, size, is_dir, mime, modified)
		 VALUES(?,?,?,?,?,?,?,?,?)
		 ON CONFLICT(id) DO UPDATE SET
		   name=excluded.name, ext=excluded.ext, size=excluded.size,
		   is_dir=excluded.is_dir, mime=excluded.mime, modified=excluded.modified`,
		entryID(rootID, dst), rootID, dst, name, ext, size, isDir, mime, modified)
}

// ScanAll walks every indexed root with bounded concurrency. It is safe to call
// periodically; it never blocks the server and coalesces concurrent invocations.
func (s *Service) ScanAll(ctx context.Context) {
	s.mu.Lock()
	if s.scanning {
		s.mu.Unlock()
		return
	}
	s.scanning = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.scanning = false
		s.lastScan = time.Now()
		s.mu.Unlock()
	}()

	roots, err := s.roots.List()
	if err != nil {
		s.log.Error("search: list roots failed", "error", err)
		return
	}
	var total int64
	for _, root := range roots {
		if !root.Enabled || !root.Indexed {
			s.RemoveRoot(root.ID)
			continue
		}
		select {
		case <-ctx.Done():
			return
		default:
		}
		n := s.scanRoot(ctx, root)
		total += n
	}
	s.mu.Lock()
	s.indexed = total
	s.mu.Unlock()
}

// scanRoot indexes one root. Entries are written in short transactions
// (chunks) instead of one giant one: background indexing releases the SQLite
// write lock every chunk, so uploads and API writes interleave instead of
// queueing behind a minutes-long mega-transaction (the cause of uploads
// sticking at 100% while a scan ran). Symlink policy is unchanged: entries
// that escape the root are never followed.
func (s *Service) scanRoot(ctx context.Context, root storage.Root) int64 {
	absRoot := filepath.Clean(root.Path)
	var count int64
	const chunkSize = 2000
	const maxEntries = 500000 // safety cap for very large trees

	beginChunk := func() (*database.Tx, *sql.Stmt, error) {
		tx, err := s.db.Begin()
		if err != nil {
			return nil, nil, err
		}
		stmt, err := tx.Prepare(
			`INSERT OR REPLACE INTO search_index(id,root_id,path,name,ext,size,is_dir,mime,modified)
			 VALUES(?,?,?,?,?,?,?,?,?)`)
		if err != nil {
			_ = tx.Rollback()
			return nil, nil, err
		}
		return tx, stmt, nil
	}

	tx, stmt, err := beginChunk()
	if err != nil {
		s.log.Error("search: begin tx failed", "root", root.Name, "error", err)
		return 0
	}
	// Reset this root's entries then re-populate.
	if _, err := tx.Exec(`DELETE FROM search_index WHERE root_id=?`, root.ID); err != nil {
		s.log.Error("search: reset root failed", "root", root.Name, "error", err)
		_ = tx.Rollback()
		return 0
	}

	canceled := false
	walkErr := filepath.WalkDir(absRoot, func(p string, d os.DirEntry, entryErr error) error {
		if entryErr != nil {
			return nil // skip unreadable entries
		}
		select {
		case <-ctx.Done():
			canceled = true
			return context.Canceled
		default:
		}
		if count >= maxEntries {
			return filepath.SkipDir
		}
		rel, rerr := filepath.Rel(absRoot, p)
		if rerr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		// Skip Nexora-internal trash and any symlinked entries (symlink policy:
		// never traverse outside configured roots).
		if strings.HasPrefix(rel, ".nexora-trash") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		name := d.Name()
		if _, xerr := stmt.Exec(
			entryID(root.ID, rel), root.ID, rel, name, storage.Ext(name),
			info.Size(), boolToInt(d.IsDir()), storage.MimeFor(name, d.IsDir()),
			info.ModTime().UTC().Format(time.RFC3339)); xerr == nil {
			count++
		}
		if count%chunkSize == 0 {
			// Commit the chunk and open a fresh transaction so other writers
			// can acquire the write lock between batches.
			if cerr := stmt.Close(); cerr != nil {
				s.log.Error("search: close stmt failed", "root", root.Name, "error", cerr)
			}
			if cerr := tx.Commit(); cerr != nil {
				s.log.Error("search: chunk commit failed", "root", root.Name, "error", cerr)
				return cerr // aborts the walk; earlier chunks remain committed
			}
			ntx, nstmt, nerr := beginChunk()
			if nerr != nil {
				s.log.Error("search: begin chunk failed", "root", root.Name, "error", nerr)
				return nerr
			}
			tx, stmt = ntx, nstmt
		}
		return nil
	})

	if walkErr != nil {
		// Aborted mid-chunk (canceled or DB error): discard only the open
		// chunk; previously committed chunks stay and the next scan reconciles.
		_ = stmt.Close()
		_ = tx.Rollback()
		if canceled || errors.Is(walkErr, context.Canceled) {
			s.log.Debug("search: walk canceled", "root", root.Name, "entries", count)
		} else {
			s.log.Error("search: walk aborted", "root", root.Name, "error", walkErr)
		}
		return count
	}

	if serr := stmt.Close(); serr != nil {
		s.log.Error("search: close stmt failed", "root", root.Name, "error", serr)
	}
	if err := tx.Commit(); err != nil {
		s.log.Error("search: commit failed", "root", root.Name, "error", err)
		return count
	}
	s.log.Debug("search: indexed root", "root", root.Name, "entries", count)
	return count
}

func entryID(rootID, path string) string { return rootID + ":" + path }

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	s = strings.ReplaceAll(s, "_", "\\_")
	return s
}

func kindExtensions(kind string) []string {
	switch strings.ToLower(kind) {
	case "image":
		return []string{"jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tiff", "heic"}
	case "video":
		return []string{"mp4", "webm", "mov", "mkv", "avi", "m4v", "wmv", "flv"}
	case "audio":
		return []string{"mp3", "ogg", "wav", "flac", "m4a", "aac", "opus"}
	case "document":
		return []string{"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "rtf", "odt", "csv"}
	case "archive":
		return []string{"zip", "tar", "gz", "tgz", "rar", "7z", "bz2", "xz"}
	default:
		return nil
	}
}

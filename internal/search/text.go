package search

import (
	"context"
	"strings"
	"time"

	"github.com/nexora/nexora/internal/extract"
	"github.com/nexora/nexora/internal/storage"
)

// Capacity and pacing of the text-extraction loop. Extraction (PDF parse,
// OCR) is heavier than metadata scanning, so batches stay small and the loop
// yields between passes.
const (
	textBatchSize    = 20
	textIdleInterval = 30 * time.Second
)

// textEligible reports whether a file's extension can be indexed.
func textEligible(ext string) bool {
	return extract.Ext(ext)
}

// ScanFileText incrementally extracts searchable text for files that lack it
// (or whose content changed since extraction). It mirrors ScanMediaMetadata:
// a bounded batch per pass, an idle sleep between passes, and full shutdown
// cooperation via ctx. Best-effort — extraction errors are logged and the
// file is simply postponed until its next scan.
func (s *Service) ScanFileText(ctx context.Context, cfg extract.Config) {
	s.mu.Lock()
	if s.textScanning {
		s.mu.Unlock()
		return
	}
	s.textScanning = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.textScanning = false
		s.mu.Unlock()
	}()
	cfg.Defaults()

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		pending, err := s.pendingTextFiles(ctx, textBatchSize)
		if err != nil {
			s.log.Error("text: failed to find pending files", "error", err)
			return
		}
		if len(pending) == 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(textIdleInterval):
			}
			continue
		}

		for _, p := range pending {
			select {
			case <-ctx.Done():
				return
			default:
			}
			s.extractOneFile(ctx, p, cfg)
		}
	}
}

type pendingTextFile struct {
	RootID string
	Path   string
	Ext    string
	Size   int64
}

// pendingTextFiles finds indexed, eligible files whose file_text row is
// missing or stale (file mtime newer than extraction time).
func (s *Service) pendingTextFiles(ctx context.Context, limit int) ([]pendingTextFile, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.root_id, s.path, s.ext, s.size
		FROM search_index s
		LEFT JOIN file_text ft ON ft.root_id = s.root_id AND ft.path = s.path
		WHERE s.is_dir = 0
		  AND (ft.updated_at IS NULL OR ft.updated_at < s.modified)
		ORDER BY s.modified DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []pendingTextFile
	for rows.Next() {
		var p pendingTextFile
		if err := rows.Scan(&p.RootID, &p.Path, &p.Ext, &p.Size); err != nil {
			continue
		}
		if !textEligible(p.Ext) {
			continue
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// extractOneFile reads the file through its provider and stores the text.
func (s *Service) extractOneFile(ctx context.Context, p pendingTextFile, cfg extract.Config) {
	if p.Size > cfg.MaxFileSize {
		return // too large — skip silently (eligible check re-runs each pass, cheap)
	}
	root, ok, err := s.roots.Get(p.RootID)
	if err != nil || !ok {
		return
	}
	prov := s.roots.ProviderFor(root)
	if prov == nil {
		return
	}
	rc, err := prov.Read(p.Path)
	if err != nil {
		if err == storage.ErrNotFound {
			// File vanished mid-scan; drop any stale text row.
			s.RemoveText(p.RootID, p.Path)
		}
		return
	}
	text, err := extract.ExtractText(p.Ext, rc, p.Size, cfg)
	rc.Close()
	if err != nil {
		if err == extract.ErrNotExtractable || err == extract.ErrTooLarge {
			// Not extractable today (no OCR binary, unknown type): mark the
			// row with a fresh timestamp so we don't re-attempt every pass.
			s.UpsertText(p.RootID, p.Path, p.Ext, "", true)
		}
		return
	}
	s.UpsertText(p.RootID, p.Path, p.Ext, text, false)
	if s.log != nil && strings.TrimSpace(text) != "" {
		s.log.Debug("text: indexed content", "root_id", p.RootID, "path", p.Path)
	}
}

// UpsertText stores (or marks) extracted text for a file. When `markOnly` is
// true the text is empty and the row just records that extraction was
// attempted (so the loop doesn't hammer unparseable files every pass).
func (s *Service) UpsertText(rootID, path, ext, text string, markOnly bool) {
	if !markOnly {
		_, _ = s.db.Exec(`
			INSERT INTO file_text (root_id, path, ext, text, length, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(root_id, path) DO UPDATE SET
			  ext=excluded.ext, text=excluded.text, length=excluded.length, updated_at=excluded.updated_at`,
			rootID, path, strings.ToLower(strings.TrimPrefix(ext, ".")),
			text, len([]rune(text)), time.Now().UTC().Format(time.RFC3339))
		return
	}
	// "Attempted, nothing extracted" marker: text cleared, fresh timestamp.
	_, _ = s.db.Exec(`
		INSERT INTO file_text (root_id, path, ext, text, length, updated_at)
		VALUES (?, ?, ?, '', 0, ?)
		ON CONFLICT(root_id, path) DO UPDATE SET
		  ext=excluded.ext, text='', length=0, updated_at=excluded.updated_at`,
		rootID, path, strings.ToLower(strings.TrimPrefix(ext, ".")),
		time.Now().UTC().Format(time.RFC3339))
}

// RemoveText deletes the text row for a path (and subtree) — paired with
// search_index removal so rename/delete never leave orphaned content rows.
func (s *Service) RemoveText(rootID, path string) {
	_, _ = s.db.Exec(`DELETE FROM file_text WHERE root_id=? AND path=?`, rootID, path)
	_, _ = s.db.Exec(`DELETE FROM file_text WHERE root_id=? AND path LIKE ?`, rootID, escapeLike(path)+"/%")
}

// RemoveRootText purges all text rows for a root.
func (s *Service) RemoveRootText(rootID string) {
	_, _ = s.db.Exec(`DELETE FROM file_text WHERE root_id=?`, rootID)
}

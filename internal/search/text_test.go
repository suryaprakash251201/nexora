package search

import (
	"context"
	"database/sql"
	"testing"
)

func seedTextRow(t *testing.T, db *sql.DB, rootID, path, text string) {
	t.Helper()
	if _, err := db.Exec(
		`INSERT INTO file_text (root_id, path, ext, text, length, updated_at)
		 VALUES (?, ?, 'pdf', ?, ?, '2026-01-01T00:00:00Z')`,
		rootID, path, text, len([]rune(text)),
	); err != nil {
		t.Fatalf("seed file_text: %v", err)
	}
}

func TestTextSearch_Match(t *testing.T) {
	svc, db := newTestService(t)
	seedPhoto(t, db, "id1", "r1", "manual.pdf", "manual.pdf", "application/pdf", "2026-01-01T00:00:00Z")
	seedPhoto(t, db, "id2", "r1", "photo.jpg", "photo.jpg", "image/jpeg", "2026-01-01T00:00:00Z")
	seedTextRow(t, db, "r1", "manual.pdf", "The quantum espresso brewing guide")

	results, err := svc.Search(context.Background(), Query{
		RootIDs: []string{"r1"},
		Text:    "quantum espresso",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].Path != "manual.pdf" {
		t.Fatalf("expected manual.pdf to match, got %+v", results)
	}
}

func TestTextSearch_AllTermsMustMatch(t *testing.T) {
	svc, db := newTestService(t)
	seedPhoto(t, db, "id1", "r1", "a.txt", "a.txt", "text/plain", "2026-01-01T00:00:00Z")
	seedPhoto(t, db, "id2", "r1", "b.txt", "b.txt", "text/plain", "2026-01-01T00:00:00Z")
	seedTextRow(t, db, "r1", "a.txt", "alpha beta gamma")
	seedTextRow(t, db, "r1", "b.txt", "alpha only")

	// Both terms must be present in the SAME file → only a.txt.
	results, err := svc.Search(context.Background(), Query{RootIDs: []string{"r1"}, Text: "alpha gamma"})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].Path != "a.txt" {
		t.Fatalf("expected only a.txt, got %+v", results)
	}
}

func TestTextSearch_NoTextNoMatch(t *testing.T) {
	svc, db := newTestService(t)
	seedPhoto(t, db, "id1", "r1", "photo.jpg", "photo.jpg", "image/jpeg", "2026-01-01T00:00:00Z")
	// photo.jpg has NO file_text row — a text query must not match it.
	results, err := svc.Search(context.Background(), Query{RootIDs: []string{"r1"}, Text: "anything"})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 0 {
		t.Fatalf("expected no matches without text rows, got %+v", results)
	}
}

func TestTextSearch_CombinedWithNameFilter(t *testing.T) {
	svc, db := newTestService(t)
	seedPhoto(t, db, "id1", "r1", "report.pdf", "report.pdf", "application/pdf", "2026-01-01T00:00:00Z")
	seedPhoto(t, db, "id2", "r1", "notes.pdf", "notes.pdf", "application/pdf", "2026-01-01T00:00:00Z")
	seedTextRow(t, db, "r1", "report.pdf", "quarterly numbers 2026")
	seedTextRow(t, db, "r1", "notes.pdf", "quarterly numbers 2026")

	// text + name filter combine as AND.
	results, err := svc.Search(context.Background(), Query{RootIDs: []string{"r1"}, Name: "report", Text: "quarterly"})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].Path != "report.pdf" {
		t.Fatalf("expected only report.pdf, got %+v", results)
	}
}

func TestScanFileText_IndexesAndSkips(t *testing.T) {
	svc, _ := newTestService(t)
	// The unit seam here is pendingTextFiles — verify it only returns
	// eligible, stale files.
	db := svc.db.DB
	// eligible + stale
	_, _ = db.Exec(`INSERT INTO search_index(id, root_id, path, name, ext, size, is_dir, mime, modified)
		VALUES('x1','r9','doc.pdf','doc.pdf','pdf',100,0,'application/pdf','2026-01-01T00:00:00Z')`)
	// eligible + fresh (no re-extract)
	_, _ = db.Exec(`INSERT INTO search_index(id, root_id, path, name, ext, size, is_dir, mime, modified)
		VALUES('x2','r9','notes.md','notes.md','md',100,0,'text/markdown','2026-01-01T00:00:00Z')`)
	_, _ = db.Exec(`INSERT INTO file_text(root_id, path, ext, text, length, updated_at)
		VALUES('r9','notes.md','md','done',4,'2026-06-01T00:00:00Z')`)
	// ineligible ext
	_, _ = db.Exec(`INSERT INTO search_index(id, root_id, path, name, ext, size, is_dir, mime, modified)
		VALUES('x3','r9','blob.zip','blob.zip','zip',100,0,'application/zip','2026-01-01T00:00:00Z')`)

	pending, err := svc.pendingTextFiles(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].Path != "doc.pdf" {
		t.Fatalf("expected only stale pdf pending, got %+v", pending)
	}
}

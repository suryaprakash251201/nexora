package playlists

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"

	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/migrations"
)

// newTestStore opens an in-memory SQLite DB, applies all real migrations, and
// builds a Store wired to it — the exact SQL and schema production runs.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	if err := migrations.Run(db); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	return NewStore(database.Wrap(db, "sqlite"))
}

func seedUser(t *testing.T, db *sql.DB, id string) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO users (id, username, email, display_name, password_hash) VALUES (?, ?, ?, '', 'x')`,
		id, "user_"+id, id+"@test.local")
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
}

func TestCreateWithItems_AtomicAndOrdered(t *testing.T) {
	s := newTestStore(t)

	items := []PlaylistItem{
		{RootID: "root1", Path: "/music/a.flac"},
		{RootID: "root1", Path: "/music/b.flac"},
		// duplicate of the first — must be skipped
		{RootID: "root1", Path: "/music/a.flac"},
	}
	pl, err := s.CreateWithItems("u1", "Road trip", "Long drive tunes", items)
	if err != nil {
		t.Fatalf("CreateWithItems: %v", err)
	}
	if pl.Name != "Road trip" || pl.Description != "Long drive tunes" {
		t.Fatalf("unexpected playlist meta: %+v", pl)
	}
	if len(pl.Items) != 2 {
		t.Fatalf("expected 2 unique items, got %d", len(pl.Items))
	}

	got, err := s.ListForUser("u1")
	if err != nil {
		t.Fatalf("ListForUser: %v", err)
	}
	if len(got) != 1 || got[0].Description != "Long drive tunes" {
		t.Fatalf("description not persisted: %+v", got[0])
	}
	if len(got[0].Items) != 2 {
		t.Fatalf("items not persisted: %+v", got[0].Items)
	}
	if got[0].Items[0].Path != "/music/a.flac" || got[0].Items[1].Path != "/music/b.flac" {
		t.Fatalf("insertion order not preserved: %+v", got[0].Items)
	}
	if got[0].Items[0].Position != 0 || got[0].Items[1].Position != 1 {
		t.Fatalf("positions not assigned: %+v", got[0].Items)
	}
}

func TestReorderItems(t *testing.T) {
	s := newTestStore(t)
	pl, err := s.CreateWithItems("u1", "Mix", "", []PlaylistItem{
		{RootID: "r", Path: "/a.mp3"},
		{RootID: "r", Path: "/b.mp3"},
		{RootID: "r", Path: "/c.mp3"},
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	ids := []string{pl.Items[0].ID, pl.Items[1].ID, pl.Items[2].ID}

	// Move the last track to the front.
	newOrder := []string{ids[2], ids[0], ids[1]}
	if err := s.ReorderItems("u1", pl.ID, newOrder); err != nil {
		t.Fatalf("ReorderItems: %v", err)
	}

	got, err := s.ListForUser("u1")
	if err != nil {
		t.Fatalf("ListForUser: %v", err)
	}
	for i, want := range []string{"/c.mp3", "/a.mp3", "/b.mp3"} {
		if got[0].Items[i].Path != want {
			t.Fatalf("position %d: got %s want %s", i, got[0].Items[i].Path, want)
		}
	}

	// Unauthorized user cannot reorder.
	if err := s.ReorderItems("intruder", pl.ID, newOrder); err == nil {
		t.Fatal("expected unauthorized reorder to fail")
	}
}

func TestAddItems_AppendsAfterExistingPositions(t *testing.T) {
	s := newTestStore(t)
	pl, err := s.CreateWithItems("u1", "Late night", "", []PlaylistItem{
		{RootID: "r", Path: "/one.mp3"},
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	added, err := s.AddItems("u1", pl.ID, []PlaylistItem{
		{RootID: "r", Path: "/two.mp3"},
		{RootID: "r", Path: "/one.mp3"}, // dup — skipped
	})
	if err != nil {
		t.Fatalf("AddItems: %v", err)
	}
	if added != 1 {
		t.Fatalf("expected 1 added, got %d", added)
	}

	got, _ := s.ListForUser("u1")
	if len(got[0].Items) != 2 || got[0].Items[1].Path != "/two.mp3" {
		t.Fatalf("append failed: %+v", got[0].Items)
	}
	if got[0].Items[1].Position <= got[0].Items[0].Position {
		t.Fatalf("appended item must have higher position: %+v", got[0].Items)
	}
}

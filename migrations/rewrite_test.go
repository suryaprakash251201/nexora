package migrations

import (
	"strings"
	"testing"
)

func TestToPostgres_PragmaStripped(t *testing.T) {
  got := ToPostgres("PRAGMA foreign_keys = ON; CREATE TABLE foo (id TEXT PRIMARY KEY);")
  if contains(got, "PRAGMA") {
    t.Fatalf("PRAGMA not stripped: %q", got)
  }
}

func TestToPostgres_Placeholders(t *testing.T) {
  got := ToPostgres("SELECT * FROM foo WHERE a=? AND b=? AND c='?'")
  want := "SELECT * FROM foo WHERE a=$1 AND b=$2 AND c='?'"
  if got != want {
    t.Fatalf("got %q want %q", got, want)
  }
}

func TestToPostgres_Strftime(t *testing.T) {
  got := ToPostgres("SELECT CAST(strftime('%Y', x) AS INTEGER)")
  if !contains(got, "TO_CHAR(x, 'YYYY')") {
    t.Fatalf("strftime %%Y not converted: %q", got)
  }
  got = ToPostgres("SELECT CAST(strftime('%m', y) AS INTEGER) = ?")
  if !contains(got, "TO_CHAR(y, 'MM')") || !contains(got, "$1") {
    t.Fatalf("strftime %%m / placeholder not converted: %q", got)
  }
}

func TestToPostgres_InsertOrIgnore(t *testing.T) {
	got := ToPostgres("INSERT OR IGNORE INTO playlist_items (id, playlist_id, root_id, path, created_at) VALUES (?, ?, ?, ?, ?)")
	want := "INSERT INTO playlist_items (id, playlist_id, root_id, path, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestToPostgres_InsertOrIgnore_MultiStatement(t *testing.T) {
	got := ToPostgres("INSERT OR IGNORE INTO playlist_items (id, path) VALUES ('a', '/music/x flac'); INSERT OR IGNORE INTO t2 (a) VALUES ('b;c')")
	if !contains(got, "INSERT INTO playlist_items (id, path) VALUES ('a', '/music/x flac') ON CONFLICT DO NOTHING") {
		t.Fatalf("first statement not converted: %q", got)
	}
	// Semicolon inside a string literal must not split the statement.
	if !contains(got, "INSERT INTO t2 (a) VALUES ('b;c') ON CONFLICT DO NOTHING") {
		t.Fatalf("second statement not converted: %q", got)
	}
	if contains(got, "OR IGNORE") {
		t.Fatalf("INSERT OR IGNORE survived conversion: %q", got)
	}
}

func TestToPostgres_InsertOrReplace(t *testing.T) {
  got := ToPostgres("INSERT OR REPLACE INTO search_index(id, root_id, name) VALUES (?, ?, ?)")
  if !contains(got, "ON CONFLICT (id) DO UPDATE SET") {
    t.Fatalf("search_index not converted: %q", got)
  }
  got = ToPostgres("INSERT OR REPLACE INTO playlist_collaborators (playlist_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
  if !contains(got, "ON CONFLICT (playlist_id, user_id) DO UPDATE SET") {
    t.Fatalf("playlist_collaborators not converted: %q", got)
  }
  if !contains(got, "role = EXCLUDED.role") {
    t.Fatalf("non-pk SET missing: %q", got)
  }
}

func contains(s, sub string) bool { return strings.Contains(s, sub) }

package search

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	_ "modernc.org/sqlite"

	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/migrations"
)

// newTestService opens an in-memory SQLite DB, applies all real migrations,
// and builds a Service wired to it. This makes the test run the exact SQL the
// production server runs, against the exact schema it creates.
func newTestService(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	if err := migrations.Run(db); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	log := logger.New("error", "test")
	return NewService(db, nil, log), db
}

func seedPhoto(t *testing.T, db *sql.DB, id, rootID, path, name, mime, modified string) {
	t.Helper()
	if _, err := db.Exec(
		`INSERT INTO search_index(id, root_id, path, name, ext, size, is_dir, mime, modified)
		 VALUES(?, ?, ?, ?, ?, 0, 0, ?, ?)`,
		id, rootID, path, name, strings.TrimPrefix(strings.ToLower(extOf(name)), "."), mime, modified,
	); err != nil {
		t.Fatalf("seed search_index: %v", err)
	}
}

func extOf(name string) string {
	idx := strings.LastIndex(name, ".")
	if idx < 0 {
		return ""
	}
	return name[idx+1:]
}

// TestGetPhotosTimelineAgainstRealSchema guards against schema drift: the
// photos query joins favorites/media_metadata, so a column that no longer
// exists (e.g. the favorites table never had an `id` column) must not be
// referenced. This used to fail with "no such column: fav.id".
func TestGetPhotosTimelineAgainstRealSchema(t *testing.T) {
	svc, db := newTestService(t)

	const rootID = "root_1"
	seedPhoto(t, db, "img_1", rootID, "vacation/a.jpg", "a.jpg", "image/jpeg", "2024-06-01T10:00:00Z")
	seedPhoto(t, db, "img_2", rootID, "vacation/b.jpg", "b.jpg", "image/jpeg", "2024-06-02T10:00:00Z")

	// One photo has EXIF metadata; the other has none.
	if _, err := db.Exec(
		`INSERT INTO media_metadata(id, date_taken, lat, lng, make, model, width, height)
		 VALUES('img_1', '2024-06-01T09:00:00Z', 51.5, -0.12, 'Canon', 'EOS R5', 4000, 3000)`,
	); err != nil {
		t.Fatalf("seed media_metadata: %v", err)
	}

	// img_2 is favorited by the user.
	if _, err := db.Exec(
		`INSERT INTO favorites(user_id, root_id, path, created_at)
		 VALUES('user_1', ?, 'vacation/b.jpg', '2024-06-03T00:00:00Z')`, rootID,
	); err != nil {
		t.Fatalf("seed favorites: %v", err)
	}

	ctx := context.Background()
	rootIDs := []string{rootID}

	// 1. Plain query (no filters) — must not error, must mark is_favorite.
	all, err := svc.GetPhotosTimeline(ctx, "user_1", rootIDs, PhotoQuery{Sort: "date_desc"}, 100, 0)
	if err != nil {
		t.Fatalf("GetPhotosTimeline (plain): %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("expected 2 photos, got %d", len(all))
	}
	favByID := map[string]bool{}
	for _, p := range all {
		favByID[p.ID] = p.IsFavorite
	}
	if !favByID["img_2"] {
		t.Errorf("img_2 should be marked favorite, got %+v", all)
	}
	if favByID["img_1"] {
		t.Errorf("img_1 should not be favorite")
	}

	// 2. favorites_only filter — must not error.
	favs, err := svc.GetPhotosTimeline(ctx, "user_1", rootIDs, PhotoQuery{FavoritesOnly: true, Sort: "date_desc"}, 100, 0)
	if err != nil {
		t.Fatalf("GetPhotosTimeline (favorites_only): %v", err)
	}
	if len(favs) != 1 || favs[0].ID != "img_2" {
		t.Fatalf("expected only img_2 with favorites_only, got %+v", favs)
	}

	// 3. EXIF-based filters — must not error and respect the metadata.
	byYear, err := svc.GetPhotosTimeline(ctx, "user_1", rootIDs, PhotoQuery{Year: 2024, Sort: "date_desc"}, 100, 0)
	if err != nil {
		t.Fatalf("GetPhotosTimeline (year filter): %v", err)
	}
	if len(byYear) != 2 {
		t.Fatalf("expected 2 photos in 2024, got %d", len(byYear))
	}

	byCamera, err := svc.GetPhotosTimeline(ctx, "user_1", rootIDs, PhotoQuery{CameraMake: "Canon", Sort: "date_desc"}, 100, 0)
	if err != nil {
		t.Fatalf("GetPhotosTimeline (camera filter): %v", err)
	}
	if len(byCamera) != 1 || byCamera[0].ID != "img_1" {
		t.Fatalf("expected only img_1 for Canon, got %+v", byCamera)
	}

	byLocation, err := svc.GetPhotosTimeline(ctx, "user_1", rootIDs, PhotoQuery{HasLocation: true, Sort: "date_desc"}, 100, 0)
	if err != nil {
		t.Fatalf("GetPhotosTimeline (location filter): %v", err)
	}
	if len(byLocation) != 1 || byLocation[0].ID != "img_1" {
		t.Fatalf("expected only img_1 for location filter, got %+v", byLocation)
	}

	// 4. date_from / date_to bounds.
	from, err := svc.GetPhotosTimeline(ctx, "user_1", rootIDs, PhotoQuery{DateFrom: "2024-06-01", Sort: "date_desc"}, 100, 0)
	if err != nil {
		t.Fatalf("GetPhotosTimeline (date_from): %v", err)
	}
	if len(from) != 2 {
		t.Fatalf("expected 2 photos from 2024-06-01, got %d", len(from))
	}
	to, err := svc.GetPhotosTimeline(ctx, "user_1", rootIDs, PhotoQuery{DateTo: "2024-06-01", Sort: "date_desc"}, 100, 0)
	if err != nil {
		t.Fatalf("GetPhotosTimeline (date_to): %v", err)
	}
	if len(to) != 1 {
		t.Fatalf("expected 1 photo by 2024-06-01, got %d", len(to))
	}

	// 5. Count must agree with the query (and not error).
	total, err := svc.CountPhotos(ctx, "user_1", rootIDs, PhotoQuery{})
	if err != nil {
		t.Fatalf("CountPhotos: %v", err)
	}
	if total != 2 {
		t.Fatalf("expected count 2, got %d", total)
	}
	favTotal, err := svc.CountPhotos(ctx, "user_1", rootIDs, PhotoQuery{FavoritesOnly: true})
	if err != nil {
		t.Fatalf("CountPhotos (favorites_only): %v", err)
	}
	if favTotal != 1 {
		t.Fatalf("expected favorite count 1, got %d", favTotal)
	}

	// 6. Pagination probe: limit+1 (as the handler uses) must be exact.
	page, err := svc.GetPhotosTimeline(ctx, "user_1", rootIDs, PhotoQuery{Sort: "date_desc"}, 1, 0)
	if err != nil {
		t.Fatalf("GetPhotosTimeline (limit 1): %v", err)
	}
	if len(page) != 1 {
		t.Fatalf("expected 1 photo for limit=1, got %d", len(page))
	}
}

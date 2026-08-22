package search

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"

	"github.com/nexora/nexora/internal/database"
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
	return NewService(database.Wrap(db, "sqlite"), nil, log), db
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

	// Dimensions must flow through for the variable-height gallery rows.
	var img1Dim *PhotoResult
	for _, p := range all {
		if p.ID == "img_1" {
			img1Dim = &p
		}
	}
	if img1Dim == nil || img1Dim.Width != 4000 || img1Dim.Height != 3000 {
		t.Errorf("img_1 dimensions missing or wrong: %+v", img1Dim)
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
	if page, err := svc.GetPhotosTimeline(ctx, "user_1", rootIDs, PhotoQuery{Sort: "date_desc"}, 1, 0); err != nil {
		t.Fatalf("GetPhotosTimeline (limit 1): %v", err)
	} else if len(page) != 1 {
		t.Fatalf("expected 1 photo for limit=1, got %d", len(page))
	}
}

// TestImageDimensions parses real, minimal file headers for the four formats
// the gallery tiles rely on.
func TestImageDimensions(t *testing.T) {
	cases := []struct {
		name  string
		data  []byte
		wantW int
		wantH int
	}{
		{
			name:  "jpeg baseline",
			data:  jpegHeader(4000, 3000),
			wantW: 4000,
			wantH: 3000,
		},
		{
			name:  "png",
			data:  pngHeader(1920, 1080),
			wantW: 1920,
			wantH: 1080,
		},
		{
			name:  "gif",
			data:  gifHeader(640, 480),
			wantW: 640,
			wantH: 480,
		},
		{
			name:  "webp lossy",
			data:  webpHeader(512, 384),
			wantW: 512,
			wantH: 384,
		},
		{
			name:  "unknown format",
			data:  []byte("not an image at all"),
			wantW: 0,
			wantH: 0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "img.bin")
			if err := os.WriteFile(path, tc.data, 0o644); err != nil {
				t.Fatalf("write: %v", err)
			}
			w, h := imageDimensions(path)
			if w != tc.wantW || h != tc.wantH {
				t.Fatalf("imageDimensions = %dx%d, want %dx%d", w, h, tc.wantW, tc.wantH)
			}
		})
	}
}

func jpegHeader(w, h int) []byte {
	buf := []byte{0xFF, 0xD8}
	// APP0 JFIF segment
	seg := append([]byte("JFIF\x00"), make([]byte, 9)...)
	buf = append(buf, 0xFF, 0xE0, byte((len(seg)+2)>>8), byte(len(seg)+2))
	buf = append(buf, seg...)
	// SOF0
	sof := make([]byte, 12)
	sof[0] = 8 // precision
	sof[1] = byte(h >> 8)
	sof[2] = byte(h)
	sof[3] = byte(w >> 8)
	sof[4] = byte(w)
	sof[5] = 3 // components
	sof = append(sof, 0, 0x11, 0, 0, 0x11, 0, 0, 0x11, 0)
	buf = append(buf, 0xFF, 0xC0, byte((len(sof)+2)>>8), byte(len(sof)+2))
	buf = append(buf, sof...)
	buf = append(buf, 0xFF, 0xD9)
	return buf
}

func pngHeader(w, h int) []byte {
	buf := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}
	buf = append(buf, 0, 0, 0, 13, 'I', 'H', 'D', 'R')
	buf = append(buf, byte(w>>24), byte(w>>16), byte(w>>8), byte(w))
	buf = append(buf, byte(h>>24), byte(h>>16), byte(h>>8), byte(h))
	buf = append(buf, 8, 2, 0, 0, 0) // bit depth, color type, compression, filter, interlace
	buf = append(buf, 0, 0, 0, 0)    // CRC (ignored by parser)
	return buf
}

func gifHeader(w, h int) []byte {
	buf := []byte("GIF89a")
	buf = append(buf, byte(w), byte(w>>8), byte(h), byte(h>>8))
	buf = append(buf, 0, 0, 0) // packed, bg color, aspect
	return buf
}

func webpHeader(w, h int) []byte {
	buf := append([]byte("RIFF"), 0, 0, 0, 0)                   // 0..7
	buf = append(buf, "WEBP"...)                                // 8..11
	buf = append(buf, "VP8 "...)                                // 12..15: chunk type
	buf = append(buf, 0, 0, 0)                                  // frame tag (16..18)
	buf = append(buf, 0x9D, 0x01, 0x2A)                         // keyframe start code (19..21)
	buf = append(buf, byte(w), byte(w>>8), byte(h), byte(h>>8)) // dims (22..25)
	return buf
}

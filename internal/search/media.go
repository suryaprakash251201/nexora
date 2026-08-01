package search

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rwcarlsen/goexif/exif"
)

// ScanMediaMetadata finds images in search_index that lack EXIF data in media_metadata
// and extracts their EXIF data.
func (s *Service) ScanMediaMetadata(ctx context.Context) {
	s.mu.Lock()
	if s.mediaScanning {
		s.mu.Unlock()
		return
	}
	s.mediaScanning = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.mediaScanning = false
		s.mu.Unlock()
	}()

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Find up to 100 images that don't have media_metadata yet.
		rows, err := s.db.Query(`
			SELECT s.id, s.root_id, s.path 
			FROM search_index s
			LEFT JOIN media_metadata m ON s.id = m.id
			WHERE s.mime LIKE 'image/%' AND m.id IS NULL
			LIMIT 100
		`)
		if err != nil {
			s.log.Error("media: failed to query pending media", "error", err)
			return
		}

		var pending []struct{ ID, RootID, Path string }
		for rows.Next() {
			var p struct{ ID, RootID, Path string }
			if err := rows.Scan(&p.ID, &p.RootID, &p.Path); err == nil {
				pending = append(pending, p)
			}
		}
		rows.Close()

		if len(pending) == 0 {
			time.Sleep(1 * time.Minute) // Sleep when idle
			continue
		}

		roots, err := s.roots.List()
		if err != nil {
			return
		}
		rootMap := make(map[string]string)
		for _, r := range roots {
			rootMap[r.ID] = r.Path
		}

		tx, err := s.db.Begin()
		if err != nil {
			return
		}
		stmt, err := tx.Prepare(`
			INSERT INTO media_metadata(id, date_taken, lat, lng, make, model, width, height)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?)
		`)
		if err != nil {
			tx.Rollback()
			return
		}

		for _, p := range pending {
			rootPath, ok := rootMap[p.RootID]
			if !ok {
				continue
			}
			absPath := filepath.Join(rootPath, p.Path)
			dateTaken, lat, lng, makeStr, modelStr := extractExif(absPath)
			
			// We insert even if blank, so we don't keep retrying.
			_, _ = stmt.Exec(p.ID, dateTaken, lat, lng, makeStr, modelStr, 0, 0)
		}
		stmt.Close()
		_ = tx.Commit()
		
		time.Sleep(100 * time.Millisecond) // Yield
	}
}

func extractExif(path string) (dateTaken string, lat, lng float64, makeStr, modelStr string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	x, err := exif.Decode(f)
	if err != nil {
		return
	}

	if tm, err := x.DateTime(); err == nil {
		dateTaken = tm.UTC().Format(time.RFC3339)
	}

	if lt, lg, err := x.LatLong(); err == nil {
		lat, lng = lt, lg
	}

	if t, err := x.Get(exif.Make); err == nil {
		makeStr, _ = t.StringVal()
		makeStr = strings.TrimSpace(strings.Trim(makeStr, "\"\x00"))
	}
	if t, err := x.Get(exif.Model); err == nil {
		modelStr, _ = t.StringVal()
		modelStr = strings.TrimSpace(strings.Trim(modelStr, "\"\x00"))
	}

	return
}

// PhotoResult represents an image for the timeline view.
type PhotoResult struct {
	ID         string  `json:"id"`
	RootID     string  `json:"root_id"`
	Path       string  `json:"path"`
	Name       string  `json:"name"`
	DateTaken  string  `json:"date_taken"` // ISO8601
	Lat        float64 `json:"lat,omitempty"`
	Lng        float64 `json:"lng,omitempty"`
	Make       string  `json:"make,omitempty"`
	Model      string  `json:"model,omitempty"`
	IsFavorite bool    `json:"is_favorite"`
}

// PhotoQuery carries optional filters for the photos timeline.
type PhotoQuery struct {
	Q             string // name search
	Year          int
	Month         int
	CameraMake    string
	HasLocation   bool
	FavoritesOnly bool
	DateFrom      string // YYYY-MM-DD (inclusive, start of day)
	DateTo        string // YYYY-MM-DD (inclusive, end of day)
	Sort          string // date_desc | date_asc | name
}

// dateTakenExpr is the SQL expression for the effective photo date:
// EXIF date_taken when present, otherwise the indexed file modification time.
const dateTakenExpr = "COALESCE(NULLIF(m.date_taken, ''), s.modified)"

// buildPhotoWhere writes the shared WHERE clause (excluding the base root/mime
// predicate) for photo queries and appends its arguments.
func buildPhotoWhere(sb *strings.Builder, args *[]any, userID string, rootIDs []string, q PhotoQuery) {
	sb.WriteString(`
		FROM search_index s
		LEFT JOIN media_metadata m ON s.id = m.id
		LEFT JOIN favorites fav ON fav.user_id = ? AND fav.root_id = s.root_id AND fav.path = s.path
		WHERE s.root_id IN (`)

	*args = append(*args, userID)
	for i, id := range rootIDs {
		if i > 0 {
			sb.WriteString(",")
		}
		sb.WriteString("?")
		*args = append(*args, id)
	}
	sb.WriteString(") AND s.mime LIKE 'image/%'")

	if q.Q != "" {
		sb.WriteString(" AND s.name LIKE ? ESCAPE '\\'")
		*args = append(*args, "%"+escapeLike(q.Q)+"%")
	}
	if q.Year > 0 {
		sb.WriteString(" AND CAST(strftime('%Y', " + dateTakenExpr + ") AS INTEGER) = ?")
		*args = append(*args, q.Year)
	}
	if q.Month > 0 {
		sb.WriteString(" AND CAST(strftime('%m', " + dateTakenExpr + ") AS INTEGER) = ?")
		*args = append(*args, q.Month)
	}
	if q.CameraMake != "" {
		sb.WriteString(" AND m.make = ?")
		*args = append(*args, q.CameraMake)
	}
	if q.HasLocation {
		sb.WriteString(" AND m.lat IS NOT NULL AND m.lng IS NOT NULL")
	}
	if q.FavoritesOnly {
		sb.WriteString(" AND fav.id IS NOT NULL")
	}
	if q.DateFrom != "" {
		sb.WriteString(" AND " + dateTakenExpr + " >= ?")
		*args = append(*args, q.DateFrom+"T00:00:00")
	}
	if q.DateTo != "" {
		sb.WriteString(" AND " + dateTakenExpr + " <= ?")
		*args = append(*args, q.DateTo+"T23:59:59.999Z")
	}
}

// GetPhotosTimeline returns indexed photos sorted by date_taken descending.
// Falls back to file modification date for images without EXIF data.
func (s *Service) GetPhotosTimeline(ctx context.Context, userID string, rootIDs []string, q PhotoQuery, limit, offset int) ([]PhotoResult, error) {
	if len(rootIDs) == 0 {
		return nil, nil
	}

	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	var sb strings.Builder
	sb.WriteString(`
		SELECT s.id, s.root_id, s.path, s.name,
		       ` + dateTakenExpr + ` as date_taken,
		       m.lat, m.lng, m.make, m.model,
		       CASE WHEN fav.id IS NULL THEN 0 ELSE 1 END AS is_favorite`)

	args := []any{}
	buildPhotoWhere(&sb, &args, userID, rootIDs, q)

	switch q.Sort {
	case "date_asc":
		sb.WriteString(" ORDER BY " + dateTakenExpr + " ASC")
	case "name":
		sb.WriteString(" ORDER BY s.name COLLATE NOCASE ASC")
	default:
		sb.WriteString(" ORDER BY " + dateTakenExpr + " DESC")
	}
	sb.WriteString(" LIMIT ? OFFSET ?")
	args = append(args, limit, offset)

	rows, err := s.db.QueryContext(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PhotoResult
	for rows.Next() {
		var p PhotoResult
		var lat, lng sql.NullFloat64
		var makeStr, modelStr sql.NullString

		if err := rows.Scan(&p.ID, &p.RootID, &p.Path, &p.Name, &p.DateTaken, &lat, &lng, &makeStr, &modelStr, &p.IsFavorite); err != nil {
			return nil, err
		}
		if lat.Valid {
			p.Lat = lat.Float64
		}
		if lng.Valid {
			p.Lng = lng.Float64
		}
		if makeStr.Valid {
			p.Make = makeStr.String
		}
		if modelStr.Valid {
			p.Model = modelStr.String
		}

		out = append(out, p)
	}

	return out, rows.Err()
}

// CountPhotos returns the total number of photos matching the query filters.
// Used for the timeline header stats; not paginated.
func (s *Service) CountPhotos(ctx context.Context, userID string, rootIDs []string, q PhotoQuery) (int, error) {
	if len(rootIDs) == 0 {
		return 0, nil
	}

	var sb strings.Builder
	sb.WriteString(`
		SELECT COUNT(*)`)

	args := []any{}
	buildPhotoWhere(&sb, &args, userID, rootIDs, q)

	var total int
	if err := s.db.QueryRowContext(ctx, sb.String(), args...).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

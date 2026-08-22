package search

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"io"
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

		// Find up to 100 images that don't have media_metadata yet, or whose
		// dimensions were never extracted (rows created before width/height
		// scanning existed).
		rows, err := s.db.QueryContext(ctx, `
			SELECT s.id, s.root_id, s.path
			FROM search_index s
			LEFT JOIN media_metadata m ON s.id = m.id
			WHERE s.mime LIKE 'image/%' AND (m.id IS NULL OR m.width = 0 OR m.height = 0)
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
		closeErr := rows.Close()
		if closeErr == nil {
			closeErr = rows.Err()
		}
		if closeErr != nil {
			s.log.Error("media: failed to scan pending media", "error", closeErr)
			return
		}

		if len(pending) == 0 {
			// Idle: wait, but wake up immediately on shutdown.
			select {
			case <-ctx.Done():
				return
			case <-time.After(1 * time.Minute):
			}
			continue
		}

		roots, err := s.roots.List()
		if err != nil {
			s.log.Error("media: failed to list roots", "error", err)
			return
		}
		rootMap := make(map[string]string)
		for _, r := range roots {
			rootMap[r.ID] = r.Path
		}

		tx, err := s.db.Begin()
		if err != nil {
			s.log.Error("media: begin tx failed", "error", err)
			return
		}
		stmt, err := tx.Prepare(`
			INSERT INTO media_metadata(id, date_taken, lat, lng, make, model, width, height)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				date_taken = excluded.date_taken,
				lat = excluded.lat,
				lng = excluded.lng,
				make = excluded.make,
				model = excluded.model,
				width = excluded.width,
				height = excluded.height
		`)
		if err != nil {
			s.log.Error("media: prepare upsert failed", "error", err)
			_ = tx.Rollback()
			return
		}

		for _, p := range pending {
			rootPath, ok := rootMap[p.RootID]
			if !ok {
				continue
			}
			absPath := filepath.Join(rootPath, p.Path)
			dateTaken, lat, lng, makeStr, modelStr := extractExif(absPath)
			width, height := imageDimensions(absPath)

			// We insert even if blank, so we don't keep retrying.
			if _, err := stmt.Exec(p.ID, dateTaken, lat, lng, makeStr, modelStr, width, height); err != nil {
				s.log.Debug("media: metadata upsert skipped", "path", p.Path, "error", err)
			}
		}
		if err := stmt.Close(); err != nil {
			s.log.Error("media: closing upsert statement failed", "error", err)
		}
		if err := tx.Commit(); err != nil {
			s.log.Error("media: commit failed", "error", err)
		}

		// Yield between batches; wake up immediately on shutdown.
		select {
		case <-ctx.Done():
			return
		case <-time.After(100 * time.Millisecond):
		}
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

// imageDimensions reads just enough of an image header to return its pixel
// dimensions. Supports JPEG, PNG, GIF and WebP — the formats the gallery's
// variable-height tile rows need. Returns 0,0 for anything else (HEIC, RAW…).
func imageDimensions(path string) (width, height int) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0
	}
	defer f.Close()

	head := make([]byte, 64*1024)
	n, _ := io.ReadFull(f, head)
	if n < 10 {
		return 0, 0
	}
	head = head[:n]

	// PNG: 8-byte signature, then IHDR at offset 16: width, height (BE).
	if n >= 24 && bytes.Equal(head[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}) {
		return int(binary.BigEndian.Uint32(head[16:20])), int(binary.BigEndian.Uint32(head[20:24]))
	}

	// GIF: "GIF8x" header, dimensions at offset 6 (LE 16-bit).
	if n >= 10 && bytes.HasPrefix(head, []byte("GIF8")) {
		return int(binary.LittleEndian.Uint16(head[6:8])), int(binary.LittleEndian.Uint16(head[8:10]))
	}

	// WebP: RIFF....WEBP + chunk type. Branch minima are checked per format.
	if n >= 26 && bytes.HasPrefix(head, []byte("RIFF")) && bytes.HasPrefix(head[8:12], []byte("WEBP")) {
		switch {
		case bytes.HasPrefix(head[12:16], []byte("VP8 ")): // lossy
			w := (int(head[22]) | int(head[23])<<8) & 0x3fff
			h := (int(head[24]) | int(head[25])<<8) & 0x3fff
			return w, h
		case bytes.HasPrefix(head[12:16], []byte("VP8L")) && n >= 26: // lossless
			b := head[21:26]
			w := 1 + int(b[0]) | int(b[1])<<8 | (int(b[2])&0x0f)<<16
			h := 1 + (int(b[2])&0xf0)>>4 | int(b[3])<<4 | int(b[4])<<12
			return w, h
		case bytes.HasPrefix(head[12:16], []byte("VP8X")) && n >= 30: // extended
			w := 1 + int(head[24]) | int(head[25])<<8 | int(head[26])<<16
			h := 1 + int(head[27]) | int(head[28])<<8 | int(head[29])<<16
			return w, h
		}
	}

	// JPEG: walk segments and stop at the first SOF marker (C0-CF, excluding
	// C4 DHT, C8 JPG, CC DAC) which carries height then width.
	isSOF := func(m byte) bool {
		return m >= 0xC0 && m <= 0xCF && m != 0xC4 && m != 0xC8 && m != 0xCC
	}
	i := 2
	for i+9 <= n {
		if head[i] != 0xFF {
			i++
			continue
		}
		marker := head[i+1]
		if marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7) {
			i += 2 // stand-alone markers (SOI, TEM, RSTn)
			continue
		}
		if isSOF(marker) {
			// Segment layout: FF Cx | len(2) | precision(1) | height(2) | width(2)
			return int(binary.BigEndian.Uint16(head[i+7 : i+9])), int(binary.BigEndian.Uint16(head[i+5 : i+7]))
		}
		if marker == 0xDA || marker == 0xD9 { // SOS / EOI
			break
		}
		segLen := int(binary.BigEndian.Uint16(head[i+2 : i+4]))
		if segLen < 2 {
			break
		}
		i += 2 + segLen
	}

	return 0, 0
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
	Width      int     `json:"width,omitempty"`
	Height     int     `json:"height,omitempty"`
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
		sb.WriteString(" AND fav.path IS NOT NULL")
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
		       m.lat, m.lng, m.make, m.model, m.width, m.height,
		       CASE WHEN fav.path IS NULL THEN 0 ELSE 1 END AS is_favorite`)

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
		var width, height sql.NullInt64

		if err := rows.Scan(&p.ID, &p.RootID, &p.Path, &p.Name, &p.DateTaken, &lat, &lng, &makeStr, &modelStr, &width, &height, &p.IsFavorite); err != nil {
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
		if width.Valid {
			p.Width = int(width.Int64)
		}
		if height.Valid {
			p.Height = int(height.Int64)
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

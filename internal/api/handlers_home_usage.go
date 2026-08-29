package api

import (
	"net/http"
	"strings"

	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
)

// homeUsageCategory mirrors the analytics categorization so the Home dashboard
// shows real per-category bytes instead of estimated proportions.
type homeUsageCategory struct {
	Count int64 `json:"count"`
	Size  int64 `json:"size"`
}

type homeUsageBreakdown map[string]homeUsageCategory

func homeCategoryByMime(mime, ext string) string {
	m := strings.ToLower(mime)
	switch {
	case strings.HasPrefix(m, "image/"):
		return "images"
	case strings.HasPrefix(m, "video/"):
		return "videos"
	case strings.HasPrefix(m, "audio/"):
		return "audio"
	case strings.Contains(m, "zip"), strings.Contains(m, "tar"),
		strings.Contains(m, "rar"), strings.Contains(m, "7z"), strings.Contains(m, "gzip"):
		return "archives"
	case strings.HasPrefix(m, "text/"), strings.Contains(m, "pdf"),
		strings.Contains(m, "word"), strings.Contains(m, "excel"),
		strings.Contains(m, "powerpoint"), strings.Contains(m, "document"):
		return "documents"
	}

	ext = strings.ToLower(ext)
	switch ext {
	case "jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "heic", "tiff", "svg":
		return "images"
	case "mp4", "mkv", "webm", "mov", "avi", "m4v", "ogv", "wmv", "flv":
		return "videos"
	case "mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma", "alac":
		return "audio"
	case "zip", "tar", "gz", "7z", "rar", "iso", "xz", "bz2":
		return "archives"
	case "go", "rs", "ts", "tsx", "js", "jsx", "py", "c", "cpp", "h", "java",
		"rb", "php", "sh", "yml", "yaml", "json", "toml", "sql", "html", "css", "vue", "swift", "kt":
		return "code"
	case "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv",
		"rtf", "odt", "ods", "odp", "tex", "pages", "key", "numbers":
		return "documents"
	}
	return "other"
}

// handleHomeUsage returns the storage quota across the user's accessible roots
// plus a real per-category byte breakdown from the metadata index.
func (s *Server) handleHomeUsage(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	roots, err := s.StorageRoots.UserRoots(user.ID, user.Role == "admin")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list roots", middleware.GetRequestID(r.Context()))
		return
	}

	// Build the per-root allow-list once. The breakdown is computed from the
	// search_index, which is global; without this filter a user with access
	// to root A would see byte counts for every other root on the server.
	rootIDs := make([]string, 0, len(roots))
	enabledIDs := make(map[string]struct{}, len(roots))
	for _, root := range roots {
		rootIDs = append(rootIDs, root.ID)
		if root.Enabled {
			enabledIDs[root.ID] = struct{}{}
		}
	}
	if len(rootIDs) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"total":      int64(0),
			"available":  int64(0),
			"used":       int64(0),
			"file_count": int64(0),
			"breakdown":  homeUsageBreakdown{},
		})
		return
	}

	var aggTotal, aggAvailable, aggUsed int64
	for _, root := range roots {
		if !root.Enabled {
			continue
		}
		prov := s.StorageRoots.ProviderFor(root)
		if prov == nil {
			continue
		}
		q, err := prov.GetQuota()
		if err != nil {
			continue
		}
		aggTotal += q.Total
		aggAvailable += q.Available
		aggUsed += q.Used
	}

	// Build the placeholder list dynamically so the same query works with any
	// number of roots, including admins who see them all.
	placeholders := make([]string, len(rootIDs))
	args := make([]any, len(rootIDs))
	for i, id := range rootIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	breakdownSQL := `SELECT mime, ext, COUNT(*), COALESCE(SUM(size), 0)
		FROM search_index
		WHERE is_dir = 0 AND root_id IN (` + strings.Join(placeholders, ",") + `)
		GROUP BY mime, ext`

	breakdown := homeUsageBreakdown{}
	var fileCount int64
	rows, err := s.DB.Query(breakdownSQL, args...)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var mime, ext string
			var count, size int64
			if err := rows.Scan(&mime, &ext, &count, &size); err != nil {
				continue
			}
			cat := homeCategoryByMime(mime, ext)
			cur := breakdown[cat]
			cur.Count += count
			cur.Size += size
			breakdown[cat] = cur
			fileCount += count
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"total":      aggTotal,
		"available":  aggAvailable,
		"used":       aggUsed,
		"file_count": fileCount,
		"breakdown":  breakdown,
	})
}

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

	breakdown := homeUsageBreakdown{}
	var fileCount int64
	rows, err := s.DB.Query(`SELECT mime, ext, COUNT(*), COALESCE(SUM(size), 0) FROM search_index WHERE is_dir = 0 GROUP BY mime, ext`)
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
		"total":       aggTotal,
		"available":   aggAvailable,
		"used":        aggUsed,
		"file_count":  fileCount,
		"breakdown":   breakdown,
	})
}

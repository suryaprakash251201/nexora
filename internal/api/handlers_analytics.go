package api

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"sort"
	"strings"

	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/storage"
)

// handleFindDuplicates implements the Optimized Fast-Match algorithm.
func (s *Server) handleFindDuplicates(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	if rootID == "" {
		writeError(w, http.StatusBadRequest, "missing_root", "Missing root parameter", "")
		return
	}

	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	provider := acc.provider

	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", "")
		return
	}

	// 1. Walk the entire root and group by exact size.
	sizeMap := make(map[int64][]storage.FileInfo)
	queue := []string{""} // root path

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]

		items, err := provider.List(curr)
		if err != nil {
			continue
		}

		for _, item := range items {
			if item.IsDir {
				queue = append(queue, item.Path)
			} else {
				if item.Size > 0 {
					sizeMap[item.Size] = append(sizeMap[item.Size], item)
				}
			}
		}
	}

	// 2. For sizes with >1 file, compute partial hash (first 4KB).
	partialHashMap := make(map[string][]storage.FileInfo)
	for _, files := range sizeMap {
		if len(files) < 2 {
			continue
		}
		for _, f := range files {
			hash, err := s.computePartialHash(provider, f.Path)
			if err != nil {
				continue
			}
			partialHashMap[hash] = append(partialHashMap[hash], f)
		}
	}

	// 3. For partial hashes with >1 file, compute full SHA-256.
	var duplicates [][]map[string]any
	for _, files := range partialHashMap {
		if len(files) < 2 {
			continue
		}
		fullHashMap := make(map[string][]storage.FileInfo)
		for _, f := range files {
			hash, err := s.computeFullHash(provider, f.Path)
			if err != nil {
				continue
			}
			fullHashMap[hash] = append(fullHashMap[hash], f)
		}

		// 4. Collect identical files
		for _, dupes := range fullHashMap {
			if len(dupes) > 1 {
				// Convert to map and attach tags
				var dupesMap []map[string]any
				for _, fi := range dupes {
					dupesMap = append(dupesMap, map[string]any{
						"name":     fi.Name,
						"path":     fi.Path,
						"size":     fi.Size,
						"is_dir":   fi.IsDir,
						"modified": fi.Modified,
						"mime":     fi.Mime,
						"root_id":  rootID,
					})
				}
				attachTags(s.DB, dupesMap, rootID, user.ID)
				duplicates = append(duplicates, dupesMap)
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"duplicates": duplicates,
	})
}

func (s *Server) computePartialHash(provider storage.StorageProvider, path string) (string, error) {
	rc, err := provider.Read(path)
	if err != nil {
		return "", err
	}
	defer rc.Close()

	hash := sha256.New()
	// Read up to 4KB
	if _, err := io.CopyN(hash, rc, 4096); err != nil && err != io.EOF {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func (s *Server) computeFullHash(provider storage.StorageProvider, path string) (string, error) {
	rc, err := provider.Read(path)
	if err != nil {
		return "", err
	}
	defer rc.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, rc); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

type StatsResponse struct {
	TotalFiles int64                     `json:"total_files"`
	TotalSize  int64                     `json:"total_size"`
	Breakdown  map[string]CategoryStat   `json:"breakdown"`
	Largest    []map[string]any          `json:"largest"`
}

type CategoryStat struct {
	Count int64 `json:"count"`
	Size  int64 `json:"size"`
}

// handleStorageStats computes analytics for a root.
func (s *Server) handleStorageStats(w http.ResponseWriter, r *http.Request) {
	rootID := r.URL.Query().Get("root")
	if rootID == "" {
		writeError(w, http.StatusBadRequest, "missing_root", "Missing root parameter", "")
		return
	}

	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	provider := acc.provider

	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Unauthorized", "")
		return
	}

	stats := StatsResponse{
		Breakdown: make(map[string]CategoryStat),
	}

	// Initialize categories
	categories := []string{"images", "videos", "audio", "documents", "archives", "code", "other"}
	for _, c := range categories {
		stats.Breakdown[c] = CategoryStat{}
	}

	var allFiles []storage.FileInfo
	queue := []string{""}

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]

		items, err := provider.List(curr)
		if err != nil {
			continue
		}

		for _, item := range items {
			if item.IsDir {
				queue = append(queue, item.Path)
				continue
			}

			item.RootID = rootID
			allFiles = append(allFiles, item)
			stats.TotalFiles++
			stats.TotalSize += item.Size

			cat := determineCategory(item)
			stat := stats.Breakdown[cat]
			stat.Count++
			stat.Size += item.Size
			stats.Breakdown[cat] = stat
		}
	}

	// Sort by size descending to get top 10 largest
	sort.Slice(allFiles, func(i, j int) bool {
		return allFiles[i].Size > allFiles[j].Size
	})

	if len(allFiles) > 10 {
		allFiles = allFiles[:10]
	}

	for _, fi := range allFiles {
		stats.Largest = append(stats.Largest, map[string]any{
			"name":     fi.Name,
			"path":     fi.Path,
			"size":     fi.Size,
			"is_dir":   fi.IsDir,
			"modified": fi.Modified,
			"mime":     fi.Mime,
			"root_id":  rootID,
		})
	}

	// Attach tags to largest files
	if len(stats.Largest) > 0 {
		attachTags(s.DB, stats.Largest, rootID, user.ID)
	}

	writeJSON(w, http.StatusOK, stats)
}

func determineCategory(fi storage.FileInfo) string {
	mime := fi.Mime
	ext := strings.ToLower(fi.Name)

	if strings.HasPrefix(mime, "image/") {
		return "images"
	}
	if strings.HasPrefix(mime, "video/") {
		return "videos"
	}
	if strings.HasPrefix(mime, "audio/") {
		return "audio"
	}

	if strings.Contains(mime, "text/") || strings.Contains(mime, "pdf") || strings.Contains(mime, "word") || strings.Contains(mime, "excel") || strings.Contains(mime, "powerpoint") || strings.Contains(mime, "document") {
		// Differentiate code vs normal docs
		if isCodeFile(ext) {
			return "code"
		}
		return "documents"
	}

	if strings.Contains(mime, "zip") || strings.Contains(mime, "tar") || strings.Contains(mime, "rar") || strings.Contains(mime, "7z") || strings.Contains(mime, "gzip") {
		return "archives"
	}

	// Fallbacks based on common extensions
	if isArchiveFile(ext) {
		return "archives"
	}
	if isCodeFile(ext) {
		return "code"
	}

	return "other"
}

func isCodeFile(name string) bool {
	exts := []string{".go", ".js", ".ts", ".jsx", ".tsx", ".py", ".rb", ".php", ".java", ".c", ".cpp", ".cs", ".html", ".css", ".json", ".xml", ".yaml", ".yml", ".sh", ".bash"}
	for _, e := range exts {
		if strings.HasSuffix(name, e) {
			return true
		}
	}
	return false
}

func isArchiveFile(name string) bool {
	exts := []string{".zip", ".tar", ".gz", ".7z", ".rar", ".iso"}
	for _, e := range exts {
		if strings.HasSuffix(name, e) {
			return true
		}
	}
	return false
}

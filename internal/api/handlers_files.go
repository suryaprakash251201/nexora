package api

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"syscall"

	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/events"
	"github.com/nexora/nexora/internal/logger"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
)

// access bundles a resolved root and its provider after permission checks.
type access struct {
	root     storage.Root
	provider storage.StorageProvider
}

// resolveAccess validates the request user can access rootID with the required
// permission. write=true requires write access and a non-read-only root.

func (s *Server) resolveAccess(r *http.Request, rootID string, write bool) (access, error) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		return access{}, errUnauthorized
	}
	root, ok, err := s.StorageRoots.Get(rootID)
	if err != nil {
		return access{}, err
	}
	if !ok || !root.Enabled {
		return access{}, storage.ErrNotFound
	}
	perm, allowed, err := s.StorageRoots.UserPermission(user.ID, user.Role == "admin", rootID)
	if err != nil {
		return access{}, err
	}
	if !allowed {
		return access{}, storage.ErrPermission
	}
	if write && (root.ReadOnly || perm != storage.PermWrite) {
		return access{}, storage.ErrPermission
	}
	return access{root: root, provider: s.StorageRoots.ProviderFor(root)}, nil
}

func queryParam(r *http.Request, key, def string) string {
	if v := r.URL.Query().Get(key); v != "" {
		return v
	}
	return def
}

func (s *Server) handleListFiles(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel := queryParam(r, "path", "")
	rel, err := storage.CleanRelative(rel)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	items, err := acc.provider.List(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	// Hide the system trash directory from user-facing listings.
	filtered := items[:0]
	for _, it := range items {
		if it.Name == ".nexora-trash" {
			continue
		}
		filtered = append(filtered, it)
	}
	items = filtered
	items = sortFiles(items, queryParam(r, "sort", "name"), queryParam(r, "order", "asc"), queryParam(r, "dirs_first", "true") == "true")

	total := len(items)

	// Pagination: offset + limit with cursor-like semantics.
	offset, _ := strconv.Atoi(queryParam(r, "offset", "0"))
	limit, _ := strconv.Atoi(queryParam(r, "limit", "500"))
	if limit <= 0 || limit > 5000 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}
	if offset >= total {
		writeJSON(w, http.StatusOK, map[string]any{
			"root":     rootID,
			"path":     rel,
			"items":    []map[string]any{},
			"total":    total,
			"offset":   offset,
			"limit":    limit,
			"has_more": false,
		})
		return
	}
	end := offset + limit
	if end > total {
		end = total
	}
	paged := items[offset:end]

	out := make([]map[string]any, 0, len(paged))
	for _, it := range paged {
		out = append(out, fileToMap(it, rootID))
	}

	// Attach tags
	user, _ := auth.UserFromContext(r.Context())
	attachTags(s.DB, s.Log, out, rootID, user.ID)

	hasMore := end < total
	writeJSON(w, http.StatusOK, map[string]any{
		"root":     rootID,
		"path":     rel,
		"items":    out,
		"total":    total,
		"offset":   offset,
		"limit":    limit,
		"has_more": hasMore,
	})
}

// attachTags hydrates a file-list response with the requesting user's
// tags. Phase 3 / P2-2: query errors are now logged at warn level
// (previously silent), so a missing or botched-migrated table surfaces
// in the log stream instead of leaving the user staring at a "no tags"
// UI.
//
// `log` may be nil (tests), in which case errors are silently dropped.
func attachTags(db *database.DB, log *logger.Logger, files []map[string]any, rootID, userID string) {
	if len(files) == 0 {
		return
	}

	// Build a map of path -> tags
	tagsByPath := make(map[string][]Tag)

	rows, err := db.Query(`
		SELECT ft.path, t.id, t.name, t.color
		FROM file_tags ft
		JOIN tags t ON ft.tag_id = t.id
		WHERE ft.root_id = ? AND t.user_id = ?
	`, rootID, userID)
	if err != nil {
		if log != nil {
			log.Warn("attachTags: query failed", "error", err.Error(), "root", rootID)
		}
	} else {
		defer rows.Close()
		for rows.Next() {
			var path, id, name, color string
			if err := rows.Scan(&path, &id, &name, &color); err == nil {
				tagsByPath[path] = append(tagsByPath[path], Tag{
					ID:    id,
					Name:  name,
					Color: color,
				})
			}
		}
	}

	for _, fileMap := range files {
		path, _ := fileMap["path"].(string)
		if tags, ok := tagsByPath[path]; ok {
			fileMap["tags"] = tags
		} else {
			fileMap["tags"] = []Tag{}
		}
	}
}

func sortFiles(items []storage.FileInfo, sortBy, order string, dirsFirst bool) []storage.FileInfo {
	desc := order == "desc"
	// Folder-first pass.
	if dirsFirst {
		var dirs, files []storage.FileInfo
		for _, it := range items {
			if it.IsDir {
				dirs = append(dirs, it)
			} else {
				files = append(files, it)
			}
		}
		sortSlice(dirs, sortBy, desc)
		sortSlice(files, sortBy, desc)
		return append(dirs, files...)
	}
	sortSlice(items, sortBy, desc)
	return items
}

func sortSlice(items []storage.FileInfo, sortBy string, desc bool) {
	less := func(i, j int) bool {
		a, b := items[i], items[j]
		switch sortBy {
		case "modified":
			if a.Modified.Equal(b.Modified) {
				return a.Name < b.Name
			}
			return a.Modified.Before(b.Modified)
		case "size":
			if a.Size == b.Size {
				return a.Name < b.Name
			}
			return a.Size < b.Size
		case "type":
			if storage.Ext(a.Name) == storage.Ext(b.Name) {
				return a.Name < b.Name
			}
			return storage.Ext(a.Name) < storage.Ext(b.Name)
		default: // name
			return strings.ToLower(a.Name) < strings.ToLower(b.Name)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return less(i, j)
	})
	if desc {
		for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
			items[i], items[j] = items[j], items[i]
		}
	}
}

func (s *Server) handleStatFile(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	info, err := acc.provider.Stat(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, fileToMap(info, rootID))
}

func (s *Server) handleCreateDir(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root string `json:"root"`
		Path string `json:"path"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	rel, err := storage.CleanRelative(req.Path)
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "directory name/path is invalid", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, req.Root, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	if err := acc.provider.CreateDirectory(rel); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	s.indexUpsert(req.Root, acc.provider, rel)
	s.audit(r, "create_directory", rel, "")
	s.recordRecent(r, req.Root, rel, "add")
	s.emit(events.EventDirCreated, r, req.Root, rel, 0)
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "path": rel})
}

func (s *Server) writeAccessError(w http.ResponseWriter, r *http.Request, err error) {
	rid := middleware.GetRequestID(r.Context())
	switch err {
	case errUnauthorized:
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", rid)
	case storage.ErrPermission:
		writeError(w, http.StatusForbidden, "forbidden", "You do not have access to this resource", rid)
	case storage.ErrNotFound:
		writeError(w, http.StatusNotFound, "not_found", "Resource not found", rid)
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "operation failed", rid)
	}
}

func (s *Server) writeProviderError(w http.ResponseWriter, r *http.Request, err error) {
	rid := middleware.GetRequestID(r.Context())
	// errors.Is (not ==) so WRAPPED failures — e.g. *fs.PathError wrapping
	// EACCES from an OpenFile inside a directory owned by another user — map
	// to their real cause instead of the opaque "Storage operation failed" 500.
	switch {
	case errors.Is(err, storage.ErrNotFound):
		rootID := queryParam(r, "root", "")
		rel := queryParam(r, "path", "")
		s.Log.Error("file not found", "error", err.Error(), "root", rootID, "path", rel, "request_id", rid)
		writeError(w, http.StatusNotFound, "not_found", "File or directory not found", rid)
	case errors.Is(err, storage.ErrPermission), errors.Is(err, os.ErrPermission), errors.Is(err, fs.ErrPermission):
		writeError(w, http.StatusForbidden, "permission_denied", "Filesystem permission denied (check storage directory ownership)", rid)
	case errors.Is(err, syscall.EROFS):
		writeError(w, http.StatusForbidden, "read_only", "Storage is mounted read-only", rid)
	case errors.Is(err, syscall.ENOSPC):
		s.Log.Error("storage full", "error", err.Error(), "request_id", rid)
		writeError(w, http.StatusInsufficientStorage, "storage_full", "No space left on the storage device", rid)
	case errors.Is(err, storage.ErrInvalidPath), errors.Is(err, storage.ErrTraversal):
		writeError(w, http.StatusBadRequest, "invalid_path", "Invalid path", rid)
	case errors.Is(err, storage.ErrExists):
		writeError(w, http.StatusConflict, "exists", "Target already exists", rid)
	default:
		rootID := queryParam(r, "root", "")
		rel := queryParam(r, "path", "")
		s.Log.Error("storage error", "error", err.Error(), "error_type", fmt.Sprintf("%T", err), "root", rootID, "path", rel, "request_id", rid)
		writeError(w, http.StatusInternalServerError, "storage_error", "Storage operation failed", rid)
	}
}

func (s *Server) audit(r *http.Request, action, target, detail string) {
	if user, ok := auth.UserFromContext(r.Context()); ok {
		_ = s.Audit.Record(user.ID, action, target, detail, clientIP(r))
	}
}

// emit publishes a file event to the in-process event bus (webhooks). It is a
// no-op when the bus is not wired (nil).
func (s *Server) emit(typ events.EventType, r *http.Request, rootID, path string, size int64) {
	if s.Events == nil {
		return
	}
	user, _ := auth.UserFromContext(r.Context())
	s.Events.Emit(events.Event{
		Type:   typ,
		UserID: user.ID,
		RootID: rootID,
		Path:   path,
		Size:   size,
	})
}

func fileToMap(f storage.FileInfo, rootID string) map[string]any {
	return map[string]any{
		"name":      f.Name,
		"path":      f.Path,
		"size":      f.Size,
		"is_dir":    f.IsDir,
		"modified":  f.Modified.UTC().Format("2006-01-02T15:04:05Z"),
		"mime":      f.Mime,
		"root_id":   rootID,
		"extension": storage.Ext(f.Name),
	}
}

var errUnauthorized = fmt.Errorf("unauthorized")

func urlEncode(name string) string { return url.QueryEscape(name) }

// indexUpsert refreshes the search index for a single path (best effort).

func (s *Server) indexUpsert(rootID string, provider storage.StorageProvider, rel string) {
	if s.Search == nil {
		return
	}
	if info, err := provider.Stat(rel); err == nil {
		s.Search.Upsert(rootID, info)
	}
}

// indexRemove removes a path (and its subtree) from the search index.

func (s *Server) indexRemove(rootID, rel string) {
	if s.Search == nil {
		return
	}
	s.Search.Remove(rootID, rel)
}

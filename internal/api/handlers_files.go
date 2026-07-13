package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
	"github.com/nexora/nexora/internal/util"
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
	items = sortFiles(items, queryParam(r, "sort", "name"), queryParam(r, "order", "asc"), queryParam(r, "dirs_first", "true") == "true")

	// Apply cursor-free offset pagination for very large directories.
	limit, _ := strconv.Atoi(queryParam(r, "limit", "1000"))
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	if limit < len(items) {
		items = items[:limit]
	}

	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, fileToMap(it, rootID))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"root": rootID,
		"path": rel,
		"items": out,
	})
}

func sortFiles(items []storage.FileInfo, sort, order string, dirsFirst bool) []storage.FileInfo {
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
		sortSlice(dirs, sort, desc)
		sortSlice(files, sort, desc)
		return append(dirs, files...)
	}
	sortSlice(items, sort, desc)
	return items
}

func sortSlice(items []storage.FileInfo, sort string, desc bool) {
	less := func(i, j int) bool {
		a, b := items[i], items[j]
		switch sort {
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
	// Simple insertion sort (small N, allocations cheap).
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && less(j, j-1); j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
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
	s.audit(r, "create_directory", rel, "")
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "path": rel})
}

func (s *Server) handleRename(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root string `json:"root"`
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	rel, err := storage.CleanRelative(req.Path)
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid source path", middleware.GetRequestID(r.Context()))
		return
	}
	newName := strings.TrimSpace(req.Name)
	if newName == "" || strings.ContainsAny(newName, "/\\") {
		writeError(w, http.StatusBadRequest, "invalid_name", "name must not be empty or contain slashes", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, req.Root, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	parent := path.Dir(rel)
	if parent == "." {
		parent = ""
	}
	dest := parent
	if dest != "" {
		dest += "/"
	}
	dest += newName
	if _, err := storage.CleanRelative(dest); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	if err := acc.provider.Move(rel, dest); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	s.audit(r, "rename", rel+" -> "+dest, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": dest})
}

func (s *Server) handleMove(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root        string `json:"root"`
		Source      string `json:"source"`
		Destination string `json:"destination"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	src, err := storage.CleanRelative(req.Source)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid source", middleware.GetRequestID(r.Context()))
		return
	}
	dst, err := storage.CleanRelative(req.Destination)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid destination", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, req.Root, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	if err := acc.provider.Move(src, dst); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	s.audit(r, "move", src+" -> "+dst, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleCopy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root        string `json:"root"`
		Source      string `json:"source"`
		Destination string `json:"destination"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	src, err := storage.CleanRelative(req.Source)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid source", middleware.GetRequestID(r.Context()))
		return
	}
	dst, err := storage.CleanRelative(req.Destination)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid destination", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, req.Root, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	if err := acc.provider.Copy(src, dst); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	s.audit(r, "copy", src+" -> "+dst, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	permanent := queryParam(r, "permanent", "0") == "1"

	user, _ := auth.UserFromContext(r.Context())
	if permanent {
		if err := acc.provider.Delete(rel); err != nil {
			s.writeProviderError(w, r, err)
			return
		}
		s.audit(r, "delete_permanent", rel, "")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	// Move into per-root trash.
	info, err := acc.provider.Stat(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	trashName := util.NewID("", 12) + "__" + info.Name
	trashRel := ".nexora-trash/" + trashName
	if err := acc.provider.Move(rel, trashRel); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	_, err = s.DB.Exec(
		`INSERT INTO trash(id, user_id, root_id, original_path, trash_path, name, size, is_dir, deleted_at)
		 VALUES(?,?,?,?,?,?,?,?,?)`,
		util.NewID("tr_", 12), user.ID, rootID, rel, trashRel, info.Name, info.Size, boolToInt(info.IsDir), util.NowUTC())
	if err != nil {
		// Best-effort: try to undo the move.
		_ = acc.provider.Move(trashRel, rel)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not record trash entry", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "delete", rel, "moved to trash")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "trashed": true})
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	target := queryParam(r, "path", "")
	target, err := storage.CleanRelative(target)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}

	if err := r.ParseMultipartForm(s.Cfg.MaxUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "upload_too_large", "request body exceeds max upload size", middleware.GetRequestID(r.Context()))
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		// Single-file field fallback.
		if f, ok := r.MultipartForm.File["file"]; ok {
			files = f
		}
	}
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "no_files", "no files provided", middleware.GetRequestID(r.Context()))
		return
	}

	var uploaded []string
	for _, fh := range files {
		name := filepath.Base(fh.Filename)
		if name == "" || strings.ContainsAny(name, "/\\") {
			writeError(w, http.StatusBadRequest, "invalid_name", "invalid file name", middleware.GetRequestID(r.Context()))
			return
		}
		dest := target
		if dest != "" {
			dest += "/"
		}
		dest += name
		if _, err := storage.CleanRelative(dest); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_path", err.Error(), middleware.GetRequestID(r.Context()))
			return
		}
		if err := s.checkAllowedMime(fh.Filename, fh.Header.Get("Content-Type")); err != nil {
			writeError(w, http.StatusBadRequest, "mime_not_allowed", err.Error(), middleware.GetRequestID(r.Context()))
			return
		}
		src, err := fh.Open()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "could not read upload", middleware.GetRequestID(r.Context()))
			return
		}
		if err := acc.provider.Write(dest, src, fh.Size); err != nil {
			src.Close()
			s.writeProviderError(w, r, err)
			return
		}
		src.Close()
		uploaded = append(uploaded, dest)
		s.audit(r, "upload", dest, "")
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "uploaded": uploaded})
}

func (s *Server) checkAllowedMime(filename, contentType string) error {
	if len(s.Cfg.AllowedMimeTypes) == 0 {
		return nil
	}
	mime := storage.MimeFor(filename, false)
	for _, allowed := range s.Cfg.AllowedMimeTypes {
		if allowed == mime || strings.HasPrefix(mime, strings.TrimSuffix(allowed, "*")+"") {
			return nil
		}
		if allowed == "*/*" || allowed == mime {
			return nil
		}
	}
	return os.ErrPermission
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
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
	if info.IsDir {
		writeError(w, http.StatusBadRequest, "is_directory", "use archive download for directories", middleware.GetRequestID(r.Context()))
		return
	}
	rc, err := acc.provider.Read(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", storage.MimeFor(info.Name, false))
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+ urlEncode(info.Name))
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size, 10))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, rc)
	s.audit(r, "download", rel, "")
}

func (s *Server) handleRaw(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
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
	if info.IsDir {
		writeError(w, http.StatusBadRequest, "is_directory", "cannot preview a directory", middleware.GetRequestID(r.Context()))
		return
	}
	total := info.Size
	start, end := parseRange(r.Header.Get("Range"), total)
	rc, _, err := acc.provider.OpenRange(rel, start, end)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	defer rc.Close()

	mime := storage.MimeFor(info.Name, false)
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Accept-Ranges", "bytes")
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+ urlEncode(info.Name))
	} else {
		w.Header().Set("Content-Disposition", "inline; filename*=UTF-8''"+ urlEncode(info.Name))
	}

	if start == 0 && end == total-1 {
		w.Header().Set("Content-Length", strconv.FormatInt(total, 10))
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, rc)
		return
	}
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, total))
	w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
	w.WriteHeader(http.StatusPartialContent)
	_, _ = io.Copy(w, rc)
}

func parseRange(rangeHeader string, total int64) (int64, int64) {
	start, end := int64(0), total-1
	if rangeHeader == "" || !strings.HasPrefix(rangeHeader, "bytes=") {
		return start, end
	}
	spec := strings.TrimPrefix(rangeHeader, "bytes=")
	parts := strings.SplitN(spec, "-", 2)
	if len(parts) != 2 {
		return start, end
	}
	if parts[0] != "" {
		if v, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
			start = v
		}
	}
	if parts[1] != "" {
		if v, err := strconv.ParseInt(parts[1], 10, 64); err == nil {
			end = v
		}
	}
	if start < 0 {
		start = 0
	}
	if end >= total {
		end = total - 1
	}
	if start > end {
		start, end = 0, total-1
	}
	return start, end
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
	switch err {
	case storage.ErrNotFound:
		writeError(w, http.StatusNotFound, "not_found", "File or directory not found", rid)
	case storage.ErrPermission:
		writeError(w, http.StatusForbidden, "forbidden", "Operation not permitted (read-only or no access)", rid)
	case storage.ErrInvalidPath, storage.ErrTraversal:
		writeError(w, http.StatusBadRequest, "invalid_path", "Invalid path", rid)
	case storage.ErrExists:
		writeError(w, http.StatusConflict, "exists", "Target already exists", rid)
	default:
		s.Log.Error("storage error", "error", err)
		writeError(w, http.StatusInternalServerError, "storage_error", "Storage operation failed", rid)
	}
}

func (s *Server) audit(r *http.Request, action, target, detail string) {
	if user, ok := auth.UserFromContext(r.Context()); ok {
		_ = s.Audit.Record(user.ID, action, target, detail, clientIP(r))
	}
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

func (s *Server) handleCreateFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root    string `json:"root"`
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	rel, err := storage.CleanRelative(req.Path)
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid file path", middleware.GetRequestID(r.Context()))
		return
	}
	if storage.Ext(rel) == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "a file extension is required", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, req.Root, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	if err := acc.provider.Write(rel, strings.NewReader(req.Content), int64(len(req.Content))); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	s.audit(r, "create_file", rel, "")
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "path": rel})
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// errUnauthorized signals a missing session in resolveAccess.
var errUnauthorized = fmt.Errorf("unauthorized")

func urlEncode(name string) string { return url.QueryEscape(name) }

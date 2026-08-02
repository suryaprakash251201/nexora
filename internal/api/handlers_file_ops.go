package api

import (
	"encoding/json"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
	"github.com/nexora/nexora/internal/util"
	"net/http"
	"path"
	"strings"
)

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
	s.indexRemove(req.Root, rel)
	s.indexUpsert(req.Root, acc.provider, dest)
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
	s.indexRemove(req.Root, src)
	s.indexUpsert(req.Root, acc.provider, dst)
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
	s.indexUpsert(req.Root, acc.provider, dst)
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
		s.indexRemove(rootID, rel)
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
	s.indexRemove(rootID, rel)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "trashed": true})
}

func (s *Server) handleCreateFile(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 10 MB limit
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
	if err := s.checkAllowedMime(rel, ""); err != nil {
		writeError(w, http.StatusBadRequest, "mime_not_allowed", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	if err := acc.provider.Write(rel, strings.NewReader(req.Content), int64(len(req.Content))); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	s.indexUpsert(req.Root, acc.provider, rel)
	s.audit(r, "create_file", rel, "")
	s.recordRecent(r, req.Root, rel, "add")
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

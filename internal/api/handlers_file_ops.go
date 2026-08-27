package api

import (
	"encoding/json"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/events"
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
	// Folder-into-self guard: renaming a directory to its own name is a
	// no-op, and renaming a directory to a name inside itself would create
	// an unreachable tree (the entry is still the source until the move
	// completes). Note: rename can only target the same parent, so the
	// "dest is descendant of src" case is only possible when src is a
	// directory.
	if rel != dest && storage.IsAncestor(rel, dest) {
		writeError(w, http.StatusBadRequest, "invalid_destination",
			"cannot rename a directory into itself", middleware.GetRequestID(r.Context()))
		return
	}
	if err := acc.provider.Move(rel, dest); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	s.indexRemove(req.Root, rel)
	s.indexUpsert(req.Root, acc.provider, dest)
	// A rename changes the version key (root_id, path): drop history for
	// the old path so snapshot bytes in the provider don't leak.
	s.versionsStore().PurgeForPath(req.Root, rel, acc.provider)
	s.audit(r, "rename", rel+" -> "+dest, "")
	s.emit(events.EventFileRenamed, r, req.Root, dest, 0)
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
	// Folder-into-self guard: refuse to move a directory into itself or any
	// of its descendants. Copy is checked below with the same predicate.
	if src != dst && storage.IsAncestor(src, dst) {
		writeError(w, http.StatusBadRequest, "invalid_destination",
			"cannot move a directory into itself", middleware.GetRequestID(r.Context()))
		return
	}
	if err := acc.provider.Move(src, dst); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	s.indexRemove(req.Root, src)
	s.indexUpsert(req.Root, acc.provider, dst)
	// Moving a file (or folder) changes every (root_id, path) version key
	// under the source; purge so snapshot bytes don't leak in the provider.
	store := s.versionsStore()
	if info, ierr := acc.provider.Stat(dst); ierr == nil && info.IsDir {
		store.PurgeForPrefix(req.Root, src, acc.provider)
	} else {
		store.PurgeForPath(req.Root, src, acc.provider)
	}
	s.audit(r, "move", src+" -> "+dst, "")
	s.emit(events.EventFileMoved, r, req.Root, dst, 0)
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
	// Folder-into-self guard: copying a directory into itself would create
	// a self-referencing tree; copying into a descendant would either
	// double-count files (shallow copy) or recurse forever (deep copy).
	if src != dst && storage.IsAncestor(src, dst) {
		writeError(w, http.StatusBadRequest, "invalid_destination",
			"cannot copy a directory into itself", middleware.GetRequestID(r.Context()))
		return
	}
	if err := acc.provider.Copy(src, dst); err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	s.indexUpsert(req.Root, acc.provider, dst)
	s.audit(r, "copy", src+" -> "+dst, "")
	s.emit(events.EventFileCopied, r, req.Root, dst, 0)
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
		s.emit(events.EventFileDeleted, r, rootID, rel, 0)
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
		// Best-effort: try to undo the move. Phase 3 / P2-9: the undo
		// failure is now logged and audited so an orphan file in the
		// trash dir with no DB row is not invisible. The old code
		// dropped the error on the floor.
		if undoErr := acc.provider.Move(trashRel, rel); undoErr != nil {
			if s.Log != nil {
				s.Log.Error("delete: file moved to trash but DB row insert failed AND undo failed \u2014 orphan in trash dir",
					"path", rel, "trash_path", trashRel,
					"db_error", err.Error(),
					"undo_error", undoErr.Error(),
				)
			}
			_ = s.Audit.Record(user.ID, "trash_orphan", rel,
				"file moved to trash; DB row insert failed: "+err.Error()+
					"; undo failed: "+undoErr.Error(), clientIP(r))
		} else if s.Log != nil {
			s.Log.Warn("delete: file moved back to original after trash-record failure",
				"path", rel, "db_error", err.Error())
		}
		writeError(w, http.StatusInternalServerError, "internal_error", "could not record trash entry", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "delete", rel, "moved to trash")
	s.indexRemove(rootID, rel)
	s.emit(events.EventFileDeleted, r, rootID, rel, info.Size)
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
	s.emit(events.EventFileCreated, r, req.Root, rel, int64(len(req.Content)))
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

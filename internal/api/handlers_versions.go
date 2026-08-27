package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/events"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/versions"
)

// versionsStore returns the configured versions store, building one on
// the fly the first time it's needed. The store is stateless after
// construction (no goroutines, no caches) so a fresh instance per call
// is fine and avoids the package holding a long-lived reference.
func (s *Server) versionsStore() *versions.Store {
	return &versions.Store{
		DB:      s.DB,
		Config:  s.versionConfig(),
		DataDir: s.Cfg.DataDir,
	}
}

func (s *Server) versionConfig() versions.Config {
	return versions.Config{
		MaxPerFile:    s.Cfg.VersionMaxPerFile,
		MaxFileSize:   s.Cfg.VersionMaxFileSize,
		MaxTotalAge:   s.Cfg.VersionMaxTotalAge,
		MaxTotalBytes: s.Cfg.VersionMaxTotalBytes,
	}
}

// handleListVersions returns every snapshot for a file, newest first.
// The "current" live file is synthesised as version 0 and prepended so
// the UI can render a single, ordered list without a second roundtrip.
func (s *Server) handleListVersions(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	rootID := r.URL.Query().Get("root")
	rel := r.URL.Query().Get("path")
	_, rel, info, err := s.requireFile(r, rootID, rel, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	_ = user // scoping is enforced via the per-file access check above

	store := s.versionsStore()
	rows := store.List(rootID, rel)
	out := make([]versionDTO, 0, len(rows)+1)
	// "Current" entry: the live file as it is right now.
	out = append(out, versionDTO{
		ID:        "current",
		RootID:    rootID,
		Path:      rel,
		Version:   0,
		Size:      info.Size,
		Checksum:  "",
		Note:      "Current",
		Auto:      false,
		CreatedAt: info.Modified.UTC().Format(time.RFC3339),
		IsCurrent: true,
	})
	for _, v := range rows {
		out = append(out, versionToDTO(v))
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": out})
}

// handleCreateVersion snapshots the live file at (root, path).
// Body: { root, path, note? }. The user can also pass auto=true to
// mark the snapshot as automatic; the server uses this for the
// auto-on-overwrite path so the UI can render it differently.
func (s *Server) handleCreateVersion(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	var req struct {
		Root string `json:"root"`
		Path string `json:"path"`
		Note string `json:"note"`
		Auto bool   `json:"auto"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	acc, rel, _, err := s.requireFile(r, req.Root, req.Path, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}

	store := s.versionsStore()
	v, err := store.Create(versions.CreateInput{
		UserID: user.ID,
		RootID: req.Root,
		Path:   rel,
		Note:   req.Note,
		Auto:   req.Auto,
	}, acc.provider)
	if err != nil {
		if err == versions.ErrTooLarge {
			writeError(w, http.StatusRequestEntityTooLarge, "file_too_large",
				"file is larger than the configured version max-file-size", middleware.GetRequestID(r.Context()))
			return
		}
		s.writeProviderError(w, r, err)
		return
	}

	s.audit(r, "version_create", rel, fmt.Sprintf("version=%d", v.Version))
	s.emit(events.EventVersionCreated, r, req.Root, rel, v.Size)
	writeJSON(w, http.StatusCreated, map[string]any{"version": versionToDTO(*v)})
}

// handleDownloadVersion streams a version's bytes to the client with
// the original file name. Useful when the user wants the old version
// outside of restoring (e.g. emailing it to someone).
func (s *Server) handleDownloadVersion(w http.ResponseWriter, r *http.Request) {
	versionID := chi.URLParam(r, "id")
	store := s.versionsStore()
	v, err := store.Get(versionID)
	if err != nil {
		if err == versions.ErrNotFound {
			writeError(w, http.StatusNotFound, "not_found", "version not found", middleware.GetRequestID(r.Context()))
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	acc, _, _, err := s.requireFile(r, v.RootID, v.Path, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	rc, err := store.Open(v, acc.provider)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	defer rc.Close()

	// Use the original file's name so the browser saves it as
	// "report.pdf" not "abcdef123456".
	name := v.Path
	if name == "" {
		name = v.ID
	}
	// Defensive cap: name is something like "docs/report.pdf" — only
	// the last segment is meaningful to the browser.
	if idx := lastSlash(name); idx >= 0 {
		name = name[idx+1:]
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", v.Size))
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, sanitizeFilename(name)))
	_, _ = copyAll(w, rc)
}

// handleRestoreVersion replaces the live file with the bytes from a
// snapshot. The pre-restore live file is auto-snapshotted first so the
// restore is itself undoable from the UI.
func (s *Server) handleRestoreVersion(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	versionID := chi.URLParam(r, "id")
	store := s.versionsStore()
	v, err := store.Get(versionID)
	if err != nil {
		if err == versions.ErrNotFound {
			writeError(w, http.StatusNotFound, "not_found", "version not found", middleware.GetRequestID(r.Context()))
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	acc, _, _, err := s.requireFile(r, v.RootID, v.Path, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	restored, err := store.Restore(v.ID, user.ID, acc.provider)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	// Refresh the search index for the live file.
	if info, statErr := acc.provider.Stat(v.Path); statErr == nil && s.Search != nil {
		s.Search.Upsert(v.RootID, info)
	}
	s.audit(r, "version_restore", v.Path, fmt.Sprintf("restored_from=%s version=%d", versionID, v.Version))
	s.emit(events.EventVersionRestored, r, v.RootID, v.Path, restored.Size)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"restored": versionToDTO(*restored),
	})
}

// handleDeleteVersion removes a version row and its bytes. Any user
// who can read the file can prune its history (the cost of storage
// is shared, not personal).
func (s *Server) handleDeleteVersion(w http.ResponseWriter, r *http.Request) {
	versionID := chi.URLParam(r, "id")
	store := s.versionsStore()
	v, err := store.Get(versionID)
	if err != nil {
		if err == versions.ErrNotFound {
			writeError(w, http.StatusNotFound, "not_found", "version not found", middleware.GetRequestID(r.Context()))
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	acc, _, _, err := s.requireFile(r, v.RootID, v.Path, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	if err := store.Delete(versionID, acc.provider); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "version_delete", v.Path, fmt.Sprintf("version=%d id=%s", v.Version, versionID))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// versionDTO is the JSON shape returned to clients. StorageKey is
// always stripped (it would leak the user's provider key shape).
type versionDTO struct {
	ID        string `json:"id"`
	RootID    string `json:"root_id"`
	Path      string `json:"path"`
	Version   int    `json:"version"`
	Size      int64  `json:"size"`
	Checksum  string `json:"checksum"`
	Note      string `json:"note"`
	Auto      bool   `json:"auto"`
	CreatedAt string `json:"created_at"`
	IsCurrent bool   `json:"is_current"`
}

func versionToDTO(v versions.Version) versionDTO {
	return versionDTO{
		ID:        v.ID,
		RootID:    v.RootID,
		Path:      v.Path,
		Version:   v.Version,
		Size:      v.Size,
		Checksum:  v.Checksum,
		Note:      v.Note,
		Auto:      v.Auto,
		CreatedAt: v.CreatedAt,
		IsCurrent: false,
	}
}

// snapshotIfEnabled is the single hook called by write paths
// (uploads, editor, complete). It is a no-op when versioning is
// disabled, when the file is too big, or when there's no live file
// to snapshot.
func (s *Server) snapshotIfEnabled(r *http.Request, rootID, rel string, size int64) {
	if s == nil || !s.Cfg.VersionEnabled || !s.Cfg.VersionAuto {
		return
	}
	store := s.versionsStore()
	if !store.ShouldSnapshot(size) {
		return
	}
	user, ok := auth.UserFromContext(r.Context())
	var userID string
	if ok {
		userID = user.ID
	}
	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		return
	}
	_, _ = store.Create(versions.CreateInput{
		UserID: userID,
		RootID: rootID,
		Path:   rel,
		Note:   "auto",
		Auto:   true,
	}, acc.provider)
}

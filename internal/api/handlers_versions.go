package api

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/events"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
)

type FileVersion struct {
	ID        string `json:"id"`
	RootID    string `json:"root_id"`
	Path      string `json:"path"`
	Version   int    `json:"version"`
	Size      int64  `json:"size"`
	Checksum  string `json:"checksum"`
	Note      string `json:"note"`
	CreatedAt string `json:"created_at"`
}

// handleListVersions lists all versions for a file.
func (s *Server) handleListVersions(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	rootID := r.URL.Query().Get("root")
	path := r.URL.Query().Get("path")
	if rootID == "" || path == "" {
		writeError(w, http.StatusBadRequest, "invalid_params", "root and path are required", middleware.GetRequestID(r.Context()))
		return
	}

	rel, err := storage.CleanRelative(path)
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}

	rows, err := s.DB.Query(`
		SELECT id, root_id, path, version, size, checksum, note, created_at
		FROM file_versions
		WHERE root_id = ? AND path = ? AND user_id = ?
		ORDER BY version DESC
		LIMIT 50
	`, rootID, rel, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list versions", middleware.GetRequestID(r.Context()))
		return
	}
	defer rows.Close()

	var versions []FileVersion
	for rows.Next() {
		var v FileVersion
		if err := rows.Scan(&v.ID, &v.RootID, &v.Path, &v.Version, &v.Size, &v.Checksum, &v.Note, &v.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "could not scan version", middleware.GetRequestID(r.Context()))
			return
		}
		versions = append(versions, v)
	}

	// Add current file info as "current" version
	acc, err := s.resolveAccess(r, rootID, false)
	if err == nil {
		fi, err := acc.provider.Stat(rel)
		if err == nil {
			currentVersion := FileVersion{
				ID:        "current",
				RootID:    rootID,
				Path:      rel,
				Version:   -1,
				Size:      fi.Size,
				Checksum:  "",
				Note:      "Current",
				CreatedAt: fi.Modified.Format(time.RFC3339),
			}
			versions = append([]FileVersion{currentVersion}, versions...)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"versions": versions})
}

// handleCreateVersion creates a snapshot of the current file state.
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
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	rel, err := storage.CleanRelative(req.Path)
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}

	acc, err := s.resolveAccess(r, req.Root, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}

	rc, err := acc.provider.Read(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	defer rc.Close()

	// Get the next version number
	var maxVersion sql.NullInt64
	s.DB.QueryRow(`SELECT MAX(version) FROM file_versions WHERE root_id = ? AND path = ?`, req.Root, rel).Scan(&maxVersion)
	nextVersion := 1
	if maxVersion.Valid {
		nextVersion = int(maxVersion.Int64) + 1
	}

	// Store version in a data directory
	versionID := randomID()
	storedPath := filepath.Join(s.Cfg.DataDir, "versions", versionID)

	// Ensure directory exists
	os.MkdirAll(filepath.Dir(storedPath), 0700)

	// Copy file to version storage
	dst, err := os.Create(storedPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not create version file", middleware.GetRequestID(r.Context()))
		return
	}
	defer dst.Close()

	// Compute checksum while copying
	hasher := sha256.New()
	tee := io.TeeReader(rc, hasher)
	size, err := io.Copy(dst, tee)
	if err != nil {
		os.Remove(storedPath)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not copy version data", middleware.GetRequestID(r.Context()))
		return
	}

	checksum := hex.EncodeToString(hasher.Sum(nil))
	now := time.Now().UTC().Format(time.RFC3339)

	_, err = s.DB.Exec(`
		INSERT INTO file_versions (id, user_id, root_id, path, version, size, checksum, note, stored_path, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, versionID, user.ID, req.Root, rel, nextVersion, size, checksum, req.Note, storedPath, now)
	if err != nil {
		os.Remove(storedPath)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not save version record", middleware.GetRequestID(r.Context()))
		return
	}

	version := FileVersion{
		ID:        versionID,
		RootID:    req.Root,
		Path:      rel,
		Version:   nextVersion,
		Size:      size,
		Checksum:  checksum,
		Note:      req.Note,
		CreatedAt: now,
	}

	s.audit(r, "version_create", rel, fmt.Sprintf("version=%d", nextVersion))
	s.emit(events.EventVersionCreated, r, req.Root, rel, size)
	writeJSON(w, http.StatusCreated, map[string]any{"version": version})
}

// handleRestoreVersion restores a file from a version snapshot.
func (s *Server) handleRestoreVersion(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	versionID := chi.URLParam(r, "id")

	var rootID, path, storedPath string
	err := s.DB.QueryRow(`
		SELECT root_id, path, stored_path FROM file_versions WHERE id = ? AND user_id = ?
	`, versionID, user.ID).Scan(&rootID, &path, &storedPath)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "not_found", "version not found", middleware.GetRequestID(r.Context()))
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not load version", middleware.GetRequestID(r.Context()))
		return
	}

	// Get write access to the file's root
	acc, err := s.resolveAccess(r, rootID, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}

	// Read the version file
	src, err := os.ReadFile(storedPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not read version data", middleware.GetRequestID(r.Context()))
		return
	}

	// Write it back to the original file path using the provider
	rel, _ := storage.CleanRelative(path)
	if err := acc.provider.Write(rel, strings.NewReader(string(src)), int64(len(src))); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not restore file", middleware.GetRequestID(r.Context()))
		return
	}

	s.audit(r, "version_restore", path, "restored_from="+versionID)
	s.emit(events.EventVersionRestored, r, rootID, rel, int64(len(src)))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleDeleteVersion deletes a specific version.
func (s *Server) handleDeleteVersion(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	versionID := chi.URLParam(r, "id")

	var storedPath string
	err := s.DB.QueryRow(`SELECT stored_path FROM file_versions WHERE id = ? AND user_id = ?`, versionID, user.ID).Scan(&storedPath)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "not_found", "version not found", middleware.GetRequestID(r.Context()))
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not load version", middleware.GetRequestID(r.Context()))
		return
	}

	// Delete the stored file
	os.Remove(storedPath)

	_, err = s.DB.Exec(`DELETE FROM file_versions WHERE id = ?`, versionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not delete version", middleware.GetRequestID(r.Context()))
		return
	}

	s.audit(r, "version_delete", versionID, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

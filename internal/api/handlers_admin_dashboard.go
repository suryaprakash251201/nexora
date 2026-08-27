package api

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/backup"
	"github.com/nexora/nexora/internal/middleware"
)

// ─── Admin dashboard (overview) ─────────────────────────────────────────────

// handleAdminOverview aggregates everything the admin dashboard needs in one
// round trip: counts, usage, per-root breakdown, recent audit, open jobs.
func (s *Server) handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	_ = user

	// User + root counts.
	var userCount, rootCount, fileCount int64
	var totalBytes int64
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&userCount)
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM storage_roots`).Scan(&rootCount)
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM search_index WHERE is_dir = 0`).Scan(&fileCount)
	_ = s.DB.QueryRow(`SELECT COALESCE(SUM(size), 0) FROM search_index WHERE is_dir = 0`).Scan(&totalBytes)

	// Per-root alpha check + usage (mirrors handleAdminGetStorageUsage).
	type usageInfo struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Total     int64  `json:"total"`
		Available int64  `json:"available"`
		Used      int64  `json:"used"`
	}
	roots, err := s.StorageRoots.List()
	if err == nil {
		out := make([]usageInfo, 0, len(roots))
		var aggTotal, aggAvailable, aggUsed int64
		for _, root := range roots {
			prov := s.StorageRoots.ProviderFor(root)
			if prov == nil {
				continue
			}
			q, qerr := prov.GetQuota()
			if qerr != nil {
				continue
			}
			out = append(out, usageInfo{ID: root.ID, Name: root.Name, Total: q.Total, Available: q.Available, Used: q.Used})
			aggTotal += q.Total
			aggAvailable += q.Available
			aggUsed += q.Used
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
		writeJSON(w, http.StatusOK, map[string]any{
			"users":     userCount,
			"roots":     rootCount,
			"files":     fileCount,
			"bytes":     totalBytes,
			"usage":     map[string]any{"total": aggTotal, "used": aggUsed, "available": aggAvailable},
			"rootUsage": out,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"users": userCount, "roots": rootCount, "files": fileCount, "bytes": totalBytes,
	})
}

// ─── Backups management ─────────────────────────────────────────────────────

// backupEntry is a single snapshot file row for the UI.
type backupEntry struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Modtime string `json:"modtime"`
}

// handleAdminListBackups lists the snapshot files in NEXORA_BACKUP_DIR and
// reports whether scheduling is enabled.
func (s *Server) handleAdminListBackups(w http.ResponseWriter, r *http.Request) {
	dir := s.Cfg.BackupDir
	entries := []backupEntry{}
	if dir != "" {
		if files, err := os.ReadDir(dir); err == nil {
			for _, f := range files {
				if f.IsDir() || !strings.HasSuffix(f.Name(), ".db") {
					continue
				}
				info, ierr := f.Info()
				if ierr != nil {
					continue
				}
				entries = append(entries, backupEntry{
					Name:    f.Name(),
					Size:    info.Size(),
					Modtime: info.ModTime().UTC().Format(time.RFC3339),
				})
			}
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].Modtime > entries[j].Modtime })
	}
	if entries == nil {
		entries = []backupEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": dir != "",
		"dir":     dir,
		"keep":    s.Cfg.BackupKeep,
		"hour":    s.Cfg.BackupHour,
		"items":   entries,
	})
}

// backupRunMu serializes manual backup triggers so two admins can't both run
// a VACUUM INTO on the same DB at once.
var backupRunMu sync.Mutex

// handleAdminCreateBackup triggers a manual backup now (202 Accepted; runs in
// a goroutine so the request returns immediately).
func (s *Server) handleAdminCreateBackup(w http.ResponseWriter, r *http.Request) {
	if s.Cfg.BackupDir == "" {
		writeError(w, http.StatusBadRequest, "backups_disabled", "set NEXORA_BACKUP_DIR to enable backups", middleware.GetRequestID(r.Context()))
		return
	}
	if s.Cfg.DatabaseType == "postgres" {
		writeError(w, http.StatusBadRequest, "backups_sqlite_only", "scheduled backups only apply to SQLite; use pg_dump for PostgreSQL", middleware.GetRequestID(r.Context()))
		return
	}
	acquired := backupRunMu.TryLock()
	if !acquired {
		writeError(w, http.StatusConflict, "backup_running", "a backup is already in progress", middleware.GetRequestID(r.Context()))
		return
	}
	go func() {
		defer backupRunMu.Unlock()
		err := backup.RunOnce(s.DB, s.Cfg.BackupDir, s.Cfg.BackupKeep, s.Log)
		if err != nil && s.Log != nil {
			s.Log.Error("manual backup failed", "error", err.Error())
		}
	}()
	s.audit(r, "backup_create", s.Cfg.BackupDir, "manual backup triggered")
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true})
}

// handleAdminDeleteBackup removes one backup snapshot file by name, with
// strict containment inside the backup dir (no traversal).
func (s *Server) handleAdminDeleteBackup(w http.ResponseWriter, r *http.Request) {
	if s.Cfg.BackupDir == "" {
		writeError(w, http.StatusBadRequest, "backups_disabled", "set NEXORA_BACKUP_DIR to enable backups", middleware.GetRequestID(r.Context()))
		return
	}
	name := chi.URLParam(r, "name")
	if name == "" || strings.ContainsAny(name, "/\\") || strings.Contains(name, "%2F") || strings.Contains(name, "%2f") || filepath.Base(name) != name {
		writeError(w, http.StatusBadRequest, "invalid_name", "invalid backup name", middleware.GetRequestID(r.Context()))
		return
	}
	abs, err := filepath.Abs(filepath.Join(s.Cfg.BackupDir, name))
	if err != nil || !isInsideDir(s.Cfg.BackupDir, abs) {
		writeError(w, http.StatusBadRequest, "invalid_name", "invalid backup name", middleware.GetRequestID(r.Context()))
		return
	}
	if err := os.Remove(abs); err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "not_found", "backup not found", middleware.GetRequestID(r.Context()))
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error", "could not delete backup", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "backup_delete", name, "manual deletion")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// isInsideDir reports whether abs is inside dir (path containment).
func isInsideDir(dir, abs string) bool {
	rel, err := filepath.Rel(dir, abs)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

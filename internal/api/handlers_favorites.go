package api

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"

	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
	"github.com/nexora/nexora/internal/util"
)

func (s *Server) handleListFavorites(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	rows, err := s.DB.Query(
		`SELECT f.root_id, f.path, f.created_at, r.name
		 FROM favorites f LEFT JOIN storage_roots r ON r.id=f.root_id
		 WHERE f.user_id=? ORDER BY f.created_at DESC LIMIT 200`, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list favorites", middleware.GetRequestID(r.Context()))
		return
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var rootID, path, createdAt, rootName string
		if err := rows.Scan(&rootID, &path, &createdAt, &rootName); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"root_id":    rootID,
			"root_name":  rootName,
			"path":       path,
			"name":       storage.NameFromPath(path),
			"created_at": createdAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) handleAddFavorite(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	// Ensure the user can access the root.
	if _, err := s.resolveAccess(r, req.Root, false); err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	user, _ := auth.UserFromContext(r.Context())
	_, err = s.DB.Exec(
		`INSERT INTO favorites(user_id, root_id, path, created_at) VALUES(?,?,?,?)
		 ON CONFLICT(user_id, root_id, path) DO NOTHING`,
		user.ID, req.Root, rel, util.NowUTC())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not add favorite", middleware.GetRequestID(r.Context()))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleRemoveFavorite(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	_, err = s.DB.Exec(`DELETE FROM favorites WHERE user_id=? AND root_id=? AND path=?`, user.ID, rootID, rel)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not remove favorite", middleware.GetRequestID(r.Context()))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListRecents(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	limit, _ := strconv.Atoi(queryParam(r, "limit", "30"))
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := s.DB.Query(
		`SELECT rc.root_id, rc.path, rc.accessed_at, r.name
		 FROM recents rc LEFT JOIN storage_roots r ON r.id=rc.root_id
		 WHERE rc.user_id=? ORDER BY rc.accessed_at DESC LIMIT ?`, user.ID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list recents", middleware.GetRequestID(r.Context()))
		return
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var rootID, path, accessedAt, rootName string
		if err := rows.Scan(&rootID, &path, &accessedAt, &rootName); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"root_id":     rootID,
			"root_name":   rootName,
			"path":        path,
			"name":        storage.NameFromPath(path),
			"accessed_at": accessedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

// recordRecent upserts a recent entry for the current user (best effort).
// kind is "access" for views/downloads/plays or "add" for uploads/creates.
func (s *Server) recordRecent(r *http.Request, rootID, path, kind string) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || path == "" {
		return
	}
	if kind == "" {
		kind = "access"
	}
	_, _ = s.DB.Exec(
		`INSERT INTO recents(user_id, root_id, path, accessed_at, kind) VALUES(?,?,?,?,?)
		 ON CONFLICT(user_id, root_id, path) DO UPDATE SET accessed_at=excluded.accessed_at, kind=excluded.kind`,
		user.ID, rootID, path, util.NowUTC(), kind)
	// Trim to the most recent 100 entries per user.
	_, _ = s.DB.Exec(
		`DELETE FROM recents WHERE user_id=? AND path NOT IN (
			SELECT path FROM recents WHERE user_id=? ORDER BY accessed_at DESC LIMIT 100
		)`, user.ID, user.ID)
}

// recentItems returns the user's most recent recents of a given kind.
func (s *Server) recentItems(userID, kind string, limit int) []map[string]any {
	rows, err := s.DB.Query(
		`SELECT rc.root_id, rc.path, rc.accessed_at, r.name
		 FROM recents rc LEFT JOIN storage_roots r ON r.id=rc.root_id
		 WHERE rc.user_id=? AND rc.kind=? ORDER BY rc.accessed_at DESC LIMIT ?`,
		userID, kind, limit)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var rootID, path, accessedAt, rootName string
		if err := rows.Scan(&rootID, &path, &accessedAt, &rootName); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"root_id":     rootID,
			"root_name":   rootName,
			"path":        path,
			"name":        storage.NameFromPath(path),
			"accessed_at": accessedAt,
		})
	}
	return out
}

// homeMediaKinds maps a recents kind to the file categories shown on Home.
const (
	homeKindDocuments = "documents"
	homeKindMusic     = "music"
	homeKindVideo     = "video"
	homeKindAdded     = "added"
)

// classifyMedia returns the Home media category for a file path, or "" if the
// file is not a recognized document/music/video type.
func classifyMedia(path string) string {
	ext := strings.ToLower(storage.Ext(path))
	switch {
	case docExt[ext]:
		return homeKindDocuments
	case musicExt[ext]:
		return homeKindMusic
	case videoExt[ext]:
		return homeKindVideo
	}
	return ""
}

var docExt = map[string]bool{
	"pdf": true, "doc": true, "docx": true, "xls": true, "xlsx": true,
	"ppt": true, "pptx": true, "txt": true, "md": true, "csv": true,
	"rtf": true, "odt": true, "ods": true, "odp": true, "tex": true,
	"pages": true, "key": true, "numbers": true,
}
var musicExt = map[string]bool{
	"mp3": true, "flac": true, "wav": true, "ogg": true, "m4a": true,
	"aac": true, "opus": true, "wma": true, "alac": true,
}
var videoExt = map[string]bool{
	"mp4": true, "mkv": true, "webm": true, "mov": true, "avi": true,
	"m4v": true, "ogv": true, "wmv": true, "flv": true, "ts": true,
}

// homeSection returns recent items of the given media category (or the "added"
// bucket) up to limit entries.
func (s *Server) homeSection(userID, category string, limit int) []map[string]any {
	var rows *sql.Rows
	var err error
	if category == homeKindAdded {
		rows, err = s.DB.Query(
			`SELECT rc.root_id, rc.path, rc.accessed_at, r.name
			 FROM recents rc LEFT JOIN storage_roots r ON r.id=rc.root_id
			 WHERE rc.user_id=? AND rc.kind='add' ORDER BY rc.accessed_at DESC LIMIT ?`,
			userID, limit)
	} else {
		rows, err = s.DB.Query(
			`SELECT rc.root_id, rc.path, rc.accessed_at, r.name
			 FROM recents rc LEFT JOIN storage_roots r ON r.id=rc.root_id
			 WHERE rc.user_id=? AND rc.kind='access' ORDER BY rc.accessed_at DESC LIMIT ?`,
			userID, limit)
	}
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var rootID, path, accessedAt, rootName string
		if err := rows.Scan(&rootID, &path, &accessedAt, &rootName); err != nil {
			continue
		}
		if category != homeKindAdded && classifyMedia(path) != category {
			continue
		}
		out = append(out, map[string]any{
			"root_id":     rootID,
			"root_name":   rootName,
			"path":        path,
			"name":        storage.NameFromPath(path),
			"accessed_at": accessedAt,
		})
	}
	return out
}

// handleHome returns dashboard data for the post-login Home view.
func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	pls, _ := s.Playlists.ListPublic()
	s.hydratePlaylistItems(pls)

	writeJSON(w, http.StatusOK, map[string]any{
		"recent":      s.recentItems(user.ID, "access", 12),
		"added":       s.recentItems(user.ID, "add", 12),
		"documents":   s.homeSection(user.ID, homeKindDocuments, 12),
		"music":       s.homeSection(user.ID, homeKindMusic, 12),
		"video":       s.homeSection(user.ID, homeKindVideo, 12),
		"playlists":   pls,
	})
}

package api

import (
	"net/http"
	"strconv"
	"time"

	"context"

	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/search"
	"github.com/nexora/nexora/internal/storage"
)

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	roots, err := s.StorageRoots.UserRoots(user.ID, user.Role == "admin")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not resolve roots", middleware.GetRequestID(r.Context()))
		return
	}
	allowed := make([]string, 0, len(roots))
	for _, rt := range roots {
		allowed = append(allowed, rt.ID)
	}
	if len(allowed) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
		return
	}

	// Restrict to a single requested root only if the user may access it.
	rootID := queryParam(r, "root", "")
	if rootID != "" {
		ok := false
		for _, id := range allowed {
			if id == rootID {
				ok = true
				break
			}
		}
		if !ok {
			writeError(w, http.StatusForbidden, "forbidden", "no access to that root", middleware.GetRequestID(r.Context()))
			return
		}
	}

	q := search.Query{
		RootIDs: allowed,
		RootID:  rootID,
		Name:    queryParam(r, "q", ""),
		Ext:     queryParam(r, "ext", ""),
		Kind:    queryParam(r, "kind", ""),
		Sort:    queryParam(r, "sort", "relevance"),
	}
	if p, err := storage.CleanRelative(queryParam(r, "path", "")); err == nil {
		q.Path = p
	}
	q.MinSize, _ = strconv.ParseInt(queryParam(r, "min_size", "0"), 10, 64)
	q.MaxSize, _ = strconv.ParseInt(queryParam(r, "max_size", "0"), 10, 64)
	if v := queryParam(r, "modified_after", ""); v != "" {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			q.ModifiedAfter = t
		}
	}
	if v := queryParam(r, "modified_before", ""); v != "" {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			q.ModifiedBefore = t.Add(24 * time.Hour)
		}
	}
	q.Limit, _ = strconv.Atoi(queryParam(r, "limit", "100"))
	q.Offset, _ = strconv.Atoi(queryParam(r, "offset", "0"))

	results, err := s.Search.Search(q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search_error", "search failed", middleware.GetRequestID(r.Context()))
		return
	}
	items := make([]map[string]any, 0, len(results))
	for _, res := range results {
		items = append(items, map[string]any{
			"name":      res.Name,
			"path":      res.Path,
			"size":      res.Size,
			"is_dir":    res.IsDir,
			"mime":      res.Mime,
			"extension": res.Ext,
			"root_id":   res.RootID,
			"modified":  res.Modified.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "has_more": len(results) == q.Limit})
}

// handleAdminReindex triggers a background rescan of all indexed roots.
func (s *Server) handleAdminReindex(w http.ResponseWriter, r *http.Request) {
	go s.Search.ScanAll(context.Background())
	s.audit(r, "search_reindex", "system", "manual reindex triggered")
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "message": "reindex started"})
}

package api

import (
	"database/sql"
	"encoding/json"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/search"
)

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

func randomID() string {
	b := make([]byte, 16)
	for i := range b {
		b[i] = alphabet[rand.Intn(len(alphabet))]
	}
	return string(b)
}

type SavedSearch struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Query     string    `json:"query"`
	Filters   string    `json:"filters"`
	Sort      string    `json:"sort"`
	SortOrder string    `json:"sort_order"`
	RootID    string    `json:"root_id,omitempty"`
	Icon      string    `json:"icon,omitempty"`
	Color     string    `json:"color,omitempty"`
	IsPinned  bool      `json:"is_pinned"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type SavedSearchInput struct {
	Name      string `json:"name"`
	Query     string `json:"query"`
	Filters   string `json:"filters"`
	Sort      string `json:"sort"`
	SortOrder string `json:"sort_order"`
	RootID    string `json:"root_id,omitempty"`
	Icon      string `json:"icon,omitempty"`
	Color     string `json:"color,omitempty"`
	IsPinned  bool   `json:"is_pinned"`
}

type SearchResult struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	IsDir     bool   `json:"is_dir"`
	Mime      string `json:"mime"`
	Extension string `json:"extension"`
	RootID    string `json:"root_id"`
	Modified  string `json:"modified"`
}

func (s *Server) handleListSavedSearches(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	rows, err := s.DB.Query(`
		SELECT id, name, query, filters, sort, sort_order, root_id, icon, color, is_pinned, created_at, updated_at
		FROM saved_searches
		WHERE user_id = ?
		ORDER BY is_pinned DESC, name ASC
	`, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list saved searches", middleware.GetRequestID(r.Context()))
		return
	}
	defer rows.Close()

	var searches []SavedSearch
	for rows.Next() {
		var ss SavedSearch
		var rootID sql.NullString
		var icon, color sql.NullString
		if err := rows.Scan(&ss.ID, &ss.Name, &ss.Query, &ss.Filters, &ss.Sort, &ss.SortOrder, &rootID, &icon, &color, &ss.IsPinned, &ss.CreatedAt, &ss.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "could not scan saved search", middleware.GetRequestID(r.Context()))
			return
		}
		if rootID.Valid {
			ss.RootID = rootID.String
		}
		if icon.Valid {
			ss.Icon = icon.String
		}
		if color.Valid {
			ss.Color = color.String
		}
		searches = append(searches, ss)
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": searches})
}

func (s *Server) handleCreateSavedSearch(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	var req SavedSearchInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	if strings.TrimSpace(req.Name) == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "name is required", middleware.GetRequestID(r.Context()))
		return
	}

	if req.Sort == "" {
		req.Sort = "name"
	}
	if req.SortOrder == "" {
		req.SortOrder = "asc"
	}
	if req.Filters == "" {
		req.Filters = "{}"
	}

	id := randomID()
	now := time.Now().UTC().Format(time.RFC3339)

	_, err := s.DB.Exec(`
		INSERT INTO saved_searches (id, user_id, name, query, filters, sort, sort_order, root_id, icon, color, is_pinned, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, user.ID, req.Name, req.Query, req.Filters, req.Sort, req.SortOrder, req.RootID, req.Icon, req.Color, func() int { if req.IsPinned { return 1 }; return 0 }(), now, now)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not create saved search", middleware.GetRequestID(r.Context()))
		return
	}

	ss := SavedSearch{
		ID:        id,
		Name:      req.Name,
		Query:     req.Query,
		Filters:   req.Filters,
		Sort:      req.Sort,
		SortOrder: req.SortOrder,
		RootID:    req.RootID,
		Icon:      req.Icon,
		Color:     req.Color,
		IsPinned:  req.IsPinned,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	s.audit(r, "saved_search_create", req.Name, "")
	writeJSON(w, http.StatusCreated, map[string]any{"saved_search": ss})
}

func (s *Server) handleUpdateSavedSearch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	var req SavedSearchInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}

	if strings.TrimSpace(req.Name) == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "name is required", middleware.GetRequestID(r.Context()))
		return
	}

	if req.Sort == "" {
		req.Sort = "name"
	}
	if req.SortOrder == "" {
		req.SortOrder = "asc"
	}
	if req.Filters == "" {
		req.Filters = "{}"
	}

	now := time.Now().UTC().Format(time.RFC3339)

	res, err := s.DB.Exec(`
		UPDATE saved_searches
		SET name = ?, query = ?, filters = ?, sort = ?, sort_order = ?, root_id = ?, icon = ?, color = ?, is_pinned = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, req.Name, req.Query, req.Filters, req.Sort, req.SortOrder, req.RootID, req.Icon, req.Color, func() int { if req.IsPinned { return 1 }; return 0 }(), now, id, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not update saved search", middleware.GetRequestID(r.Context()))
		return
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		writeError(w, http.StatusNotFound, "not_found", "saved search not found", middleware.GetRequestID(r.Context()))
		return
	}

	ss := SavedSearch{
		ID:        id,
		Name:      req.Name,
		Query:     req.Query,
		Filters:   req.Filters,
		Sort:      req.Sort,
		SortOrder: req.SortOrder,
		RootID:    req.RootID,
		Icon:      req.Icon,
		Color:     req.Color,
		IsPinned:  req.IsPinned,
		UpdatedAt: time.Now().UTC(),
	}

	s.audit(r, "saved_search_update", req.Name, "")
	writeJSON(w, http.StatusOK, map[string]any{"saved_search": ss})
}

func (s *Server) handleDeleteSavedSearch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	res, err := s.DB.Exec(`DELETE FROM saved_searches WHERE id = ? AND user_id = ?`, id, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not delete saved search", middleware.GetRequestID(r.Context()))
		return
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		writeError(w, http.StatusNotFound, "not_found", "saved search not found", middleware.GetRequestID(r.Context()))
		return
	}

	s.audit(r, "saved_search_delete", id, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleExecuteSavedSearch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}

	var ss SavedSearch
	var rootID, icon, color sql.NullString
	err := s.DB.QueryRow(`
		SELECT id, name, query, filters, sort, sort_order, root_id, icon, color, is_pinned, created_at, updated_at
		FROM saved_searches
		WHERE id = ? AND user_id = ?
	`, id, user.ID).Scan(&ss.ID, &ss.Name, &ss.Query, &ss.Filters, &ss.Sort, &ss.SortOrder, &rootID, &icon, &color, &ss.IsPinned, &ss.CreatedAt, &ss.UpdatedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "not_found", "saved search not found", middleware.GetRequestID(r.Context()))
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not load saved search", middleware.GetRequestID(r.Context()))
		return
	}

	// Parse filters JSON
	var filters map[string]string
	if ss.Filters != "" {
		json.Unmarshal([]byte(ss.Filters), &filters)
	}

	// Build search query
	limit, _ := strconv.Atoi(queryParam(r, "limit", "200"))
	offset, _ := strconv.Atoi(queryParam(r, "offset", "0"))

	searchReq := search.Query{
		Name:  ss.Query,
		Limit: limit,
		Offset: offset,
		Sort:  ss.Sort,
	}
	if ss.RootID != "" {
		searchReq.RootID = ss.RootID
	}

	// If root_id is set in saved search, use it; otherwise use query param
	if rootParam := queryParam(r, "root", ""); rootParam != "" && ss.RootID == "" {
		searchReq.RootID = rootParam
	}

	results, err := s.Search.Search(r.Context(), searchReq)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "search failed", middleware.GetRequestID(r.Context()))
		return
	}

	// Convert to search results
	items := make([]map[string]any, len(results))
	for i, item := range results {
		items[i] = map[string]any{
			"name":      item.Name,
			"path":      item.Path,
			"size":      item.Size,
			"is_dir":    item.IsDir,
			"mime":      item.Mime,
			"extension": item.Ext,
			"root_id":   item.RootID,
			"modified":  item.Modified.Format(time.RFC3339),
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"saved_search": ss,
		"results":      items,
		"limit":        limit,
		"offset":       offset,
		"total":        len(items),
	})
}
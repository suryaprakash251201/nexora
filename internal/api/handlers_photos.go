package api

import (
	"net/http"
	"strconv"
	
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/search"
)

// handleGetPhotosTimeline returns a paginated list of photos from all accessible roots
func (s *Server) handleGetPhotosTimeline(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(ctx))
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 {
		limit = 100
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	var q search.PhotoQuery
	q.Q = r.URL.Query().Get("q")
	q.Year, _ = strconv.Atoi(r.URL.Query().Get("year"))
	q.Month, _ = strconv.Atoi(r.URL.Query().Get("month"))
	q.CameraMake = r.URL.Query().Get("camera_make")
	q.HasLocation = r.URL.Query().Get("has_location") == "true" || r.URL.Query().Get("has_location") == "1"
	q.FavoritesOnly = r.URL.Query().Get("favorites_only") == "true" || r.URL.Query().Get("favorites_only") == "1"
	q.DateFrom = r.URL.Query().Get("date_from")
	q.DateTo = r.URL.Query().Get("date_to")
	q.Sort = r.URL.Query().Get("sort")

	// Find roots the user can read
	roots, err := s.StorageRoots.UserRoots(user.ID, user.Role == "admin")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(ctx))
		return
	}

	var rootIDs []string
	for _, rt := range roots {
		rootIDs = append(rootIDs, rt.ID)
	}

	// Fetch one extra row so has_more is exact: a full page plus one means
	// there is definitely another page (no wasted request on the boundary).
	photos, err := s.Search.GetPhotosTimeline(ctx, user.ID, rootIDs, q, limit+1, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error(), middleware.GetRequestID(ctx))
		return
	}

	hasMore := len(photos) > limit
	if hasMore {
		photos = photos[:limit]
	}
	if photos == nil {
		photos = []search.PhotoResult{} // empty array for JSON
	}

	resp := map[string]interface{}{
		"items":    photos,
		"has_more": hasMore,
	}

	// Total count is only needed on the first page; skip it on subsequent
	// pages so pagination stays cheap.
	if offset == 0 {
		if total, err := s.Search.CountPhotos(ctx, user.ID, rootIDs, q); err == nil {
			resp["total_count"] = total
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

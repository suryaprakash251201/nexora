package api

import (
	"net/http"
	"strconv"
)

// handleGetPhotosTimeline returns a paginated list of photos from all accessible roots
func (s *Server) handleGetPhotosTimeline(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := ctxUser(ctx)

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 {
		limit = 100
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	// Find roots the user can read
	roots, err := s.Roots.ListForUser(user.ID, "read")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	var rootIDs []string
	for _, rt := range roots {
		rootIDs = append(rootIDs, rt.ID)
	}

	photos, err := s.Search.GetPhotosTimeline(ctx, rootIDs, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	if photos == nil {
		photos = []interface{}{} // empty array for JSON
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"items":    photos,
		"has_more": len(photos) == limit,
	})
}

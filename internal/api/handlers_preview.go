package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/preview"
	"github.com/nexora/nexora/internal/storage"
)

func (s *Server) handleThumbnail(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	size, _ := strconv.Atoi(queryParam(r, "size", "256"))
	data, err := s.Preview.Thumbnail(acc.provider, rootID, rel, size)
	if err != nil {
		// Fall back to embedded album art for audio files (MP3/FLAC).
		if cover, cerr := s.Preview.Cover(acc.provider, rootID, rel, size); cerr == nil {
			data = cover
			err = nil
		}
	}
	if err != nil {
		if err == preview.ErrUnsupported {
			writeError(w, http.StatusUnsupportedMediaType, "unsupported", "no thumbnail for this file", middleware.GetRequestID(r.Context()))
			return
		}
		s.writeProviderError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) handleChecksum(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	info, err := acc.provider.Stat(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	if info.IsDir {
		writeError(w, http.StatusBadRequest, "is_directory", "cannot checksum a directory", middleware.GetRequestID(r.Context()))
		return
	}
	sum, err := s.Preview.Checksum(acc.provider, rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"algorithm": "sha256", "checksum": sum})
}

// handleMetadata returns rich, on-demand details for the details drawer:
// dimensions for images, plus base stat info. Media duration is not computed
// (no FFmpeg dependency); the browser reports it during playback instead.
func (s *Server) handleMetadata(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	info, err := acc.provider.Stat(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	meta := map[string]any{
		"name":      info.Name,
		"path":      info.Path,
		"size":      info.Size,
		"is_dir":    info.IsDir,
		"mime":      info.Mime,
		"extension": storage.Ext(info.Name),
		"modified":  info.Modified.UTC().Format(time.RFC3339),
		"root_id":   rootID,
		"editable":  !info.IsDir && preview.IsEditable(info.Name) && info.Size <= s.Cfg.MaxEditableSize,
	}
	if !info.IsDir && preview.IsThumbnailable(info.Name) {
		if wpx, hpx, derr := s.Preview.Dimensions(acc.provider, rel); derr == nil {
			meta["width"] = wpx
			meta["height"] = hpx
		}
	}
	writeJSON(w, http.StatusOK, meta)
}

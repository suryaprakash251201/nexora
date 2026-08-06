package api

import (
	"fmt"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	rootID := queryParam(r, "root", "")
	target := queryParam(r, "path", "")
	target, err := storage.CleanRelative(target)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	acc, err := s.resolveAccess(r, rootID, true)
	if err != nil {
		s.writeAccessError(w, r, err)
		return
	}

	if err := r.ParseMultipartForm(s.Cfg.MaxUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "upload_too_large", "request body exceeds max upload size", middleware.GetRequestID(r.Context()))
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		// Single-file field fallback.
		if f, ok := r.MultipartForm.File["file"]; ok {
			files = f
		}
	}
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "no_files", "no files provided", middleware.GetRequestID(r.Context()))
		return
	}

	var uploaded []string
	for _, fh := range files {
		name := filepath.Base(fh.Filename)
		if name == "" || strings.ContainsAny(name, "/\\") {
			writeError(w, http.StatusBadRequest, "invalid_name", "invalid file name", middleware.GetRequestID(r.Context()))
			return
		}
		dest := target
		if dest != "" {
			dest += "/"
		}
		dest += name
		if _, err := storage.CleanRelative(dest); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_path", err.Error(), middleware.GetRequestID(r.Context()))
			return
		}
		if err := s.checkAllowedMime(fh.Filename, fh.Header.Get("Content-Type")); err != nil {
			writeError(w, http.StatusBadRequest, "mime_not_allowed", err.Error(), middleware.GetRequestID(r.Context()))
			return
		}
		src, err := fh.Open()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "could not read upload", middleware.GetRequestID(r.Context()))
			return
		}
		if err := acc.provider.Write(dest, src, fh.Size); err != nil {
			src.Close()
			s.writeProviderError(w, r, err)
			return
		}
		src.Close()
		uploaded = append(uploaded, dest)
		s.indexUpsert(rootID, acc.provider, dest)
		if s.Metrics != nil {
			s.Metrics.AddUpload(fh.Size)
		}
		s.audit(r, "upload", dest, "")
		s.recordRecent(r, rootID, dest, "add")
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "uploaded": uploaded})
}

func (s *Server) checkAllowedMime(filename, contentType string) error {
	if len(s.Cfg.AllowedMimeTypes) == 0 {
		return nil
	}
	mime := storage.MimeFor(filename, false)
	for _, allowed := range s.Cfg.AllowedMimeTypes {
		if allowed == mime || strings.HasPrefix(mime, strings.TrimSuffix(allowed, "*")+"") {
			return nil
		}
		if allowed == "*/*" || allowed == mime {
			return nil
		}
	}
	return os.ErrPermission
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "is_directory", "use archive download for directories", middleware.GetRequestID(r.Context()))
		return
	}
	rc, err := acc.provider.Read(rel)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", storage.MimeFor(info.Name, false))
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+urlEncode(info.Name))
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size, 10))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, rc)
	s.audit(r, "download", rel, "")
	s.recordRecent(r, rootID, rel, "access")
}

func (s *Server) handleRaw(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "is_directory", "cannot preview a directory", middleware.GetRequestID(r.Context()))
		return
	}
	if r.Header.Get("Range") == "" {
		s.recordRecent(r, rootID, rel, "access")
	}
	total := info.Size
	start, end, ok := parseRange(r.Header.Get("Range"), total)
	if !ok {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", total))
		writeError(w, http.StatusRequestedRangeNotSatisfiable, "range_not_satisfiable", "requested range not satisfiable", middleware.GetRequestID(r.Context()))
		return
	}
	rc, _, err := acc.provider.OpenRange(rel, start, end)
	if err != nil {
		s.writeProviderError(w, r, err)
		return
	}
	defer rc.Close()

	mime := storage.MimeFor(info.Name, false)
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Accept-Ranges", "bytes")
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+urlEncode(info.Name))
	} else {
		w.Header().Set("Content-Disposition", "inline; filename*=UTF-8''"+urlEncode(info.Name))
	}

	rangeHeader := r.Header.Get("Range")
	if rangeHeader == "" {
		w.Header().Set("Content-Length", strconv.FormatInt(total, 10))
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, rc)
		return
	}
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, total))
	w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
	w.WriteHeader(http.StatusPartialContent)
	_, _ = io.Copy(w, rc)
}

// parseRange returns the byte range for a Range header, or (0, 0, false) when
// the request cannot be satisfied (RFC 9110 §14.1.2 — server should reply 416).
// Suffix ranges ("bytes=-N") mean the final N bytes.
func parseRange(rangeHeader string, total int64) (int64, int64, bool) {
	if total <= 0 {
		return 0, 0, false
	}
	start, end := int64(0), total-1
	if rangeHeader == "" || !strings.HasPrefix(rangeHeader, "bytes=") {
		return start, end, true
	}
	spec := strings.TrimPrefix(rangeHeader, "bytes=")
	parts := strings.SplitN(spec, "-", 2)
	if len(parts) != 2 {
		return start, end, true
	}
	// Suffix range: "bytes=-N" → final N bytes. Players use this to read the
	// MP4 moov atom when it sits at the end of the file; returning the wrong
	// bytes breaks playback on iOS AVPlayer / Android ExoPlayer.
	if parts[0] == "" && parts[1] != "" {
		if n, err := strconv.ParseInt(parts[1], 10, 64); err == nil && n > 0 {
			if n < total {
				start = total - n
			}
		}
		return start, end, true // end already = total-1
	}
	if v, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
		start = v
	}
	if parts[1] != "" {
		if v, err := strconv.ParseInt(parts[1], 10, 64); err == nil {
			end = v
		}
	} else {
		end = total - 1 // "bytes=N-" → from N to EOF
	}
	if start < 0 {
		start = 0
	}
	if start >= total {
		return 0, 0, false // starts past EOF → 416
	}
	if end >= total {
		end = total - 1
	}
	if start > end {
		start, end = 0, total-1
	}
	return start, end, true
}

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/jobs"
	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
)

func (s *Server) handleCreateArchive(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root  string   `json:"root"`
		Paths []string `json:"paths"`
		Name  string   `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	if len(req.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "no_paths", "select at least one item to archive", middleware.GetRequestID(r.Context()))
		return
	}
	// Require read access to the root; validate every path.
	if _, err := s.resolveAccess(r, req.Root, false); err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	clean := make([]string, 0, len(req.Paths))
	for _, p := range req.Paths {
		c, err := storage.CleanRelative(p)
		if err != nil || c == "" {
			writeError(w, http.StatusBadRequest, "invalid_path", "invalid path in selection", middleware.GetRequestID(r.Context()))
			return
		}
		clean = append(clean, c)
	}
	if req.Name == "" {
		req.Name = "archive"
	}
	user, _ := auth.UserFromContext(r.Context())
	job, err := s.Jobs.EnqueueArchive(user.ID, jobs.ArchivePayload{RootID: req.Root, Paths: clean, Name: req.Name})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not start archive job", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "archive", req.Name, fmt.Sprintf("%d items", len(clean)))
	writeJSON(w, http.StatusAccepted, map[string]any{"job": job})
}

func (s *Server) handleExtract(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Root        string `json:"root"`
		Path        string `json:"path"`
		Destination string `json:"destination"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	src, err := storage.CleanRelative(req.Path)
	if err != nil || src == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid archive path", middleware.GetRequestID(r.Context()))
		return
	}
	dest, err := storage.CleanRelative(req.Destination)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid destination", middleware.GetRequestID(r.Context()))
		return
	}
	// Extraction writes files: require write access.
	if _, err := s.resolveAccess(r, req.Root, true); err != nil {
		s.writeAccessError(w, r, err)
		return
	}
	if storage.Ext(src) != "zip" {
		writeError(w, http.StatusBadRequest, "unsupported", "only .zip archives can be extracted", middleware.GetRequestID(r.Context()))
		return
	}
	user, _ := auth.UserFromContext(r.Context())
	job, err := s.Jobs.EnqueueExtract(user.ID, jobs.ExtractPayload{RootID: req.Root, Path: src, Dest: dest})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not start extract job", middleware.GetRequestID(r.Context()))
		return
	}
	s.audit(r, "extract", src, "-> "+dest)
	writeJSON(w, http.StatusAccepted, map[string]any{"job": job})
}

func (s *Server) handleListJobs(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return
	}
	limit, _ := strconv.Atoi(queryParam(r, "limit", "20"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	list, err := s.Jobs.ListForUser(user.ID, user.Role == "admin", limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not list jobs", middleware.GetRequestID(r.Context()))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": list})
}

func (s *Server) getOwnedJob(w http.ResponseWriter, r *http.Request) (jobs.Job, bool) {
	id := chi.URLParam(r, "id")
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Authentication required", middleware.GetRequestID(r.Context()))
		return jobs.Job{}, false
	}
	job, found, err := s.Jobs.Get(id)
	if err != nil || !found {
		writeError(w, http.StatusNotFound, "not_found", "job not found", middleware.GetRequestID(r.Context()))
		return jobs.Job{}, false
	}
	if user.Role != "admin" && job.UserID != user.ID {
		writeError(w, http.StatusForbidden, "forbidden", "not your job", middleware.GetRequestID(r.Context()))
		return jobs.Job{}, false
	}
	return job, true
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	job, ok := s.getOwnedJob(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"job": job})
}

// handleJobEvents streams job progress via Server-Sent Events.
func (s *Server) handleJobEvents(w http.ResponseWriter, r *http.Request) {
	job, ok := s.getOwnedJob(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "no_stream", "streaming unsupported", middleware.GetRequestID(r.Context()))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	sub, cancel := s.Jobs.Subscribe(job.ID)
	defer cancel()

	// Send the current state immediately.
	writeSSE(w, job)
	flusher.Flush()
	if job.Status == jobs.StatusDone || job.Status == jobs.StatusFailed {
		return
	}

	ctx := r.Context()
	ticker := time.NewTicker(30 * time.Second) // heartbeat
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case j, open := <-sub:
			if !open {
				return
			}
			writeSSE(w, j)
			flusher.Flush()
			if j.Status == jobs.StatusDone || j.Status == jobs.StatusFailed {
				return
			}
		case <-ticker.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func writeSSE(w http.ResponseWriter, job jobs.Job) {
	data, _ := json.Marshal(job)
	fmt.Fprintf(w, "event: progress\ndata: %s\n\n", data)
}

// handleDownloadArchive serves a completed archive job's ZIP output.
func (s *Server) handleDownloadArchive(w http.ResponseWriter, r *http.Request) {
	job, ok := s.getOwnedJob(w, r)
	if !ok {
		return
	}
	if job.Type != jobs.TypeArchive || job.Status != jobs.StatusDone {
		writeError(w, http.StatusConflict, "not_ready", "archive is not ready", middleware.GetRequestID(r.Context()))
		return
	}
	path := s.Jobs.ArchivePath(job.ID)
	f, err := os.Open(path)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "archive expired or missing", middleware.GetRequestID(r.Context()))
		return
	}
	defer f.Close()
	info, _ := f.Stat()
	name := job.Result
	if name == "" {
		name = "archive.zip"
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+urlEncode(name))
	if info != nil {
		w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	}
	http.ServeContent(w, r, name, time.Now(), f)
}

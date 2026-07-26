// Package webdav provides a WebDAV server that maps to Nexora's storage roots.
// This enables mounting Nexora as a network drive in Windows, macOS, and Linux.
package webdav

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/nexora/nexora/internal/storage"
)

// Handler serves WebDAV requests backed by a Nexora storage root.
type Handler struct {
	provider storage.StorageProvider
	rootName string
	rootID   string
}

// NewHandler creates a WebDAV handler for the given storage root.
func NewHandler(provider storage.StorageProvider, rootName, rootID string) *Handler {
	return &Handler{
		provider: provider,
		rootName: rootName,
		rootID:   rootID,
	}
}

// ServeHTTP handles WebDAV requests.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Clean the path
	reqPath := path.Clean(r.URL.Path)

	switch r.Method {
	case "OPTIONS":
		h.handleOptions(w, r)
	case "GET", "HEAD":
		h.handleGet(w, r, reqPath)
	case "PROPFIND":
		h.handlePropfind(w, r, reqPath)
	case "MKCOL":
		h.handleMkcol(w, r, reqPath)
	case "PUT":
		h.handlePut(w, r, reqPath)
	case "DELETE":
		h.handleDelete(w, r, reqPath)
	case "COPY", "MOVE":
		h.handleCopyMove(w, r, reqPath)
	case "LOCK":
		h.handleLock(w, r, reqPath)
	case "UNLOCK":
		h.handleUnlock(w, r, reqPath)
	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

func (h *Handler) handleOptions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Allow", "OPTIONS,GET,HEAD,PROPFIND,PUT,DELETE,MKCOL,COPY,MOVE,LOCK,UNLOCK")
	w.Header().Set("DAV", "1,2")
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) handleGet(w http.ResponseWriter, r *http.Request, reqPath string) {
	rel := strings.TrimPrefix(reqPath, "/")

	fi, err := h.provider.Stat(rel)
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	if fi.IsDir {
		h.handlePropfind(w, r, reqPath)
		return
	}

	rc, err := h.provider.Read(rel)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer rc.Close()

	w.Header().Set("Content-Type", fi.Mime)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", fi.Size))
	w.Header().Set("Last-Modified", fi.Modified.Format(time.RFC1123))
	w.Header().Set("ETag", fmt.Sprintf(`"%x"`, fi.Size))

	if r.Method == "HEAD" {
		w.WriteHeader(http.StatusOK)
		return
	}

	w.WriteHeader(http.StatusOK)
	io.Copy(w, rc)
}

func (h *Handler) handlePropfind(w http.ResponseWriter, r *http.Request, reqPath string) {
	rel := strings.TrimPrefix(reqPath, "/")

	items, err := h.provider.List(rel)
	if err != nil {
		// Try stat on single item
		fi, err2 := h.provider.Stat(rel)
		if err2 != nil {
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}

		// Return single item
		items = []storage.FileInfo{fi}
	}

	// Generate XML response
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusMultiStatus)

	w.Write([]byte(`<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">` + "\n"))

	for _, item := range items {
		w.Write([]byte(fmt.Sprintf(`  <D:response>
    <D:href>/%s</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>%s</D:displayname>
        <D:getcontentlength>%d</D:getcontentlength>
        <D:getlastmodified>%s</D:getlastmodified>
        <D:resourcetype>%s</D:resourcetype>
        <D:getcontenttype>%s</D:getcontenttype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`+"\n",
			item.Path, item.Name, item.Size,
			item.Modified.Format(time.RFC1123),
			func() string { if item.IsDir { return "<D:collection/>" } ; return "" }(),
			item.Mime,
		)))
	}

	w.Write([]byte("</D:multistatus>\n"))
}

func (h *Handler) handleMkcol(w http.ResponseWriter, r *http.Request, reqPath string) {
	rel := strings.TrimPrefix(reqPath, "/")

	if err := h.provider.CreateDirectory(rel); err != nil {
		if err == storage.ErrPermission {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
}

func (h *Handler) handlePut(w http.ResponseWriter, r *http.Request, reqPath string) {
	rel := strings.TrimPrefix(reqPath, "/")

	body := io.NopCloser(r.Body)
	defer body.Close()

	if err := h.provider.Write(rel, body, r.ContentLength); err != nil {
		if err == storage.ErrPermission {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
}

func (h *Handler) handleDelete(w http.ResponseWriter, r *http.Request, reqPath string) {
	rel := strings.TrimPrefix(reqPath, "/")

	if err := h.provider.Delete(rel); err != nil {
		if err == storage.ErrPermission {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		if err == storage.ErrNotFound {
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleCopyMove(w http.ResponseWriter, r *http.Request, reqPath string) {
	srcRel := strings.TrimPrefix(reqPath, "/")

	dest := r.Header.Get("Destination")
	if dest == "" {
		http.Error(w, "Bad Request: missing Destination header", http.StatusBadRequest)
		return
	}

	// Extract destination path from URL
	destRel := strings.TrimPrefix(path.Clean(dest), "/")

	var err error
	if r.Method == "MOVE" {
		err = h.provider.Move(srcRel, destRel)
	} else {
		err = h.provider.Copy(srcRel, destRel)
	}

	if err != nil {
		if err == storage.ErrPermission {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		if err == storage.ErrNotFound {
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	if r.Method == "MOVE" {
		w.WriteHeader(http.StatusCreated)
	} else {
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *Handler) handleLock(w http.ResponseWriter, r *http.Request, reqPath string) {
	// Simplified lock support - always succeed
	w.Header().Set("Lock-Token", fmt.Sprintf("<urn:uuid:%d>", time.Now().UnixNano()))
	w.WriteHeader(http.StatusOK)

	w.Write([]byte(`<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>infinity</D:depth>
      <D:timeout>Second-3600</D:timeout>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`))
}

func (h *Handler) handleUnlock(w http.ResponseWriter, r *http.Request, reqPath string) {
	w.WriteHeader(http.StatusNoContent)
}

// Ensure interface compliance
var _ http.Handler = (*Handler)(nil)

// Helper type to satisfy fs.FileInfo for display purposes
type fileInfoAdapter struct {
	name    string
	size    int64
	isDir   bool
	modTime time.Time
}

func (f *fileInfoAdapter) Name() string       { return f.name }
func (f *fileInfoAdapter) Size() int64        { return f.size }
func (f *fileInfoAdapter) Mode() os.FileMode  {
	if f.isDir {
		return os.ModeDir | 0755
	}
	return 0644
}
func (f *fileInfoAdapter) ModTime() time.Time { return f.modTime }
func (f *fileInfoAdapter) IsDir() bool        { return f.isDir }
func (f *fileInfoAdapter) Sys() interface{}   { return nil }

var _ fs.FileInfo = (*fileInfoAdapter)(nil)

// unused imports placeholder to avoid unused import errors
var _ = context.Background
var _ = fmt.Sprintf

package api

import (
	"io"
	"net/http"
	"strings"

	"github.com/nexora/nexora/internal/storage"
)

// requireFile resolves the storage access for rootID, validates the relative path,
// and stats the file. It centralises the CleanRelative → resolveAccess → Stat
// prologue that was previously copy-pasted across ~10 handlers.
// On error the caller should translate err via s.writeProviderError / writeError.
func (s *Server) requireFile(r *http.Request, rootID, rawPath string, needWrite bool) (access, string, storage.FileInfo, error) {
	rel, err := storage.CleanRelative(rawPath)
	if err != nil {
		return access{}, "", storage.FileInfo{}, err
	}
	acc, err := s.resolveAccess(r, rootID, needWrite)
	if err != nil {
		return access{}, "", storage.FileInfo{}, err
	}
	info, err := acc.provider.Stat(rel)
	if err != nil {
		return access{}, "", storage.FileInfo{}, err
	}
	return acc, rel, info, nil
}

// lastSlash returns the byte index of the last forward slash in s, or
// -1 if there is none.
func lastSlash(s string) int {
	return strings.LastIndex(s, "/")
}

// sanitizeFilename strips characters that are unsafe in a
// Content-Disposition header (CRLF injection vector) and caps the
// length so the header stays well under any reasonable limit.
func sanitizeFilename(name string) string {
	if name == "" {
		return "download"
	}
	// Replace anything outside a conservative allow-list.
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '.', r == '_', r == '-', r == ' ':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	out := strings.TrimSpace(b.String())
	if out == "" {
		return "download"
	}
	if len(out) > 120 {
		out = out[len(out)-120:]
	}
	return out
}

// copyAll is io.Copy but ignores short-write errors (clients can hang
// up mid-download, and the server can't do anything about it).
func copyAll(dst io.Writer, src io.Reader) (int64, error) {
	n, err := io.Copy(dst, src)
	if err == io.EOF {
		return n, nil
	}
	return n, err
}

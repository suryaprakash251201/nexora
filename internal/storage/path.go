package storage

import (
	"errors"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// CleanRelative normalizes a root-relative path and validates it. It returns
// the cleaned path using forward slashes, with "." represented as "" (root).
// Traversal attempts and null bytes are rejected.
func CleanRelative(rel string) (string, error) {
	if !utf8.ValidString(rel) {
		return "", ErrInvalidPath
	}
	if strings.ContainsRune(rel, 0) {
		return "", ErrInvalidPath
	}
	// Reject backslashes to force forward-slash, platform-neutral paths.
	if strings.ContainsRune(rel, '\\') {
		return "", ErrInvalidPath
	}
	cleaned := path.Clean("/" + rel)
	if cleaned == "/" {
		return "", nil
	}
	relOut := strings.TrimPrefix(cleaned, "/")
	// Guard against traversal (path.Clean already collapses ".." to "/..").
	if strings.HasPrefix(relOut, "..") || relOut == ".." {
		return "", ErrTraversal
	}
	return relOut, nil
}

// Resolve joins a root absolute path with a cleaned relative path and verifies
// the result stays within rootPath. It returns the absolute OS path.
func Resolve(rootPath, rel string) (string, error) {
	absRoot := filepath.Clean(rootPath)
	cleaned, err := CleanRelative(rel)
	if err != nil {
		return "", err
	}
	joined := filepath.Clean(filepath.Join(absRoot, filepath.FromSlash(cleaned)))
	rel2, err := filepath.Rel(absRoot, joined)
	if err != nil {
		return "", ErrTraversal
	}
	if rel2 == ".." || strings.HasPrefix(rel2, ".."+string(filepath.Separator)) {
		return "", ErrTraversal
	}
	return joined, nil
}

// NameFromPath returns the base name of a relative path.
func NameFromPath(rel string) string {
	rel = strings.TrimSuffix(rel, "/")
	if i := strings.LastIndex(rel, "/"); i >= 0 {
		return rel[i+1:]
	}
	return rel
}

// Ext returns the lower-case extension without the dot.
func Ext(name string) string {
	e := path.Ext(name)
	if e == "" {
		return ""
	}
	return strings.ToLower(strings.TrimPrefix(e, "."))
}

// Ensure errors are referenced (used by callers importing this package).
var _ = errors.New

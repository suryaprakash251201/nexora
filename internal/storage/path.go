package storage

import (
	"errors"
	"os"
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
	// Guard against traversal. path.Clean collapses a leading ".." at the root
	// (e.g. "/../etc" -> "/etc"), so we cannot rely on the cleaned form alone.
	// Instead: if the raw path has a ".." segment that survives cleaning as a
	// leading escape, reject it. Intermediate ".." that cancel out (e.g.
	// "a/b/../c") remain safe.
	if strings.Contains(rel, "..") {
		cleaned := path.Clean(rel)
		if strings.HasPrefix(cleaned, "..") {
			return "", ErrTraversal
		}
	}
	cleaned := path.Clean("/" + rel)
	if cleaned == "/" {
		return "", nil
	}
	relOut := strings.TrimPrefix(cleaned, "/")
	return relOut, nil
}

// Resolve joins a root absolute path with a cleaned relative path and verifies
// the result stays within rootPath and does not escape via symlinks.
// It returns the absolute OS path.
func Resolve(rootPath, rel string) (string, error) {
	absRoot := filepath.Clean(rootPath)
	cleaned, err := CleanRelative(rel)
	if err != nil {
		return "", err
	}
	joined := filepath.Clean(filepath.Join(absRoot, filepath.FromSlash(cleaned)))

	joinedAbs, err := filepath.Abs(joined)
	if err != nil {
		return "", err
	}
	rootAbs, err := filepath.Abs(absRoot)
	if err != nil {
		return "", err
	}

	// Resolve symlinks so an attacker cannot escape the root via a symlink
	// planted inside the storage tree. EvalSymlinks returns the original path
	// if it does not exist or is not a symlink, so this is safe to call even
	// when the target does not yet exist (e.g. for Write/CreateDirectory).
	resolved, err := filepath.EvalSymlinks(joinedAbs)
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	if err == nil {
		rel3, err := filepath.Rel(absRoot, resolved)
		if err != nil || rel3 == ".." || strings.HasPrefix(rel3, ".."+string(filepath.Separator)) {
			return "", ErrTraversal
		}
	}

	// Boundary-aware containment check: a bare HasPrefix would wrongly accept
	// siblings like /data2 when the root is /data. Accept only the root itself
	// or paths below root/. The value returned below is the same one validated
	// by this guard so that taint analysis recognizes it as safe.
	if joinedAbs == rootAbs {
		return rootAbs, nil
	}
	if !strings.HasPrefix(joinedAbs, rootAbs+string(filepath.Separator)) {
		return "", ErrTraversal
	}
	return joinedAbs, nil
}

// IsAncestor reports whether ancestor is the same path as descendant or a
// strict ancestor of it (a parent directory at any depth). Both arguments
// must already be cleaned (use CleanRelative first). An empty string is
// treated as the root and is therefore an ancestor of every non-empty path.
func IsAncestor(ancestor, descendant string) bool {
	if ancestor == "" {
		return descendant != ""
	}
	if ancestor == descendant {
		return true
	}
	return strings.HasPrefix(descendant, ancestor+"/")
}

// IsSameOrDescendant reports whether child is the same as parent or nested
// inside it. It is the inverse of "would moving parent into child loop
// forever" — see handlers_file_ops.go for the canonical use.
func IsSameOrDescendant(parent, child string) bool {
	return IsAncestor(parent, child)
}

// IsInside reports whether candidate (an OS-style absolute path) is the same
// as root or a strict descendant of it. It is the path-containment check used
// by the static-file handler to prevent a request like "/../etc/passwd" from
// being resolved to a file outside the web root. Both arguments must be
// absolute and already cleaned (filepath.Clean); otherwise the answer is
// undefined. An empty candidate or root returns false.
func IsInside(root, candidate string) bool {
	if root == "" || candidate == "" {
		return false
	}
	if candidate == root {
		return true
	}
	// Boundary-aware prefix: append the separator so a sibling like
	// "/data2" is not falsely accepted when root is "/data".
	return strings.HasPrefix(candidate, strings.TrimRight(root, string(filepath.Separator))+string(filepath.Separator))
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

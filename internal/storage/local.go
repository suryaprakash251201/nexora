package storage

import (
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/nexora/nexora/internal/util"
)

// SystemTrashDir is the per-root directory where deleted items are moved before
// permanent removal. It is hidden from normal file listings.
const SystemTrashDir = ".nexora-trash"

// LocalFilesystemProvider implements StorageProvider against a host directory.
type LocalFilesystemProvider struct {
	rootPath string
	readOnly bool
}

// NewLocalFilesystemProvider creates a provider bound to an absolute path.
func NewLocalFilesystemProvider(rootPath string, readOnly bool) *LocalFilesystemProvider {
	return &LocalFilesystemProvider{rootPath: filepath.Clean(rootPath), readOnly: readOnly}
}

func (p *LocalFilesystemProvider) abs(rel string) (string, error) {
	return Resolve(p.rootPath, rel)
}

// List returns entries within a directory.
func (p *LocalFilesystemProvider) List(rel string) ([]FileInfo, error) {
	abs, err := p.abs(rel)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	out := make([]FileInfo, 0, len(entries))
	for _, e := range entries {
		// Hide the per-root trash directory so it doesn't clutter user listings.
		if e.Name() == SystemTrashDir {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		childRel := rel
		if childRel != "" {
			childRel += "/"
		}
		childRel += e.Name()
		out = append(out, FileInfo{
			Name:     e.Name(),
			Path:     childRel,
			Size:     fi.Size(),
			IsDir:    fi.IsDir(),
			Modified: fi.ModTime(),
			Mime:     mimeFor(e.Name(), fi.IsDir()),
		})
	}
	return out, nil
}

// Stat returns metadata for a single path.
func (p *LocalFilesystemProvider) Stat(rel string) (FileInfo, error) {
	abs, err := p.abs(rel)
	if err != nil {
		return FileInfo{}, err
	}
	fi, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return FileInfo{}, ErrNotFound
		}
		return FileInfo{}, err
	}
	return FileInfo{
		Name:     NameFromPath(rel),
		Path:     rel,
		Size:     fi.Size(),
		IsDir:    fi.IsDir(),
		Modified: fi.ModTime(),
		Mime:     mimeFor(rel, fi.IsDir()),
	}, nil
}

// Read opens a file for reading.
func (p *LocalFilesystemProvider) Read(rel string) (io.ReadCloser, error) {
	abs, err := p.abs(rel)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return f, nil
}

// Write creates or overwrites a file. Fails on read-only mounts.
func (p *LocalFilesystemProvider) Write(rel string, r io.Reader, size int64) error {
	if p.readOnly {
		return ErrPermission
	}
	abs, err := p.abs(rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	f, err := os.Create(abs)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		return err
	}
	return nil
}

// CreateDirectory creates a directory (and parents as needed).
func (p *LocalFilesystemProvider) CreateDirectory(rel string) error {
	if p.readOnly {
		return ErrPermission
	}
	abs, err := p.abs(rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return err
	}
	return nil
}

// Move renames source to destination. Cross-directory on the same filesystem.
func (p *LocalFilesystemProvider) Move(source, dest string) error {
	if p.readOnly {
		return ErrPermission
	}
	src, err := p.abs(source)
	if err != nil {
		return err
	}
	dst, err := p.abs(dest)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := os.Rename(src, dst); err != nil {
		return err
	}
	return nil
}

// Copy duplicates source to destination.
func (p *LocalFilesystemProvider) Copy(source, dest string) error {
	if p.readOnly {
		return ErrPermission
	}
	src, err := p.abs(source)
	if err != nil {
		return err
	}
	dst, err := p.abs(dest)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return copyFile(src, dst)
}

// Delete removes a file or recursively removes a directory.
func (p *LocalFilesystemProvider) Delete(rel string) error {
	if p.readOnly {
		return ErrPermission
	}
	if rel == "" {
		return ErrInvalidPath
	}
	abs, err := p.abs(rel)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(abs); err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

// OpenRange opens a byte range for streaming (HTTP Range support).
func (p *LocalFilesystemProvider) OpenRange(rel string, start, end int64) (io.ReadCloser, int64, error) {
	abs, err := p.abs(rel)
	if err != nil {
		return nil, 0, err
	}
	f, err := os.Open(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, 0, ErrNotFound
		}
		return nil, 0, err
	}
	fi, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, 0, err
	}
	total := fi.Size()
	if start < 0 {
		start = 0
	}
	if end < 0 || end >= total {
		end = total - 1
	}
	if start > end {
		f.Close()
		return nil, 0, ErrInvalidPath
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		f.Close()
		return nil, 0, err
	}
	return &rangeReader{f: f, remaining: end - start + 1}, total, nil
}

type rangeReader struct {
	f         *os.File
	remaining int64
}

func (r *rangeReader) Read(p []byte) (int, error) {
	if r.remaining <= 0 {
		return 0, io.EOF
	}
	if int64(len(p)) > r.remaining {
		p = p[:r.remaining]
	}
	n, err := r.f.Read(p)
	r.remaining -= int64(n)
	return n, err
}

func (r *rangeReader) Close() error { return r.f.Close() }

// Search walks the subtree matching query conditions. Used when the metadata
// index is disabled for a root. For large trees prefer the indexed search.
func (p *LocalFilesystemProvider) Search(q SearchQuery) ([]FileInfo, error) {
	base, err := p.abs(q.Path)
	if err != nil {
		return nil, err
	}
	var out []FileInfo
	limit := q.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	walkErr := filepath.Walk(base, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if len(out) >= limit {
			return filepath.SkipDir
		}
		rel, rerr := filepath.Rel(p.rootPath, path)
		if rerr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		fi := FileInfo{
			Name:     info.Name(),
			Path:     rel,
			Size:     info.Size(),
			IsDir:    info.IsDir(),
			Modified: info.ModTime(),
			Mime:     mimeFor(rel, info.IsDir()),
		}
		if matchSearch(fi, q) {
			out = append(out, fi)
		}
		return nil
	})
	if walkErr != nil {
		return nil, walkErr
	}
	return out, nil
}

// GetQuota returns disk usage for the mount.
func (p *LocalFilesystemProvider) GetQuota() (Quota, error) {
	return quotaFor(p.rootPath)
}

func matchSearch(fi FileInfo, q SearchQuery) bool {
	if q.Name != "" && !strings.Contains(strings.ToLower(fi.Name), strings.ToLower(q.Name)) {
		return false
	}
	if q.Ext != "" && Ext(fi.Name) != strings.ToLower(q.Ext) {
		return false
	}
	if q.IsDir != nil && fi.IsDir != *q.IsDir {
		return false
	}
	if q.MinSize > 0 && fi.Size < q.MinSize {
		return false
	}
	if q.MaxSize > 0 && fi.Size > q.MaxSize {
		return false
	}
	if !q.ModifiedAfter.IsZero() && fi.Modified.Before(q.ModifiedAfter) {
		return false
	}
	if !q.ModifiedBefore.IsZero() && fi.Modified.After(q.ModifiedBefore) {
		return false
	}
	return true
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return nil
}

func mimeFor(name string, isDir bool) string {
	if isDir {
		return "inode/directory"
	}
	mt := detectMimeByExt(name)
	if mt != "" {
		return mt
	}
	return "application/octet-stream"
}

// MimeFor exposes mime detection for callers outside the package.
func MimeFor(name string, isDir bool) string { return mimeFor(name, isDir) }

func detectMimeByExt(name string) string {
	switch Ext(name) {
	case "jpg", "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "gif":
		return "image/gif"
	case "webp":
		return "image/webp"
	case "svg":
		return "image/svg+xml"
	case "bmp":
		return "image/bmp"
	case "mp4":
		return "video/mp4"
	case "webm":
		return "video/webm"
	case "mov":
		return "video/quicktime"
	case "mkv":
		return "video/x-matroska"
	case "mp3":
		return "audio/mpeg"
	case "ogg":
		return "audio/ogg"
	case "wav":
		return "audio/wav"
	case "flac":
		return "audio/flac"
	case "m4a":
		return "audio/mp4"
	case "pdf":
		return "application/pdf"
	case "md", "markdown":
		return "text/markdown"
	case "txt":
		return "text/plain"
	case "json":
		return "application/json"
	case "yaml", "yml":
		return "text/yaml"
	case "toml":
		return "application/toml"
	case "ini":
		return "text/plain"
	case "html", "htm":
		return "text/html"
	case "css":
		return "text/css"
	case "js", "ts", "jsx", "tsx", "go", "py", "sh", "bash", "rs", "java", "c", "cpp", "h":
		return "text/plain"
	case "zip":
		return "application/zip"
	case "csv":
		return "text/csv"
	default:
		return ""
	}
}

var _ = util.NowUTC

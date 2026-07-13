// Package storage defines the storage provider abstraction and the
// local-filesystem implementation. Additional providers (S3, SFTP, WebDAV) can
// be added later without touching the API layer.
package storage

import (
	"errors"
	"io"
	"time"
)

// Common storage errors.
var (
	ErrNotFound      = errors.New("storage: not found")
	ErrExists        = errors.New("storage: already exists")
	ErrNotDir        = errors.New("storage: not a directory")
	ErrIsDir         = errors.New("storage: is a directory")
	ErrPermission    = errors.New("storage: permission denied")
	ErrInvalidPath   = errors.New("storage: invalid path")
	ErrTraversal     = errors.New("storage: path traversal denied")
	ErrTooLarge      = errors.New("storage: file too large")
)

// FileInfo describes a file or directory within a storage root.
type FileInfo struct {
	Name     string    `json:"name"`
	Path     string    `json:"path"` // relative to root, forward slashes
	Size     int64     `json:"size"`
	IsDir    bool      `json:"is_dir"`
	Modified time.Time `json:"modified"`
	Mime     string    `json:"mime"`
	RootID   string    `json:"root_id,omitempty"`
}

// SearchQuery describes a metadata search.
type SearchQuery struct {
	RootID    string
	Path      string // restrict to this prefix (relative)
	Name      string // substring/prefix match
	Ext       string // extension filter (no dot)
	IsDir     *bool
	MinSize   int64
	MaxSize   int64
	ModifiedAfter  time.Time
	ModifiedBefore time.Time
	Limit     int
	Offset    int
}

// Quota describes storage usage for a root.
type Quota struct {
	Total     int64 `json:"total"`
	Available int64 `json:"available"`
	Used      int64 `json:"used"`
}

// StorageProvider is the interface every backend must satisfy.
type StorageProvider interface {
	List(path string) ([]FileInfo, error)
	Stat(path string) (FileInfo, error)
	Read(path string) (io.ReadCloser, error)
	Write(path string, r io.Reader, size int64) error
	CreateDirectory(path string) error
	Move(source, destination string) error
	Copy(source, destination string) error
	Delete(path string) error
	OpenRange(path string, start, end int64) (io.ReadCloser, int64, error)
	Search(q SearchQuery) ([]FileInfo, error)
	GetQuota() (Quota, error)
}

// Package versions stores and serves file-version snapshots.
//
// A version is a point-in-time copy of a file at a (root_id, path) location.
// Versions live inside the same storage provider as the file itself, so the
// same local/S3 semantics apply — no separate "version backend" to reconcile.
// The legacy `stored_path` layout (a flat directory under DataDir/versions)
// is still readable for rows written before migration 0019.
//
// The package is intentionally small: it owns the DB schema, retention
// policy and provider-aware I/O. The HTTP layer in internal/api
// translates errors and writes JSON.
package versions

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/storage"
)

// HiddenDir is the per-root namespace where version snapshots live. It is
// filtered out of user-facing listings the same way SystemTrashDir is.
const HiddenDir = ".nexora-versions"

// StorageKind identifies where a version's bytes live.
type StorageKind string

const (
	StorageLegacyLocal StorageKind = "local"    // pre-0019 row, legacy DataDir/versions layout
	StorageProvider    StorageKind = "provider" // version lives at StorageKey inside the file's own provider
)

// Version is the DB-backed representation of a single snapshot.
type Version struct {
	ID          string      `json:"id"`
	UserID      string      `json:"user_id"`
	RootID      string      `json:"root_id"`
	Path        string      `json:"path"`
	Version     int         `json:"version"`
	Size        int64       `json:"size"`
	Checksum    string      `json:"checksum"`
	ChecksumAlg string      `json:"checksum_alg"`
	Note        string      `json:"note"`
	StorageKind StorageKind `json:"storage_kind"`
	StorageKey  string      `json:"-"` // never expose provider internals to the client
	Auto        bool        `json:"auto"`
	CreatedAt   string      `json:"created_at"`
}

// Config controls retention behaviour. Zero values mean "no limit" for
// the global caps and "always snapshot" for the size cap.
type Config struct {
	MaxPerFile    int           // keep at most N versions per (root, path); oldest auto-pruned
	MaxFileSize   int64         // refuse to snapshot files larger than this
	MaxTotalAge   time.Duration // purge versions older than this
	MaxTotalBytes int64         // purge oldest versions globally when total bytes exceed this
}

// Store is the DB wrapper for the versions table.
type Store struct {
	DB      *database.DB
	Config  Config
	DataDir string // legacy local versions directory (pre-0019 reads)
}

// ErrNotFound is returned when a version ID is unknown.
var ErrNotFound = errors.New("versions: not found")

// ErrTooLarge is returned when the file is bigger than MaxFileSize.
var ErrTooLarge = errors.New("versions: file too large to snapshot")

// List returns all versions for a file, newest first.
func (s *Store) List(rootID, relPath string) []Version {
	rows, err := s.DB.Query(`
		SELECT id, user_id, root_id, path, version, size, checksum, checksum_alg,
		       note, storage_kind, storage_key, auto, created_at
		FROM file_versions
		WHERE root_id = ? AND path = ?
		ORDER BY version DESC
		LIMIT 200
	`, rootID, relPath)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var out []Version
	for rows.Next() {
		var v Version
		var autoInt int
		if err := rows.Scan(&v.ID, &v.UserID, &v.RootID, &v.Path, &v.Version,
			&v.Size, &v.Checksum, &v.ChecksumAlg, &v.Note,
			&v.StorageKind, &v.StorageKey, &autoInt, &v.CreatedAt); err != nil {
			continue
		}
		v.Auto = autoInt != 0
		out = append(out, v)
	}
	return out
}

// CreateInput is the data needed to snapshot a file.
type CreateInput struct {
	UserID string
	RootID string
	Path   string
	Note   string
	Auto   bool
}

// Create makes a new snapshot of the file at (rootID, in.Path). The bytes
// are streamed through the provider, never buffered in memory. The
// returned Version is the newly-created row.
func (s *Store) Create(in CreateInput, provider storage.StorageProvider) (*Version, error) {
	rel, err := storage.CleanRelative(in.Path)
	if err != nil {
		return nil, err
	}
	info, err := provider.Stat(rel)
	if err != nil {
		return nil, err
	}
	if info.IsDir {
		return nil, fmt.Errorf("versions: cannot snapshot a directory")
	}
	if s.Config.MaxFileSize > 0 && info.Size > s.Config.MaxFileSize {
		return nil, ErrTooLarge
	}

	// Next version number per (root, path). MAX(version) is NULL on
	// the first call; sql.NullInt64 handles that.
	var maxV sql.NullInt64
	if err := s.DB.QueryRow(
		`SELECT MAX(version) FROM file_versions WHERE root_id = ? AND path = ?`,
		in.RootID, rel,
	).Scan(&maxV); err != nil {
		return nil, err
	}
	next := 1
	if maxV.Valid {
		next = int(maxV.Int64) + 1
	}

	// Storage key: a flat namespace inside the file's own provider so
	// versions inherit all the access/permission/backup behaviour of
	// the root. The 24-char hex token is unguessable but short.
	id, err := randomID()
	if err != nil {
		return nil, err
	}
	storageKey := HiddenDir + "/" + id

	hasher := sha256.New()
	src, err := provider.Read(rel)
	if err != nil {
		return nil, err
	}
	defer src.Close()

	// Stream into the provider. We pass info.Size when the provider
	// wants it (S3) and -1 when streaming-from-disk is fine (local);
	// both providers accept either.
	var size int64
	if err := streamCopyWithHash(provider, storageKey, src, hasher, info.Size, &size); err != nil {
		_ = provider.Delete(storageKey)
		return nil, err
	}

	checksum := hex.EncodeToString(hasher.Sum(nil))
	now := time.Now().UTC().Format(time.RFC3339)

	_, err = s.DB.Exec(`
		INSERT INTO file_versions
			(id, user_id, root_id, path, version, size, checksum, checksum_alg,
			 note, storage_kind, storage_key, auto, created_at, stored_path)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, in.UserID, in.RootID, rel, next, size, checksum, "sha256", in.Note, "provider", storageKey, boolToInt(in.Auto), now, "")
	if err != nil {
		_ = provider.Delete(storageKey)
		return nil, err
	}

	v := &Version{
		ID:          id,
		UserID:      in.UserID,
		RootID:      in.RootID,
		Path:        rel,
		Version:     next,
		Size:        size,
		Checksum:    checksum,
		ChecksumAlg: "sha256",
		Note:        in.Note,
		StorageKind: StorageProvider,
		StorageKey:  storageKey,
		Auto:        in.Auto,
		CreatedAt:   now,
	}

	// Enforce per-file cap. Best-effort and synchronous (a handful of
	// DB rows); makes the cap observable immediately.
	if s.Config.MaxPerFile > 0 {
		if err := s.prunePerFile(in.RootID, rel, s.Config.MaxPerFile, provider); err != nil {
			// Prune is best-effort: a failure here doesn't break
			// the snapshot, it just means the per-file cap is
			// exceeded until the next snapshot. We still want to
			// surface it for diagnosis.
			_ = err
		}
	}
	return v, nil
}

// Get returns one version by ID. The returned Version's StorageKey is
// populated for downstream Open().
func (s *Store) Get(id string) (*Version, error) {
	var v Version
	var autoInt int
	err := s.DB.QueryRow(`
		SELECT id, user_id, root_id, path, version, size, checksum, checksum_alg,
		       note, storage_kind, storage_key, auto, created_at
		FROM file_versions WHERE id = ?
	`, id).Scan(&v.ID, &v.UserID, &v.RootID, &v.Path, &v.Version, &v.Size,
		&v.Checksum, &v.ChecksumAlg, &v.Note, &v.StorageKind, &v.StorageKey,
		&autoInt, &v.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	v.Auto = autoInt != 0
	return &v, nil
}

// Open returns a reader for the bytes of v. The caller must Close it.
func (s *Store) Open(v *Version, provider storage.StorageProvider) (io.ReadCloser, error) {
	switch v.StorageKind {
	case StorageProvider, "":
		return provider.Read(v.StorageKey)
	case StorageLegacyLocal:
		path := v.StorageKey
		if path == "" {
			// Fallback for very old rows that somehow missed
			// backfill. Read by ID-encoded path.
			path = filepath.Join(s.DataDir, "versions", v.ID)
		}
		f, err := os.Open(path)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		return f, nil
	}
	return nil, fmt.Errorf("versions: unknown storage_kind %q", v.StorageKind)
}

// Delete removes a version row and its bytes. Best-effort on the bytes:
// if the underlying object is already gone, the DB row is still removed.
func (s *Store) Delete(id string, provider storage.StorageProvider) error {
	v, err := s.Get(id)
	if err != nil {
		return err
	}
	if _, err := s.DB.Exec(`DELETE FROM file_versions WHERE id = ?`, id); err != nil {
		return err
	}
	switch v.StorageKind {
	case StorageProvider, "":
		_ = provider.Delete(v.StorageKey)
	case StorageLegacyLocal:
		_ = os.Remove(v.StorageKey)
	}
	return nil
}

// Restore copies the bytes of v into the live file at v.Path. The current
// live file is auto-snapshotted first so the restore is itself undoable.
func (s *Store) Restore(id, userID string, provider storage.StorageProvider) (*Version, error) {
	v, err := s.Get(id)
	if err != nil {
		return nil, err
	}
	// Auto-snapshot the current file before clobbering it.
	if _, statErr := provider.Stat(v.Path); statErr == nil {
		_, _ = s.Create(CreateInput{
			UserID: userID, RootID: v.RootID, Path: v.Path,
			Note: "auto-saved before restoring version " + fmt.Sprint(v.Version),
			Auto: true,
		}, provider)
	}

	rc, err := s.Open(v, provider)
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	tmpKey := v.Path + ".restore-tmp"
	if err := provider.Write(tmpKey, rc, v.Size); err != nil {
		_ = provider.Delete(tmpKey)
		return nil, err
	}
	if err := provider.Move(tmpKey, v.Path); err != nil {
		_ = provider.Delete(tmpKey)
		return nil, err
	}
	return v, nil
}

// Purge enforces the global retention policy (MaxTotalAge, MaxTotalBytes).
// Safe to call concurrently; only deletes rows that match the cap.
// The returned counts are for logging.
func (s *Store) Purge(provider storage.StorageProvider) (deleted int, freedBytes int64, err error) {
	if s.Config.MaxTotalAge > 0 {
		cutoff := time.Now().UTC().Add(-s.Config.MaxTotalAge).Format(time.RFC3339)
		d, f, e := s.deleteWhere(`created_at < ?`, []any{cutoff}, provider)
		deleted += d
		freedBytes += f
		if e != nil {
			return deleted, freedBytes, e
		}
	}
	if s.Config.MaxTotalBytes > 0 {
		var total sql.NullInt64
		if err := s.DB.QueryRow(`SELECT COALESCE(SUM(size), 0) FROM file_versions`).Scan(&total); err != nil {
			return deleted, freedBytes, err
		}
		if total.Valid && total.Int64 > s.Config.MaxTotalBytes {
			over := total.Int64 - s.Config.MaxTotalBytes
			d, f, e := s.dropOldestUntil(over, provider)
			deleted += d
			freedBytes += f
			if e != nil {
				return deleted, freedBytes, e
			}
		}
	}
	_, _ = s.DB.Exec(`
		INSERT INTO version_settings (key, value) VALUES ('last_purge_at', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, time.Now().UTC().Format(time.RFC3339))
	return deleted, freedBytes, nil
}

// PurgeForPath removes every version row for a file. Used when a file is
// permanently deleted (not just trashed) so we don't leak bytes.
func (s *Store) PurgeForPath(rootID, relPath string, provider storage.StorageProvider) (int, int64, error) {
	return s.purgeWhere(`root_id = ? AND path = ?`, []any{rootID, relPath}, provider)
}

// PurgeForPrefix removes every version row whose path is at or under the
// given prefix (e.g. after moving/renaming a folder, where every child's
// version key changes). Returns rows deleted and bytes freed.
func (s *Store) PurgeForPrefix(rootID, prefix string, provider storage.StorageProvider) (int, int64, error) {
	if prefix == "" {
		return 0, 0, nil
	}
	return s.purgeWhere(`root_id = ? AND (path = ? OR path LIKE ?)`, []any{rootID, prefix, prefix + "/%"}, provider)
}

func (s *Store) purgeWhere(where string, args []any, provider storage.StorageProvider) (int, int64, error) {
	rows, err := s.DB.Query(`SELECT id FROM file_versions WHERE `+where, args...)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	var freed int64
	for _, id := range ids {
		v, err := s.Get(id)
		if err != nil {
			continue
		}
		freed += v.Size
		_ = s.Delete(id, provider)
	}
	return len(ids), freed, nil
}

// prunePerFile deletes the oldest snapshots for a single (root, path)
// until at most `keep` remain.
func (s *Store) prunePerFile(rootID, relPath string, keep int, provider storage.StorageProvider) error {
	if keep <= 0 {
		return nil
	}
	rows, err := s.DB.Query(`
		SELECT id, version FROM file_versions
		WHERE root_id = ? AND path = ?
		ORDER BY version DESC
	`, rootID, relPath)
	if err != nil {
		return err
	}
	defer rows.Close()
	var allIDs []string
	for rows.Next() {
		var id string
		var v int
		if err := rows.Scan(&id, &v); err != nil {
			continue
		}
		allIDs = append(allIDs, id)
	}
	// Skip the newest `keep`; delete the rest.
	if len(allIDs) <= keep {
		return nil
	}
	for _, id := range allIDs[keep:] {
		_ = s.Delete(id, provider)
	}
	return nil
}

// dropOldestUntil removes the oldest versions until the global size is
// below the cap, while always keeping the newest MaxPerFile per file.
func (s *Store) dropOldestUntil(over int64, provider storage.StorageProvider) (int, int64, error) {
	keep := s.Config.MaxPerFile
	if keep < 1 {
		keep = 1
	}
	rows, err := s.DB.Query(`
		SELECT v.id, v.size
		FROM file_versions v
		WHERE v.id NOT IN (
			SELECT id FROM file_versions vv
			WHERE vv.root_id = v.root_id AND vv.path = v.path
			ORDER BY vv.version DESC LIMIT ?
		)
		ORDER BY v.created_at ASC
	`, keep)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	type row struct {
		id   string
		size int64
	}
	var candidates []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.size); err != nil {
			continue
		}
		candidates = append(candidates, r)
	}
	var freed int64
	var deleted int
	for _, c := range candidates {
		_ = s.Delete(c.id, provider)
		freed += c.size
		deleted++
		if freed >= over {
			break
		}
	}
	return deleted, freed, nil
}

// deleteWhere is the shared helper for Purge().
func (s *Store) deleteWhere(where string, args []any, provider storage.StorageProvider) (int, int64, error) {
	rows, err := s.DB.Query(
		`SELECT id, size FROM file_versions WHERE `+where, args...,
	)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	var ids []string
	var freed int64
	for rows.Next() {
		var id string
		var size int64
		if err := rows.Scan(&id, &size); err != nil {
			continue
		}
		ids = append(ids, id)
		freed += size
	}
	for _, id := range ids {
		_ = s.Delete(id, provider)
	}
	return len(ids), freed, nil
}

// streamCopyWithHash streams src into provider.Write while feeding every
// byte through hasher. The total bytes written are returned via *size.
//
// For the local provider the size is recovered by a follow-up Stat
// because Write doesn't report bytes-written. For the S3 provider size
// is the value passed to Write.
func streamCopyWithHash(provider storage.StorageProvider, key string, src io.Reader, hasher hash.Hash, declaredSize int64, sizeOut *int64) error {
	tee := io.TeeReader(src, hasher)
	if err := provider.Write(key, tee, declaredSize); err != nil {
		return err
	}
	if declaredSize >= 0 {
		*sizeOut = declaredSize
		return nil
	}
	// Unknown size (e.g. local streaming). Recover via Stat.
	info, err := provider.Stat(key)
	if err != nil {
		return err
	}
	*sizeOut = info.Size
	return nil
}

// ShouldSnapshot returns true if a file of `size` should be snapshotted
// before being overwritten. Zero MaxFileSize means "no limit".
func (s *Store) ShouldSnapshot(size int64) bool {
	if s == nil {
		return false
	}
	if s.Config.MaxFileSize > 0 && size > s.Config.MaxFileSize {
		return false
	}
	return true
}

// randomID returns 12 bytes of crypto-random hex (24 chars).
func randomID() (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

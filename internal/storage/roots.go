package storage

import (
	"database/sql"
	"sync"

	"github.com/nexora/nexora/internal/util"
)

// Permission is the level of access a user has to a root.
type Permission string

const (
	PermRead  Permission = "read"
	PermWrite Permission = "write"
)

// Root is a configured storage location.
type Root struct {
	ID        string
	Name      string
	Path      string
	ReadOnly  bool
	Enabled   bool
	Indexed   bool
	CreatedAt string
	UpdatedAt string
}

// RootService manages storage roots and resolves providers/user permissions.
type RootService struct {
	db      *sql.DB
	mu      sync.RWMutex
	cache   map[string]StorageProvider
}

// NewRootService creates the service.
func NewRootService(db *sql.DB) *RootService {
	return &RootService{db: db, cache: make(map[string]StorageProvider)}
}

// List returns all roots ordered by name.
func (s *RootService) List() ([]Root, error) {
	rows, err := s.db.Query(`SELECT id,name,path,read_only,enabled,indexed,created_at,updated_at FROM storage_roots ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Root
	for rows.Next() {
		var r Root
		var ro, en, idx int
		if err := rows.Scan(&r.ID, &r.Name, &r.Path, &ro, &en, &idx, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		r.ReadOnly, r.Enabled, r.Indexed = ro == 1, en == 1, idx == 1
		out = append(out, r)
	}
	return out, rows.Err()
}

// Get returns a root by ID.
func (s *RootService) Get(id string) (Root, bool, error) {
	var r Root
	var ro, en, idx int
	err := s.db.QueryRow(`SELECT id,name,path,read_only,enabled,indexed,created_at,updated_at FROM storage_roots WHERE id=?`, id).
		Scan(&r.ID, &r.Name, &r.Path, &ro, &en, &idx, &r.CreatedAt, &r.UpdatedAt)
	if err == sql.ErrNoRows {
		return Root{}, false, nil
	}
	if err != nil {
		return Root{}, false, err
	}
	r.ReadOnly, r.Enabled, r.Indexed = ro == 1, en == 1, idx == 1
	return r, true, nil
}

// Create inserts a new root.
func (s *RootService) Create(r Root) (Root, error) {
	if r.ID == "" {
		r.ID = util.NewID("root_", 12)
	}
	now := util.NowUTC()
	r.CreatedAt, r.UpdatedAt = now, now
	_, err := s.db.Exec(
		`INSERT INTO storage_roots(id,name,path,read_only,enabled,indexed,created_at,updated_at)
		 VALUES(?,?,?,?,?,?,?,?)`,
		r.ID, r.Name, r.Path, boolToInt(r.ReadOnly), boolToInt(r.Enabled), boolToInt(r.Indexed), now, now)
	s.invalidate(r.ID)
	return r, err
}

// Update modifies an existing root's mutable fields.
func (s *RootService) Update(id string, name, path string, readOnly, enabled, indexed bool) error {
	_, err := s.db.Exec(
		`UPDATE storage_roots SET name=?, path=?, read_only=?, enabled=?, indexed=?, updated_at=? WHERE id=?`,
		name, path, boolToInt(readOnly), boolToInt(enabled), boolToInt(indexed), util.NowUTC(), id)
	s.invalidate(id)
	return err
}

// Delete removes a root and its permission grants.
func (s *RootService) Delete(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM user_roots WHERE root_id=?`, id); err != nil {
		tx.Rollback()
		return err
	}
	if _, err := tx.Exec(`DELETE FROM storage_roots WHERE id=?`, id); err != nil {
		tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.invalidate(id)
	return nil
}

// ProviderFor returns a cached storage provider for a root.
func (s *RootService) ProviderFor(r Root) StorageProvider {
	s.mu.RLock()
	if p, ok := s.cache[r.ID]; ok {
		s.mu.RUnlock()
		return p
	}
	s.mu.RUnlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if p, ok := s.cache[r.ID]; ok {
		return p
	}
	p := NewLocalFilesystemProvider(r.Path, r.ReadOnly)
	s.cache[r.ID] = p
	return p
}

func (s *RootService) invalidate(id string) {
	s.mu.Lock()
	delete(s.cache, id)
	s.mu.Unlock()
}

// SetProviderForTest overrides the cached provider for a root. It exists for
// tests that need an in-memory or fake storage backend.
func (s *RootService) SetProviderForTest(id string, p StorageProvider) {
	s.mu.Lock()
	s.cache[id] = p
	s.mu.Unlock()
}

// EnsureDefaultRoots creates roots from configuration the first time the system
// boots with no roots, and grants the admin full access. It is idempotent.
func (s *RootService) EnsureDefaultRoots(roots []Root, adminID string) error {
	existing, err := s.List()
	if err != nil {
		return err
	}
	if len(existing) > 0 {
		return nil
	}
	for _, r := range roots {
		if _, err := s.Create(r); err != nil {
			return err
		}
		if adminID != "" {
			created, _, _ := s.GetByName(r.Name)
			if created.ID != "" {
				_ = s.Grant(adminID, created.ID, PermWrite)
			}
		}
	}
	return nil
}

// GetByName returns a root by name.
func (s *RootService) GetByName(name string) (Root, bool, error) {
	var r Root
	var ro, en, idx int
	err := s.db.QueryRow(`SELECT id,name,path,read_only,enabled,indexed,created_at,updated_at FROM storage_roots WHERE name=?`, name).
		Scan(&r.ID, &r.Name, &r.Path, &ro, &en, &idx, &r.CreatedAt, &r.UpdatedAt)
	if err == sql.ErrNoRows {
		return Root{}, false, nil
	}
	if err != nil {
		return Root{}, false, err
	}
	r.ReadOnly, r.Enabled, r.Indexed = ro == 1, en == 1, idx == 1
	return r, true, nil
}

// Grant sets a user's permission on a root.
func (s *RootService) Grant(userID, rootID string, perm Permission) error {
	if perm == "" {
		perm = PermRead
	}
	_, err := s.db.Exec(
		`INSERT INTO user_roots(user_id, root_id, permission) VALUES(?,?,?)
		 ON CONFLICT(user_id, root_id) DO UPDATE SET permission=excluded.permission`,
		userID, rootID, string(perm))
	return err
}

// Revoke removes a user's permission on a root.
func (s *RootService) Revoke(userID, rootID string) error {
	_, err := s.db.Exec(`DELETE FROM user_roots WHERE user_id=? AND root_id=?`, userID, rootID)
	return err
}

// UserRoots returns roots a user may access, honoring admin super-access.
func (s *RootService) UserRoots(userID string, isAdmin bool) ([]Root, error) {
	if isAdmin {
		return s.List()
	}
	rows, err := s.db.Query(
		`SELECT r.id,r.name,r.path,r.read_only,r.enabled,r.indexed,r.created_at,r.updated_at
		 FROM storage_roots r JOIN user_roots ur ON ur.root_id=r.id
		 WHERE ur.user_id=? AND r.enabled=1 ORDER BY r.name ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Root
	for rows.Next() {
		var r Root
		var ro, en, idx int
		if err := rows.Scan(&r.ID, &r.Name, &r.Path, &ro, &en, &idx, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		r.ReadOnly, r.Enabled, r.Indexed = ro == 1, en == 1, idx == 1
		out = append(out, r)
	}
	return out, rows.Err()
}

// UserPermission returns a user's effective permission on a root. Admins
// implicitly have write access to all enabled roots.
func (s *RootService) UserPermission(userID string, isAdmin bool, rootID string) (Permission, bool, error) {
	r, ok, err := s.Get(rootID)
	if err != nil {
		return "", false, err
	}
	if !ok || !r.Enabled {
		return "", false, nil
	}
	if isAdmin {
		return PermWrite, true, nil
	}
	var perm string
	err = s.db.QueryRow(`SELECT permission FROM user_roots WHERE user_id=? AND root_id=?`, userID, rootID).Scan(&perm)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return Permission(perm), true, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

package settings

import (
	"database/sql"

	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/util"
)

// Store persists admin-editable server settings as key/value rows.
// It overlays the env-based config.Config at startup and at runtime.
type Store struct {
	db *database.DB
}

// NewStore creates a Store backed by db. Table is created by migration
// 0022_system_settings.sql; callers should ensure migrations have run.
func NewStore(db *database.DB) *Store { return &Store{db: db} }

// All returns every persisted setting as a map key→value.
func (s *Store) All() (map[string]string, error) {
	rows, err := s.db.Query(`SELECT key, value FROM system_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// Get returns the value for key, if present.
func (s *Store) Get(key string) (string, bool, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM system_settings WHERE key=?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

// Set upserts a single setting. updatedBy is the acting user ID (may be "").
func (s *Store) Set(key, value, updatedBy string) error {
	now := util.NowUTC()
	// Use explicit ON CONFLICT for dialect portability (see migrations/rewrite.go).
	_, err := s.db.Exec(`
		INSERT INTO system_settings(key, value, updated_at, updated_by)
		VALUES(?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
	`, key, value, now, updatedBy)
	return err
}

// SetMany upserts a batch atomically.
func (s *Store) SetMany(m map[string]string, updatedBy string) error {
	if len(m) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	now := util.NowUTC()
	for k, v := range m {
		if _, e := tx.Exec(`
			INSERT INTO system_settings(key, value, updated_at, updated_by)
			VALUES(?, ?, ?, ?)
			ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
		`, k, v, now, updatedBy); e != nil {
			err = e
			return err
		}
	}
	err = tx.Commit()
	return err
}

// Delete removes a key, reverting it to the env/file default.
func (s *Store) Delete(key string) error {
	_, err := s.db.Exec(`DELETE FROM system_settings WHERE key=?`, key)
	return err
}

// GetUpdatedAt returns the updated_at timestamp for a key (RFC3339) or "".
func (s *Store) GetUpdatedAt(key string) (string, error) {
	var t string
	err := s.db.QueryRow(`SELECT updated_at FROM system_settings WHERE key=?`, key).Scan(&t)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return t, err
}

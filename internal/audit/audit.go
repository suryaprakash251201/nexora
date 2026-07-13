// Package audit provides an append-only audit log store and helper.
package audit

import (
	"database/sql"

	"github.com/nexora/nexora/internal/util"
)

// Entry is a single audit record.
type Entry struct {
	ID        string
	UserID    string
	Action    string
	IP        string
	Target    string
	Detail    string
	CreatedAt string
}

// Store writes audit entries to the database.
type Store struct{ db *sql.DB }

// NewStore creates an audit store.
func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// Record inserts an audit entry. Failures are non-fatal but logged by caller.
func (s *Store) Record(userID, action, target, detail, ip string) error {
	_, err := s.db.Exec(
		`INSERT INTO audit_logs(id, user_id, action, target, ip, detail, created_at)
		 VALUES(?,?,?,?,?,?,?)`,
		util.NewID("aud_", 16), userID, action, target, ip, detail, util.NowUTC())
	return err
}

// List returns recent audit entries ordered newest-first with offset paging.
func (s *Store) List(limit, offset int) ([]Entry, error) {
	rows, err := s.db.Query(
		`SELECT id, user_id, action, ip, target, detail, created_at
		 FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Entry
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.UserID, &e.Action, &e.IP, &e.Target, &e.Detail, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

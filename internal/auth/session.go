package auth

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"time"

	"github.com/nexora/nexora/internal/util"
)

// Session represents an authenticated browser session.
type Session struct {
	ID        string
	UserID    string
	Token     string // raw token (only available at creation)
	ExpiresAt time.Time
}

// SessionStore manages sessions backed by the database.
type SessionStore struct {
	db            *sql.DB
	lifetime      time.Duration
}

// NewSessionStore creates a session store with the given session lifetime.
func NewSessionStore(db *sql.DB, lifetime time.Duration) *SessionStore {
	return &SessionStore{db: db, lifetime: lifetime}
}

// Create issues a new session for userID and returns the raw token to set as a
// cookie. The token is stored hashed; the raw value is never persisted.
func (s *SessionStore) Create(userID, ip, ua string) (*Session, error) {
	raw := util.RandToken(32)
	sum := sha256.Sum256([]byte(raw))
	tokenHash := hex.EncodeToString(sum[:])
	id := util.NewID("ses_", 16)
	expires := time.Now().Add(s.lifetime)
	if _, err := s.db.Exec(
		`INSERT INTO sessions(id, user_id, token_hash, ip, user_agent, expires_at, created_at)
		 VALUES(?,?,?,?,?,?,?)`,
		id, userID, tokenHash, ip, ua, expires.UTC().Format(time.RFC3339), util.NowUTC()); err != nil {
		return nil, err
	}
	return &Session{ID: id, UserID: userID, Token: raw, ExpiresAt: expires}, nil
}

// Lookup resolves a raw token to a session and its owning user, refreshing the
// expiry if still valid. Returns (session, userID, ok).
func (s *SessionStore) Lookup(raw string) (*Session, bool) {
	sum := sha256.Sum256([]byte(raw))
	tokenHash := hex.EncodeToString(sum[:])
	var id, userID, expiresStr string
	err := s.db.QueryRow(
		`SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ?`, tokenHash).
		Scan(&id, &userID, &expiresStr)
	if err != nil {
		return nil, false
	}
	expires := util.ParseTime(expiresStr)
	if expires.Before(time.Now()) {
		return nil, false
	}
	return &Session{ID: id, UserID: userID, ExpiresAt: expires}, true
}

// Delete removes a session by raw token.
func (s *SessionStore) Delete(raw string) error {
	sum := sha256.Sum256([]byte(raw))
	tokenHash := hex.EncodeToString(sum[:])
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

// DeleteAllForUser revokes every session for a user (e.g. on password change).
func (s *SessionStore) DeleteAllForUser(userID string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE user_id = ?`, userID)
	return err
}

// Cleanup deletes expired sessions. Safe to call periodically.
func (s *SessionStore) Cleanup() (int64, error) {
	res, err := s.db.Exec(`DELETE FROM sessions WHERE expires_at < ?`, util.NowUTC())
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

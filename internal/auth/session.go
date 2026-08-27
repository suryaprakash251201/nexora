package auth

import (
	"crypto/sha256"

	"github.com/nexora/nexora/internal/database"
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
	db       *database.DB
	lifetime time.Duration
	// slidingThreshold is the fraction of lifetime below which an active
	// session has its expiry bumped back to now+lifetime. This keeps the
	// UPDATE frequency low (O(1) per session per threshold, not per request)
	// while giving active users a window that effectively never expires.
	// A value of 0.5 means: refresh when less than half the lifetime
	// remains, so the worst case is a logout half a lifetime after the
	// user's last activity.
	slidingThreshold float64
}

// NewSessionStore creates a session store with the given session lifetime.
func NewSessionStore(db *database.DB, lifetime time.Duration) *SessionStore {
	return &SessionStore{db: db, lifetime: lifetime, slidingThreshold: 0.5}
}

// SetLifetime updates the session lifetime at runtime.
func (s *SessionStore) SetLifetime(d time.Duration) {
	s.lifetime = d
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

// Lookup resolves a raw token to a session and its owning user. The session
// has a sliding window: when the remaining lifetime falls below
// `slidingThreshold * lifetime` (default 50%), the expiry is bumped back to
// now + lifetime so an active user is never logged out while using the app.
// The UPDATE is throttled to once per threshold to keep the write rate low.
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
	// Sliding-window refresh: when the session is closer to expiry than
	// the threshold, bump it. Done outside the SELECT transaction (we are
	// already past it) and best-effort: a failed UPDATE only means the
	// session will not be extended this request; the next request will
	// retry.
	remaining := time.Until(expires)
	if threshold := time.Duration(float64(s.lifetime) * s.slidingThreshold); threshold > 0 && remaining < threshold {
		newExpiry := time.Now().Add(s.lifetime).UTC().Format(time.RFC3339)
		_, _ = s.db.Exec(`UPDATE sessions SET expires_at = ? WHERE id = ?`, newExpiry, id)
		// Update the in-memory copy so the caller sees the bumped time
		// (used by the session-list UI to display the new expiry).
		if parsed, perr := time.Parse(time.RFC3339, newExpiry); perr == nil {
			expires = parsed
		}
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

// SessionMeta is the client-safe view of a stored session (no token hashes).
type SessionMeta struct {
	ID        string `json:"id"`
	IP        string `json:"ip"`
	UserAgent string `json:"user_agent"`
	CreatedAt string `json:"created_at"`
	ExpiresAt string `json:"expires_at"`
}

// ListForUser returns all live (non-expired) sessions for a user, newest first.
func (s *SessionStore) ListForUser(userID string) ([]SessionMeta, error) {
	rows, err := s.db.Query(
		`SELECT id, ip, user_agent, created_at, expires_at FROM sessions
		 WHERE user_id = ? AND expires_at >= ? ORDER BY created_at DESC`,
		userID, util.NowUTC(),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SessionMeta{}
	for rows.Next() {
		var m SessionMeta
		if err := rows.Scan(&m.ID, &m.IP, &m.UserAgent, &m.CreatedAt, &m.ExpiresAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// DeleteByID revokes one session, scoped to the owning user.
func (s *SessionStore) DeleteByID(id, userID string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE id = ? AND user_id = ?`, id, userID)
	return err
}

// DeleteOthersForUser revokes every session except keepID; returns count.
func (s *SessionStore) DeleteOthersForUser(userID, keepID string) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM sessions WHERE user_id = ? AND id <> ?`, userID, keepID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
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

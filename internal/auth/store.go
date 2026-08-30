package auth

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/util"
)

// Role enumerates authorization roles.
type Role string

const (
	RoleAdmin  Role = "admin"
	RoleUser   Role = "user"
	RoleViewer Role = "viewer"
)

// ErrResetExpired is returned by ConsumeResetToken when the token existed but
// has already passed its expiry time. It is distinct from sql.ErrNoRows
// (returned for an unknown token) so the audit log and the API can tell
// "user typed an old code" from "user typed a wrong code".
var ErrResetExpired = errors.New("auth: reset token expired")

// User is the persisted account record (without the password hash in most
// API responses).
type User struct {
	ID          string
	Username    string
	Email       string
	DisplayName string
	PasswordHash string
	Role        Role
	Status      string // active | disabled
	TOTPSecret  string
	TOTPEnabled bool
	CreatedAt   string
	UpdatedAt   string
}

// UserStore provides user persistence operations.
type UserStore struct{ db *database.DB }

// NewUserStore creates a user store.
func NewUserStore(db *database.DB) *UserStore { return &UserStore{db: db} }

func (s *UserStore) scan(row interface{ Scan(...any) error }) (User, error) {
	var u User
	var totpEnabled int
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.DisplayName, &u.PasswordHash,
		&u.Role, &u.Status, &u.TOTPSecret, &totpEnabled, &u.CreatedAt, &u.UpdatedAt)
	u.TOTPEnabled = totpEnabled == 1
	return u, err
}

// GetByID returns a user by primary key.
func (s *UserStore) GetByID(id string) (User, bool, error) {
	row := s.db.QueryRow(`SELECT id,username,email,display_name,password_hash,role,status,totp_secret,totp_enabled,created_at,updated_at FROM users WHERE id=?`, id)
	u, err := s.scan(row)
	if err == sql.ErrNoRows {
		return User{}, false, nil
	}
	if err != nil {
		return User{}, false, err
	}
	return u, true, nil
}

// GetByUsername returns a user by username or email (case-insensitive on email).
func (s *UserStore) GetByLogin(login string) (User, bool, error) {
	row := s.db.QueryRow(`SELECT id,username,email,display_name,password_hash,role,status,totp_secret,totp_enabled,created_at,updated_at FROM users WHERE username=? OR lower(email)=lower(?)`, login, login)
	u, err := s.scan(row)
	if err == sql.ErrNoRows {
		return User{}, false, nil
	}
	if err != nil {
		return User{}, false, err
	}
	return u, true, nil
}

// Count returns the total number of users (used for first-run detection).
func (s *UserStore) Count() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// NeedsSetup reports whether no admin/user account exists yet.
func (s *UserStore) NeedsSetup() (bool, error) {
	n, err := s.Count()
	return n == 0, err
}

// Create inserts a new user. id/created/updated timestamps are assigned here.
func (s *UserStore) Create(u User) (User, error) {
	if u.ID == "" {
		u.ID = util.NewID("usr_", 16)
	}
	now := util.NowUTC()
	u.CreatedAt = now
	u.UpdatedAt = now
	if u.Role == "" {
		u.Role = RoleUser
	}
	if u.Status == "" {
		u.Status = "active"
	}
	totpEnabled := 0
	if u.TOTPEnabled {
		totpEnabled = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO users(id,username,email,display_name,password_hash,role,status,totp_secret,totp_enabled,created_at,updated_at)
		 VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		u.ID, u.Username, u.Email, u.DisplayName, u.PasswordHash, string(u.Role), u.Status, u.TOTPSecret, totpEnabled, u.CreatedAt, u.UpdatedAt)
	return u, err
}

// UpdatePassword changes a user's password hash and bumps updated_at.
func (s *UserStore) UpdatePassword(id, hash string) error {
	_, err := s.db.Exec(`UPDATE users SET password_hash=?, updated_at=? WHERE id=?`, hash, util.NowUTC(), id)
	return err
}

// UpdateTOTPSecret sets the TOTP secret for a user.
func (s *UserStore) UpdateTOTPSecret(id, secret string) error {
	_, err := s.db.Exec(`UPDATE users SET totp_secret=?, updated_at=? WHERE id=?`, secret, util.NowUTC(), id)
	return err
}

// UpdateTOTPEnabled sets the TOTP enabled flag.
func (s *UserStore) UpdateTOTPEnabled(id string, enabled bool) error {
	v := 0
	if enabled {
		v = 1
	}
	_, err := s.db.Exec(`UPDATE users SET totp_enabled=?, updated_at=? WHERE id=?`, v, util.NowUTC(), id)
	return err
}

// DisableTOTP atomically clears both the TOTP secret and enabled flag in a
// single statement, preventing inconsistent state where totp_enabled is true
// but the secret is empty (which would permanently lock the user out of 2FA).
func (s *UserStore) DisableTOTP(id string) error {
	_, err := s.db.Exec(
		`UPDATE users SET totp_secret='', totp_enabled=0, updated_at=? WHERE id=?`,
		util.NowUTC(), id)
	return err
}

// UpdateRole changes a user's role and status.
func (s *UserStore) UpdateRole(id string, role Role, status string) error {
	_, err := s.db.Exec(`UPDATE users SET role=?, status=?, updated_at=? WHERE id=?`, string(role), status, util.NowUTC(), id)
	return err
}

// List returns all users ordered by creation time.
func (s *UserStore) List() ([]User, error) {
	rows, err := s.db.Query(`SELECT id,username,email,display_name,password_hash,role,status,totp_secret,totp_enabled,created_at,updated_at FROM users ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		u, err := s.scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// IsAuthorized reports whether the user may perform an action given role and
// account status.
func (u User) IsAuthorized() bool {
	return u.Status == "active"
}

// ResetToken represents a one-time password reset token.
type ResetToken struct {
	ID        string
	UserID    string
	TokenHash string
	ExpiresAt string
	CreatedAt string
}

// CreateResetToken stores a hashed reset token with expiry.
func (s *UserStore) CreateResetToken(userID, tokenHash, expiresAt string) error {
	id := util.NewID("rt_", 12)
	_, err := s.db.Exec(`INSERT INTO reset_tokens(id, user_id, token_hash, expires_at, created_at) VALUES(?,?,?,?,?)`,
		id, userID, tokenHash, expiresAt, util.NowUTC())
	return err
}

// ConsumeResetToken looks up a hashed token and returns the user ID if valid
// and not expired. The lookup, expiry check, and deletion are wrapped in a
// single transaction so two concurrent reset requests can never both succeed
// for the same token (race) and an expired token is never silently consumed
// (the old code deleted the row before checking expiry, masking the cause).
//
// The returned error distinguishes "not found" from "expired" so the audit
// log and the user-visible error message stay accurate. Expired tokens are
// still deleted (one-time-use contract); unknown tokens are not.
func (s *UserStore) ConsumeResetToken(tokenHash string) (string, error) {
	// Retry on SQLITE_BUSY / "database is locked" which can happen under
	// concurrent load on SQLite (even with WAL + busy_timeout). The race test
	// fires 16 goroutines at one token; without retry some losers get
	// SQLITE_BUSY instead of the expected sql.ErrNoRows, flaking CI. Production
	// also benefits: a busy from a concurrent writer should be retried, not
	// surfaced as 500. 5 attempts with 10-40ms backoff is enough for the
	// tiny transaction.
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		if attempt > 0 {
			// Exponential backoff with jitter: 10ms, 20ms, 40ms...
			importedTimeSleep := time.Duration(10<<attempt) * time.Millisecond
			if importedTimeSleep > 50*time.Millisecond {
				importedTimeSleep = 50 * time.Millisecond
			}
			time.Sleep(importedTimeSleep)
		}
		userID, err, isBusy := s.consumeResetTokenOnce(tokenHash)
		if !isBusy {
			return userID, err
		}
		lastErr = err
	}
	return "", lastErr
}

func (s *UserStore) consumeResetTokenOnce(tokenHash string) (string, error, bool) {
	tx, err := s.db.Begin()
	if err != nil {
		return "", err, isBusyError(err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	var id, userID, expiresAt string
	err = tx.QueryRow(
		`SELECT id, user_id, expires_at FROM reset_tokens WHERE token_hash=?`, tokenHash,
	).Scan(&id, &userID, &expiresAt)
	if err != nil {
		return "", err, isBusyError(err)
	}

	// Check expiry BEFORE deleting so the audit log can attribute the
	// outcome. If the token is expired we still want to delete it (one-time
	// use), but we return ErrResetExpired instead of the user ID.
	if expiresAt < util.NowUTC() {
		_, _ = tx.Exec(`DELETE FROM reset_tokens WHERE id=?`, id)
		if cerr := tx.Commit(); cerr != nil {
			return "", cerr, isBusyError(cerr)
		}
		committed = true
		return "", ErrResetExpired, false
	}

	// Delete-then-commit is the only safe way to make this single-use: the
	// DELETE is the operation that grants the user the ability to reset.
	// If the commit fails after a successful DELETE, the next attempt will
	// find no row and return sql.ErrNoRows (which callers translate to
	// "invalid token"). Either way the token cannot be used twice.
	res, err := tx.Exec(`DELETE FROM reset_tokens WHERE id=?`, id)
	if err != nil {
		return "", err, isBusyError(err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// Row vanished between SELECT and DELETE; treat as not found rather
		// than silently succeeding.
		return "", fmt.Errorf("reset token not found"), false
	}
	if err := tx.Commit(); err != nil {
		return "", err, isBusyError(err)
	}
	committed = true
	return userID, nil, false
}

func isBusyError(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "database is locked") || strings.Contains(s, "sqlite_busy")
}

// CleanupExpiredResetTokens removes expired reset tokens.
func (s *UserStore) CleanupExpiredResetTokens() error {
	_, err := s.db.Exec(`DELETE FROM reset_tokens WHERE expires_at < ?`, util.NowUTC())
	return err
}

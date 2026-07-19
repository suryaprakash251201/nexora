package auth

import (
	"database/sql"
	"fmt"

	"github.com/nexora/nexora/internal/util"
)

// Role enumerates authorization roles.
type Role string

const (
	RoleAdmin  Role = "admin"
	RoleUser   Role = "user"
	RoleViewer Role = "viewer"
)

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
type UserStore struct{ db *sql.DB }

// NewUserStore creates a user store.
func NewUserStore(db *sql.DB) *UserStore { return &UserStore{db: db} }

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

// ConsumeResetToken looks up a hashed token and returns the user ID if valid and not expired.
// Deletes the token after successful lookup (one-time use).
func (s *UserStore) ConsumeResetToken(tokenHash string) (string, error) {
	var id, userID, expiresAt string
	err := s.db.QueryRow(`SELECT id, user_id, expires_at FROM reset_tokens WHERE token_hash=?`, tokenHash).Scan(&id, &userID, &expiresAt)
	if err != nil {
		return "", err
	}
	// Delete regardless (one-time use).
	_, _ = s.db.Exec(`DELETE FROM reset_tokens WHERE id=?`, id)
	if expiresAt < util.NowUTC() {
		return "", fmt.Errorf("reset token expired")
	}
	return userID, nil
}

// CleanupExpiredResetTokens removes expired reset tokens.
func (s *UserStore) CleanupExpiredResetTokens() error {
	_, err := s.db.Exec(`DELETE FROM reset_tokens WHERE expires_at < ?`, util.NowUTC())
	return err
}

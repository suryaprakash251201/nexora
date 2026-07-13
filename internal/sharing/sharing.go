// Package sharing implements secure, expiring share links with optional
// password protection (Argon2id), optional download-count caps, revocation,
// and scoped access (download-only or preview+download). Share pages never
// reveal server filesystem paths.
package sharing

import (
	"database/sql"
	"errors"
	"time"

	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/util"
)

// Errors returned by the sharing store.
var (
	ErrNotFound     = errors.New("sharing: not found")
	ErrExpired      = errors.New("sharing: link expired")
	ErrExhausted    = errors.New("sharing: download limit reached")
	ErrPassword     = errors.New("sharing: password required or incorrect")
	ErrRevoked      = errors.New("sharing: link revoked")
)

// Scope controls what a share allows.
type Scope string

const (
	ScopeDownload Scope = "download" // download only
	ScopePreview  Scope = "preview"  // preview + download
)

// Share is a stored share link.
type Share struct {
	ID            string    `json:"id"`
	Token         string    `json:"token"`
	UserID        string    `json:"user_id"`
	RootID        string    `json:"root_id"`
	Path          string    `json:"path"`
	Scope         Scope     `json:"scope"`
	HasPassword   bool      `json:"has_password"`
	ExpiresAt     *string   `json:"expires_at"`
	MaxDownloads  int       `json:"max_downloads"`
	DownloadCount int       `json:"download_count"`
	CreatedAt     string    `json:"created_at"`

	passwordHash string
}

// CreateInput describes a new share.
type CreateInput struct {
	UserID       string
	RootID       string
	Path         string
	Scope        Scope
	Password     string     // optional plaintext; hashed if provided
	ExpiresAt    *time.Time // optional
	MaxDownloads int        // 0 = unlimited
}

// Store persists shares.
type Store struct{ db *sql.DB }

// NewStore constructs a sharing store.
func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// Create inserts a new share and returns it (including the secret token).
func (s *Store) Create(in CreateInput) (Share, error) {
	if in.Scope != ScopePreview {
		in.Scope = ScopeDownload
	}
	sh := Share{
		ID:           util.NewID("shr_", 12),
		Token:        util.RandToken(24), // 48 hex chars, cryptographically secure
		UserID:       in.UserID,
		RootID:       in.RootID,
		Path:         in.Path,
		Scope:        in.Scope,
		MaxDownloads: in.MaxDownloads,
		CreatedAt:    util.NowUTC(),
	}
	if in.Password != "" {
		h, err := auth.HashPassword(in.Password)
		if err != nil {
			return Share{}, err
		}
		sh.passwordHash = h
		sh.HasPassword = true
	}
	var expires any
	if in.ExpiresAt != nil {
		v := in.ExpiresAt.UTC().Format(time.RFC3339)
		sh.ExpiresAt = &v
		expires = v
	}
	_, err := s.db.Exec(
		`INSERT INTO shares(id,token,user_id,root_id,path,scope,password_hash,expires_at,max_downloads,download_count,created_at)
		 VALUES(?,?,?,?,?,?,?,?,?,0,?)`,
		sh.ID, sh.Token, sh.UserID, sh.RootID, sh.Path, string(sh.Scope), sh.passwordHash, expires, sh.MaxDownloads, sh.CreatedAt)
	if err != nil {
		return Share{}, err
	}
	return sh, nil
}

func (s *Store) scan(row interface {
	Scan(...any) error
}) (Share, error) {
	var sh Share
	var scope string
	var expires sql.NullString
	if err := row.Scan(&sh.ID, &sh.Token, &sh.UserID, &sh.RootID, &sh.Path, &scope,
		&sh.passwordHash, &expires, &sh.MaxDownloads, &sh.DownloadCount, &sh.CreatedAt); err != nil {
		return Share{}, err
	}
	sh.Scope = Scope(scope)
	sh.HasPassword = sh.passwordHash != ""
	if expires.Valid {
		v := expires.String
		sh.ExpiresAt = &v
	}
	return sh, nil
}

const selectCols = `id,token,user_id,root_id,path,scope,password_hash,expires_at,max_downloads,download_count,created_at`

// GetByToken fetches a share by its public token.
func (s *Store) GetByToken(token string) (Share, error) {
	row := s.db.QueryRow(`SELECT `+selectCols+` FROM shares WHERE token=?`, token)
	sh, err := s.scan(row)
	if err == sql.ErrNoRows {
		return Share{}, ErrNotFound
	}
	return sh, err
}

// ListForUser returns shares created by a user (admins may pass isAdmin to see all).
func (s *Store) ListForUser(userID string, isAdmin bool, limit, offset int) ([]Share, error) {
	q := `SELECT ` + selectCols + ` FROM shares`
	args := []any{}
	if !isAdmin {
		q += ` WHERE user_id=?`
		args = append(args, userID)
	}
	q += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`
	args = append(args, limit, offset)
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Share
	for rows.Next() {
		sh, err := s.scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

// Revoke deletes a share. Non-admins may only revoke their own.
func (s *Store) Revoke(id, userID string, isAdmin bool) error {
	var res sql.Result
	var err error
	if isAdmin {
		res, err = s.db.Exec(`DELETE FROM shares WHERE id=?`, id)
	} else {
		res, err = s.db.Exec(`DELETE FROM shares WHERE id=? AND user_id=?`, id, userID)
	}
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Access validates a share for public use: checks revocation (existence),
// expiry, download cap, and password. Returns the share on success.
func (s *Store) Access(token, password string) (Share, error) {
	sh, err := s.GetByToken(token)
	if err != nil {
		return Share{}, err
	}
	if sh.ExpiresAt != nil {
		if exp := util.ParseTime(*sh.ExpiresAt); !exp.IsZero() && time.Now().After(exp) {
			return Share{}, ErrExpired
		}
	}
	if sh.MaxDownloads > 0 && sh.DownloadCount >= sh.MaxDownloads {
		return Share{}, ErrExhausted
	}
	if sh.passwordHash != "" {
		if password == "" || !auth.VerifyPassword(password, sh.passwordHash) {
			return Share{}, ErrPassword
		}
	}
	return sh, nil
}

// IncrementDownload atomically bumps the download counter, enforcing the cap.
func (s *Store) IncrementDownload(id string) error {
	_, err := s.db.Exec(`UPDATE shares SET download_count = download_count + 1 WHERE id=?`, id)
	return err
}

// PurgeExpired removes shares past their expiry (maintenance).
func (s *Store) PurgeExpired() (int64, error) {
	res, err := s.db.Exec(`DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < ?`, util.NowUTC())
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

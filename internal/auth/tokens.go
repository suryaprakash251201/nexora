// Personal API tokens: long-lived bearer credentials for scripting and API
// access. Only SHA-256 hashes are stored; the raw token (prefixed "nxr_") is
// returned exactly once at creation. Tokens are user-scoped and revocable.
package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/nexora/nexora/internal/database"
	"github.com/nexora/nexora/internal/util"
)

type TokenStore struct{ db *database.DB }

func NewTokenStore(db *database.DB) *TokenStore { return &TokenStore{db: db} }

// TokenInfo is the client-safe view of a stored token (no hashes).
type TokenInfo struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	CreatedAt  string  `json:"created_at"`
	LastUsedAt *string `json:"last_used_at,omitempty"`
	ExpiresAt  *string `json:"expires_at,omitempty"`
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// Create mints a new token for the user. expiresAt zero-value = never.
// Returns the raw token, which is not stored in plaintext anywhere.
func (t *TokenStore) Create(userID, name string, expiresAt time.Time) (string, error) {
	raw := "nxr_" + util.RandToken(24)
	expiresStr := ""
	if !expiresAt.IsZero() {
		expiresStr = expiresAt.UTC().Format(time.RFC3339)
	}
	if _, err := t.db.Exec(
		`INSERT INTO api_tokens(id, user_id, name, token_hash, created_at, last_used_at, expires_at)
		 VALUES(?,?,?,?,?,NULL,NULLIF(?, ''))`,
		util.NewID("tok_", 12), userID, name, hashToken(raw), util.NowUTC(), expiresStr,
	); err != nil {
		return "", err
	}
	return raw, nil
}

// List returns the user's tokens, newest first.
func (t *TokenStore) List(userID string) ([]TokenInfo, error) {
	rows, err := t.db.Query(
		`SELECT id, name, created_at, last_used_at, expires_at FROM api_tokens
		 WHERE user_id = ? ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TokenInfo{}
	for rows.Next() {
		var ti TokenInfo
		var lastUsed, expires *string
		if err := rows.Scan(&ti.ID, &ti.Name, &ti.CreatedAt, &lastUsed, &expires); err != nil {
			return nil, err
		}
		ti.LastUsedAt = lastUsed
		ti.ExpiresAt = expires
		out = append(out, ti)
	}
	return out, rows.Err()
}

// Delete removes one token, scoped to the owning user.
func (t *TokenStore) Delete(id, userID string) error {
	_, err := t.db.Exec(`DELETE FROM api_tokens WHERE id = ? AND user_id = ?`, id, userID)
	return err
}

// Lookup resolves a raw bearer token to its owning userID. Expired or
// unknown tokens return ok=false. Updates last_used_at best-effort.
func (t *TokenStore) Lookup(raw string) (userID string, ok bool) {
	var expires *string
	err := t.db.QueryRow(
		`SELECT user_id, expires_at FROM api_tokens WHERE token_hash = ?`, hashToken(raw),
	).Scan(&userID, &expires)
	if err != nil {
		return "", false
	}
	if expires != nil && *expires != "" && util.ParseTime(*expires).Before(time.Now()) {
		return "", false
	}
	_, _ = t.db.Exec(`UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?`, util.NowUTC(), hashToken(raw))
	return userID, true
}

-- Personal API tokens: long-lived, user-scoped bearer credentials for
-- scripting and API access. Only the SHA-256 hash is stored; the raw token
-- is shown once at creation.
CREATE TABLE IF NOT EXISTS api_tokens (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL DEFAULT '',
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL,
    last_used_at TEXT,
    expires_at   TEXT -- NULL = never expires
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

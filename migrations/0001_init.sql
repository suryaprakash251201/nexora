-- Nexora initial schema
-- SQLite, WAL mode enabled at runtime by the database layer.

PRAGMA foreign_keys = ON;

-- Users -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user', -- admin | user | viewer
    status        TEXT NOT NULL DEFAULT 'active', -- active | disabled
    totp_secret   TEXT NOT NULL DEFAULT '',
    totp_enabled  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Sessions ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    ip         TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Storage roots -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS storage_roots (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    path       TEXT NOT NULL,          -- absolute host path
    read_only  INTEGER NOT NULL DEFAULT 0,
    enabled    INTEGER NOT NULL DEFAULT 1,
    indexed    INTEGER NOT NULL DEFAULT 1, -- participate in search indexing
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Per-user root permissions ----------------------------------------------
CREATE TABLE IF NOT EXISTS user_roots (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    root_id     TEXT NOT NULL REFERENCES storage_roots(id) ON DELETE CASCADE,
    permission  TEXT NOT NULL DEFAULT 'read', -- read | write
    PRIMARY KEY (user_id, root_id)
);

-- Shares ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shares (
    id              TEXT PRIMARY KEY,
    token           TEXT NOT NULL UNIQUE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    root_id         TEXT NOT NULL REFERENCES storage_roots(id) ON DELETE CASCADE,
    path            TEXT NOT NULL,
    scope           TEXT NOT NULL DEFAULT 'download', -- download | preview
    password_hash   TEXT NOT NULL DEFAULT '',
    expires_at      TEXT, -- NULL = never
    max_downloads   INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited
    download_count  INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);

-- Audit log ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL DEFAULT '',
    action     TEXT NOT NULL,
    target     TEXT NOT NULL DEFAULT '',
    ip         TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_logs(user_id, created_at);

-- Favorites ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorites (
    user_id TEXT NOT NULL,
    root_id TEXT NOT NULL,
    path    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, root_id, path)
);

-- Recents -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recents (
    user_id TEXT NOT NULL,
    root_id TEXT NOT NULL,
    path    TEXT NOT NULL,
    accessed_at TEXT NOT NULL,
    PRIMARY KEY (user_id, root_id, path)
);

-- Search index (lightweight metadata) ------------------------------------
CREATE TABLE IF NOT EXISTS search_index (
    id       TEXT PRIMARY KEY,
    root_id  TEXT NOT NULL,
    path     TEXT NOT NULL,    -- relative path within root
    name     TEXT NOT NULL,
    ext      TEXT NOT NULL DEFAULT '',
    size     INTEGER NOT NULL DEFAULT 0,
    is_dir   INTEGER NOT NULL DEFAULT 0,
    mime     TEXT NOT NULL DEFAULT '',
    modified TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_root_path ON search_index(root_id, path);
CREATE INDEX IF NOT EXISTS idx_search_name ON search_index(name);
CREATE INDEX IF NOT EXISTS idx_search_ext ON search_index(ext);

-- Background jobs ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL, -- archive | extract | scan
    status     TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed
    user_id    TEXT NOT NULL DEFAULT '',
    root_id    TEXT NOT NULL DEFAULT '',
    payload    TEXT NOT NULL DEFAULT '{}',
    progress   REAL NOT NULL DEFAULT 0,
    error      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- Settings (setup state, version, misc) -----------------------------------
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

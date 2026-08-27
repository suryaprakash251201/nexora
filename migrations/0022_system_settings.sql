-- System settings: DB-backed overrides for NEXORA_* env vars.
-- Each row overrides one env default at runtime (admin console).
-- Keys are snake_case without the NEXORA_ prefix (e.g. "session_lifetime").
CREATE TABLE IF NOT EXISTS system_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT ''
);

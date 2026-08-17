-- Persisted webhook targets for the event bus.
CREATE TABLE IF NOT EXISTS webhooks (
    id         TEXT PRIMARY KEY,
    url        TEXT NOT NULL,
    secret     TEXT NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    events     TEXT NOT NULL DEFAULT '', -- comma-separated event types; empty = all
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhooks_url ON webhooks(url);

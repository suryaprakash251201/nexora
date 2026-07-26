-- Saved Searches (Smart Folders)
CREATE TABLE IF NOT EXISTS saved_searches (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    query       TEXT NOT NULL,
    filters     TEXT NOT NULL DEFAULT '{}',
    sort        TEXT NOT NULL DEFAULT 'name',
    sort_order  TEXT NOT NULL DEFAULT 'asc',
    root_id     TEXT,
    icon        TEXT,
    color       TEXT,
    is_pinned   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_pinned ON saved_searches(user_id, is_pinned DESC, name);
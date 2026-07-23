-- Tags & Labels system
CREATE TABLE IF NOT EXISTS tags (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_user_name ON tags(user_id, name);

CREATE TABLE IF NOT EXISTS file_tags (
    tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    root_id    TEXT NOT NULL,
    path       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tag_id, root_id, path)
);

CREATE INDEX IF NOT EXISTS idx_file_tags_path ON file_tags(root_id, path);

-- File comments: a small discussion thread attached to a file/folder path
-- within a root. Username is denormalized for display (no join at read time).
-- Comments are keyed by path, so renaming a file starts a fresh thread (v1).
CREATE TABLE IF NOT EXISTS file_comments (
    id         TEXT PRIMARY KEY,
    root_id    TEXT NOT NULL,
    path       TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    username   TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_comments_file ON file_comments(root_id, path);

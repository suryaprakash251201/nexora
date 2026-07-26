-- File Versioning System
CREATE TABLE IF NOT EXISTS file_versions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    root_id     TEXT NOT NULL,
    path        TEXT NOT NULL,
    version     INTEGER NOT NULL,
    size        INTEGER NOT NULL,
    checksum    TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    stored_path TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_versions_file ON file_versions(root_id, path);
CREATE INDEX IF NOT EXISTS idx_versions_user ON file_versions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_unique ON file_versions(root_id, path, version);

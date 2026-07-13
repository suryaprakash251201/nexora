-- Trash / recycle-bin entries (per-root, stored within each root under
-- .nexora-trash so files never leave their authorized root).
CREATE TABLE IF NOT EXISTS trash (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    root_id       TEXT NOT NULL,
    original_path TEXT NOT NULL,   -- relative path within root before deletion
    trash_path    TEXT NOT NULL,   -- relative path inside .nexora-trash
    name          TEXT NOT NULL,
    size          INTEGER NOT NULL DEFAULT 0,
    is_dir        INTEGER NOT NULL DEFAULT 0,
    deleted_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trash_user ON trash(user_id);
CREATE INDEX IF NOT EXISTS idx_trash_root ON trash(root_id);

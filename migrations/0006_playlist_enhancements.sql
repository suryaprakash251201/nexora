-- Playlist enhancements: cover image, public flag, duplicate prevention, collaborators.

ALTER TABLE playlists ADD COLUMN cover_root_id TEXT DEFAULT '';
ALTER TABLE playlists ADD COLUMN cover_path TEXT DEFAULT '';
ALTER TABLE playlists ADD COLUMN is_public INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_items_unique ON playlist_items(playlist_id, root_id, path);

CREATE TABLE IF NOT EXISTS playlist_collaborators (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'editor',
    created_at  TEXT NOT NULL,
    PRIMARY KEY (playlist_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_collab_user ON playlist_collaborators(user_id);

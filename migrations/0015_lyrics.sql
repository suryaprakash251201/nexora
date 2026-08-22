-- Synced lyrics for audio files.
-- One row per (root_id, path) of the audio file. Lyrics are sourced either
-- automatically from a sibling .lrc file (source = 'auto') or saved/edited by a
-- user (source = 'user'). A user-saved row always takes precedence over the
-- auto-detected sibling file.

CREATE TABLE IF NOT EXISTS lyrics (
    id         TEXT PRIMARY KEY,
    root_id    TEXT NOT NULL,
    path       TEXT NOT NULL,
    raw        TEXT NOT NULL DEFAULT '',
    format     TEXT NOT NULL DEFAULT 'lrc', -- lrc | plain
    source     TEXT NOT NULL DEFAULT 'auto', -- auto | user
    updated_at TEXT NOT NULL,
    UNIQUE (root_id, path)
);

CREATE INDEX IF NOT EXISTS idx_lyrics_root_path ON lyrics(root_id, path);

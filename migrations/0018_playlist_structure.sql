-- Playlist structure v2: descriptions and stable manual ordering.
--
-- description  — free-form text shown on the playlist header/detail page.
-- position     — explicit per-playlist sort order for tracks. NULL rows (legacy
--                or items inserted before this migration) fall back to
--                created_at ordering, so nothing breaks mid-rollout.

ALTER TABLE playlists ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE playlist_items ADD COLUMN position INTEGER;

-- Backfill positions preserving the historical created_at order. Window
-- functions work in both SQLite (3.25+) and PostgreSQL.
UPDATE playlist_items SET position = (
    SELECT rn FROM (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY playlist_id
            ORDER BY created_at ASC, id ASC
        ) AS rn
        FROM playlist_items
    ) ranked
    WHERE ranked.id = playlist_items.id
);

CREATE INDEX IF NOT EXISTS idx_playlist_items_order ON playlist_items(playlist_id, position);

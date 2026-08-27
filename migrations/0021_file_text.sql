-- Full-text content index for search ("search inside files").
--
-- One row per indexed file, keyed like the rest of the workspace by
-- (root_id, path). `text` holds extracted content (PDF text layer, plain-text
-- file bodies, or OCR output for images); it is capped per file (see
-- NEXORA_EXTRACT_MAX_TEXT) so a giant file never floods the database.
--
-- Search matches with LIKE/EXISTS rather than SQLite FTS5 or Postgres
-- tsvector so the same query works on both dialects without the dialect
-- wrapper needing to translate full-text syntax.

CREATE TABLE IF NOT EXISTS file_text (
    root_id    TEXT NOT NULL,
    path       TEXT NOT NULL,
    ext        TEXT NOT NULL DEFAULT '',
    text       TEXT NOT NULL DEFAULT '',
    length     INTEGER NOT NULL DEFAULT 0,  -- character count (pre-truncation)
    updated_at TEXT NOT NULL,
    PRIMARY KEY (root_id, path)
);

CREATE INDEX IF NOT EXISTS idx_file_text_updated ON file_text(updated_at);
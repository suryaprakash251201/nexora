-- Add media_metadata table for Photo Timeline
CREATE TABLE IF NOT EXISTS media_metadata (
    id TEXT PRIMARY KEY REFERENCES search_index(id) ON DELETE CASCADE,
    date_taken TEXT,
    lat REAL,
    lng REAL,
    make TEXT,
    model TEXT,
    width INTEGER,
    height INTEGER
);

CREATE INDEX IF NOT EXISTS idx_media_date ON media_metadata(date_taken);

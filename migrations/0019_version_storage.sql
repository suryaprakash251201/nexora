-- File versioning: provider-aware storage and retention helpers.
--
-- The original `file_versions` table (migration 0010) was wired to a
-- single local-filesystem directory (`stored_path`). That broke S3 roots
-- and the "version" stream on restore for any non-local backend.
--
-- This migration:
--   1. Adds `storage_kind` ('local' | 'provider') and `storage_key` so a
--      version snapshot can either live in the same provider as the file
--      (the cheap, preferred path) or in the legacy local versions dir
--      (kept for backwards-compat reads of pre-migration rows).
--   2. Adds `auto` to distinguish automatic snapshots (taken on overwrite)
--      from user-initiated ones.
--   3. Adds `checksum_alg` (sha256 today) and indexes used by retention.
--   4. Creates a `version_settings` singleton row used by the retention
--      job to record when it last ran (idempotent, cheap observability).

-- 1) Extend the table.
ALTER TABLE file_versions ADD COLUMN storage_kind TEXT NOT NULL DEFAULT 'local';
ALTER TABLE file_versions ADD COLUMN storage_key  TEXT NOT NULL DEFAULT '';
ALTER TABLE file_versions ADD COLUMN auto         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE file_versions ADD COLUMN checksum_alg TEXT NOT NULL DEFAULT 'sha256';

-- 2) Backfill `storage_key` from the legacy `stored_path` column for any
--    pre-existing rows so reads keep working. New rows always populate it.
UPDATE file_versions
   SET storage_key = stored_path
 WHERE storage_key = '' AND stored_path != '';

-- 3) Indexes used by retention sweeps and listing.
CREATE INDEX IF NOT EXISTS idx_versions_created    ON file_versions(created_at);
CREATE INDEX IF NOT EXISTS idx_versions_user_time ON file_versions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_versions_root_path_version
    ON file_versions(root_id, path, version DESC);

-- 4) Retention bookkeeping.
CREATE TABLE IF NOT EXISTS version_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

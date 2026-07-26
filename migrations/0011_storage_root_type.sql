-- Add type and config columns to storage_roots for multi-provider support.
-- type: 'local' (default) or 's3'
-- config: JSON string with provider-specific settings (S3 credentials, etc.)
ALTER TABLE storage_roots ADD COLUMN type TEXT NOT NULL DEFAULT 'local';
ALTER TABLE storage_roots ADD COLUMN config TEXT NOT NULL DEFAULT '{}';

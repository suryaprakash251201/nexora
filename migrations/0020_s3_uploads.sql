-- S3-compatible gateway: multipart upload bookkeeping.
--
-- S3 clients (rclone, aws cli, Cyberduck) upload large objects in parts via
-- CreateMultipartUpload / UploadPart / CompleteMultipartUpload. Part bytes
-- are staged inside the file's own storage provider under the hidden
-- `.nexora-mpu/<upload_id>/<part_number>` namespace; this table tracks the
-- mapping from upload id to destination (root + key), the owning user, and
-- the per-part ETags so a restarted server can still complete/abort a
-- pending upload.

CREATE TABLE IF NOT EXISTS s3_uploads (
    id         TEXT PRIMARY KEY,           -- the S3 UploadId
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    root_id    TEXT NOT NULL,
    key        TEXT NOT NULL,              -- destination object key (root-relative path)
    etags      TEXT NOT NULL DEFAULT '{}', -- JSON object: {"<partNumber>": "<etag>"}
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_s3_uploads_user ON s3_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_s3_uploads_root ON s3_uploads(root_id);
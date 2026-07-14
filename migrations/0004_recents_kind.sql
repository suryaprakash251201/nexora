-- Track whether a recent entry was added (upload/create) or merely accessed,
-- so the Home view can show "Newly added" separately from "Recently viewed".
ALTER TABLE recents ADD COLUMN kind TEXT NOT NULL DEFAULT 'access';

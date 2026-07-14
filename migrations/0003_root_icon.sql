-- Add a customizable icon (lucide icon name) to storage roots.
ALTER TABLE storage_roots ADD COLUMN icon TEXT NOT NULL DEFAULT '';

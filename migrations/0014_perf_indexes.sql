-- Performance indexes for dashboard / home queries.
--
-- Home sections (recentItems / homeSection) filter recents by
-- (user_id, kind) and order by accessed_at DESC with a LIMIT; without an
-- index this is a filesort over every row the user has. The index makes
-- the dashboard "recently opened / added / documents / music / video"
-- sections O(limit).
CREATE INDEX IF NOT EXISTS idx_recents_user_kind_time
    ON recents(user_id, kind, accessed_at);

-- /home/usage computes the storage breakdown via
-- `WHERE is_dir = 0 GROUP BY mime, ext` over search_index. A full table
-- scan on a large library is wasteful; this index serves the grouping.
CREATE INDEX IF NOT EXISTS idx_search_is_dir_mime_ext
    ON search_index(is_dir, mime, ext);
# API Reference

Base: `/api/v1` (versioned), health at `/healthz` + `/readyz`. Full source of truth: [internal/api/server.go](../internal/api/server.go). All timestamps are RFC 3339 (UTC). Pagination defaults: `limit` 500 (max 5000), `offset` 0; many endpoints return `{has_more}` or cursor.

## Auth

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `POST` | `/api/v1/auth/setup` | None | First-run admin creation; also `EnsureDefaultRoots`. CSRF-exempt. |
| `GET` | `/api/v1/auth/needs-setup` | None | `{configured: bool}` |
| `POST` | `/api/v1/auth/login` | None, rate-limited | `{login,password,totp_code?}`. Lockout 5/15m, TOTP branching may return `{totp_required:true, temp_token}` |
| `POST` | `/api/v1/auth/tailscale` | None | Reads `Tailscale-User-Login` header; auto-provisions `user` role when `TAILSCALE_AUTH=true` |
| `POST` | `/api/v1/auth/forgot-password` | None | `{login}` → creates `reset_token` (sha256, 15m, one-time) |
| `POST` | `/api/v1/auth/reset-password` | None | `{token, new_password}` → invalidates sessions via `DeleteAllForUser` |
| `POST` | `/api/v1/auth/password` | None (pre-auth) + authed | Change password variant |
| `GET` | `/api/v1/auth/session` | None (returns 401 if not authed) | Current user |
| `POST` | `/api/v1/auth/logout` | Auth | Clears `nexora_session` cookie + `Delete(token)` |
| `POST` | `/api/v1/auth/totp/setup` | Auth | `GenerateTOTPSetup` → `{secret, url}` |
| `POST` | `/api/v1/auth/totp/verify` | Auth | Enable TOTP |
| `POST` | `/api/v1/auth/totp/disable` | Auth | Disable |
| `POST` | `/api/v1/auth/totp/verify-login` | None, rate-limited | TOTP second factor with temp token |
| `GET/POST` | `/api/v1/csrf` | Cookie-bound | Issues `nexora_csrf` cookie; client sends `X-CSRF-Token` on mutations |

Sessions: `RandToken(32)` SHA-256 at rest, HTTP-only `SameSite=Strict`, `168h` lifetime. CSRF is double-submit (exempt: `/healthz /readyz /auth/setup /auth/login /auth/tailscale /auth/forgot /auth/reset /auth/totp/verify-login /api/v1/share /api/v1/csrf`).

## Public Shares (no auth, rate-limited)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/share/{token}` | `{has_password, expires_at, max_downloads, scope}` |
| `POST` | `/api/v1/share/{token}/verify` | Body `{password}` or header `X-Share-Password` (query `?p=` also accepted but discouraged) |
| `GET` | `/api/v1/share/{token}/download` | 200 ZIP/file, increments `max_downloads`, respects expiry/cap/password |
| `GET` | `/api/v1/share/{token}/raw` | Inline when `scope=preview` |

Share `POST /shares` creates `token` 48-hex + optional password (Argon2id), expiry, cap.

## Files & Storage

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/roots` | User-visible roots (permission-filtered) |
| `GET` | `/api/v1/files?root=&path=&sort=name&order=asc&dirs_first=&offset=&limit=&search=&ext=` | Listing, `search_index`-backed when search params present. Hides `.nexora-trash`. |
| `GET` | `/api/v1/files/stat?root=&path=` | Single stat |
| `POST` | `/api/v1/files/directory` | `{root, path, name}` |
| `POST` | `/api/v1/files/file` | Create empty file `{root, path, name, content?}` |
| `GET` | `/api/v1/files/content?root=&path=` | Text content (≤5 MB, NUL rejected, truncation at 400 kB for display) |
| `POST` | `/api/v1/files/save` | `{root, path, content, version}` optimistic `modified` check |
| `GET` | `/api/v1/files/metadata?root=&path=` | `{size, modified, mime, dimensions, editable}` |
| `GET` | `/api/v1/files/checksum?root=&path=` | `{sha256}` |
| `GET` | `/api/v1/files/thumbnail?root=&path=&size=256` | JPEG thumb (cache + `PurgeStale`) |
| `GET` | `/api/v1/files/raw?root=&path=` | Raw bytes with `Accept-Ranges: bytes` + S3/local streaming |
| `GET` | `/api/v1/files/download?root=&path=` | `Content-Disposition: attachment` single file |
| `POST` | `/api/v1/files/upload` | Multipart `files[]` + `root`+`path` fields; spool temp on large bodies |
| `POST` | `/api/v1/files/rename` | `{root, path, new_name}` |
| `POST` | `/api/v1/files/move` | `{root, src, dst}` (cross-root via Copy+Delete) |
| `POST` | `/api/v1/files/copy` | Same |
| `DELETE` | `/api/v1/files?root=&path=` | → trash `Move(.nexora-trash/<ts>_<name>)` + `INSERT trash_entries` + `search.Remove` |
| `GET` | `/api/v1/files/transcode?root=&path=&format=mp4&quality=high&start=0&session=uuid` | Frag-MP4; `session` lets seek kill prior ffmpeg |
| `GET` | `/api/v1/files/hls/playlist.m3u8?root=&path=&session=` | `EXTM3U` 10 s `mpegts` |
| `GET` | `/api/v1/files/hls/segment.ts?root=&path=&session=&seq=` | Segment (skeleton) |
| `GET` | `/api/v1/files/duplicates?root=&path=` | Groups by SHA-256 |
| `GET` | `/api/v1/stats?root=` | Per-root size/count by mime category |

`POST /files/upload` respects `NEXORA_MAX_UPLOAD_SIZE` (validated) + `NEXORA_ALLOWED_MIME` CSV.

## Audio

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/v1/audio/info?root=&path=` | `ffprobe` codec/sampleRate/bitDepth/channels/tags + `losslessCodecs` map |
| `GET` | `/api/v1/audio/formats` | Caps table (`libx264 veryfast crf23 yuv420p` vs `copy`, AAC 128/192/320k, `flac/flac24/wav`) |
| `GET` | `/api/v1/audio/lyrics?root=&path=` | `{has_lyrics, raw, format:lrc|plain, source, synced, cues:[{time,text}]}` — auto `.lrc` sibling |
| `POST` | `/api/v1/audio/lyrics` | `{root, path, lyrics}` |
| `DELETE` | `/api/v1/audio/lyrics?root=&path=` | |

## Trash

| Method | Path |
|--------|------|
| `GET` | `/api/v1/trash?limit=&offset=` |
| `POST` | `/api/v1/trash/restore` `{id}` or `{root,path}` variants |
| `DELETE` | `/api/v1/trash?id=&root=&path=` |

Trash rows live at `trash_entries(user_id,root_id,path,original_path,size,expires)` and physically at `<root>/.nexora-trash/`.

## Search & Media

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/v1/search?q=&ext=&kind=&sort=relevance&path=&min_size=&max_size=&modified_after=&modified_before=&root=&limit=&offset=` | Root allow-list, kind→ext, ILIKE, 500k cap, skips trash/symlinks |
| `GET` | `/api/v1/photos?year=&month=&make=&has_location=&favorites_only=&date_from=&date_to=&sort=&limit=&cursor=` | Cursor pagination, facets `years/cameras/locations`, `COALESCE(exif,modified)` |
| `GET` | `/api/v1/saved-searches` | |
| `POST` | `/api/v1/saved-searches` | `{name, query_json}` (stored JSON) |
| `PUT` | `/api/v1/saved-searches/{id}` | |
| `DELETE` | `/api/v1/saved-searches/{id}` | |
| `GET` | `/api/v1/saved-searches/{id}/execute?root=&limit=&offset=` | Runs stored query (validates root allow-list) |

## Playlists

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/v1/playlists` | User-scoped + `is_owner/can_edit/owner_username` hydrated |
| `POST` | `/api/v1/playlists` | `{name, is_public?, cover_root_id?, cover_path?}` |
| `DELETE` | `/api/v1/playlists/{id}` | |
| `PUT` | `/api/v1/playlists/{id}` | Rename |
| `PATCH` | `/api/v1/playlists/{id}` | Meta/public/cover |
| `POST` | `/api/v1/playlists/{id}/items` | `{items:[{root_id,path}]}` `INSERT OR IGNORE` |
| `DELETE` | `/api/v1/playlists/{id}/items` | `{root_id,path}` or `item_id` |
| `GET` | `/api/v1/playlists/cover-config` | Scoring/paths |
| `GET` | `/api/v1/playlists/public` | |
| `POST` | `/api/v1/playlists/{id}/collaborators` | `{user_id, role:editor}` |
| `GET` | `/api/v1/playlists/{id}/collaborators` | Leaked usernames — admin filter planned |
| `GET` | `/api/v1/users/search?q=` | Directory for collaborator picker |

## Jobs (Archive / Extract)

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/v1/archive` | `{root, paths[], name}` → `{job_id}` (async, ZIP streaming) |
| `POST` | `/api/v1/extract` | `{root, path, dest?}` → `{job_id}` (zip-slip 5 checks) |
| `GET` | `/api/v1/jobs?limit=` | User-scoped list |
| `GET` | `/api/v1/jobs/{id}` | Status `pending|running|done|failed`, `progress` 0–1 |
| `GET` | `/api/v1/jobs/{id}/events` | SSE `Subscribe` (text/event-stream) |
| `GET` | `/api/v1/jobs/{id}/download` | `data/cache/archives/<job>.zip` |

Queue bounded (128); when full the job is persisted as `failed` immediately.

## Favorites, Recents, Home

| Method | Path |
|--------|------|
| `GET/POST/DELETE` | `/api/v1/favorites` `?root=&path=` (per-user `user_id,root_id,path`) |
| `GET` | `/api/v1/recents?limit=` (per-user, kinds `access/add`) |
| `GET` | `/api/v1/home` `{recent,added,documents,music,video,playlists}` |
| `GET` | `/api/v1/home/usage` (quota + search_index GROUP BY — note: GROUP BY was global, scoped fix planned) |

## Tags, Versions, Analytics

| Method | Path |
|--------|------|
| `GET/POST` | `/api/v1/tags` `{name,color}` (per-user) |
| `POST/DELETE` | `/api/v1/files/tag` `{root,path,tag_id}` batch |
| `GET` | `/api/v1/files/versions?root=&path=` |
| `POST` | `/api/v1/files/versions` `{root,path,note?}` → copies to `data/versions/<id>`, SHA-256 |
| `POST` | `/api/v1/files/versions/{id}/restore` |
| `DELETE` | `/api/v1/files/versions/{id}` |
| `GET` | `/api/v1/stats` (alias) |

## Shares (management), Webhooks, Admin

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET/POST/DELETE` | `/api/v1/shares` (`/shares/{id}` for revoke) | Auth | `{root,path,scope,pw,expiresAt,maxDownloads}` |
| `GET/POST/DELETE` | `/api/v1/webhooks` | `POST/DELETE` admin-only | `List` is currently any-auth (secret considered — restrict to admin planned) |
| `GET` | `/api/v1/admin/roots` | Admin | |
| `POST/PUT/DELETE` | `/api/v1/admin/roots` | Admin | |
| `GET/POST/PUT/DELETE` | `/api/v1/admin/users` | Admin | |
| `GET/POST/DELETE` | `/api/v1/admin/users/{id}/roots` | Admin | |
| `GET` | `/api/v1/admin/audit?limit=&offset=` | Admin | Append-only |
| `POST` | `/api/v1/admin/search/reindex` | Admin | Triggers `ScanAll` |
| `GET` | `/api/v1/admin/usage` | Admin | `Quota` per root (Linux `Statfs`, zero off-Linux) |
| `GET` | `/api/v1/version` | None | `VERSION` + git metadata |

## Health & Observability

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Liveness — 200 `{service, status, version}` |
| `GET` | `/readyz` | Readiness — checks DB via `probeWritable` |
| `GET` | `/metrics` | Prometheus text when `NEXORA_ENABLE_PROMETHEUS=true` + `Metrics` present |
| `GET` | `/*` (NotFound) | Serves `NEXORA_WEB_ROOT` (SPA fallback) — `Cache-Control: no-store` for non-API |

## Headers

- `X-CSRF-Token`: value of `nexora_csrf` cookie on every `POST/PUT/PATCH/DELETE`.
- `Authorization: Bearer <token>`: Tauri/mobile cross-origin auth (CORS `AllowedHeaders` includes it).
- `X-Share-Password`: public share password (prefer over `?p=`).
- `X-Nexora-Signature` / `X-Nexora-Event` / `X-Nexora-Event-ID`: webhook delivery.
- `X-Request-ID` / `X-Request-Id`: request tracing.

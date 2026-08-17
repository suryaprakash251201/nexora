# Nexora — Code Review & Improvement Report

Date: 2026-08 · Scope: full repo (~13.7k LoC Go, ~21k LoC web TS/TSX, mobile/desktop/website/CI)
Method: static analysis of all source; four parallel deep-dives (API/auth, storage/infra, web frontend, mobile/desktop/CI) plus independent verification of the top findings. No Go toolchain available in this environment, so `go vet`/`go test` could not be executed here — CI does run them on every push.

---

## 0. TL;DR

Nexora is a well-disciplined codebase with unusually good security instincts (Argon2id, hashed sessions, double-submit CSRF, path-traversal defense in depth, zip-slip protection, strict CSP, least-privilege CI). The serious problems are not sloppy code — they are **consistency gaps**: a few endpoints skip authorization checks that the rest of the codebase performs, one "security" feature (password reset) is an account-takeover primitive, one documented feature (PostgreSQL) is broken end-to-end, and one operational path (Docker on :80) crash-loops. Priorities: fix the 7 criticals, then the authz gaps, then the scalability items.

---

## 1. Critical

### C1 — Forgot-password returns the reset token to the caller → unauthenticated account takeover (incl. admin)
`internal/api/handlers_auth.go:236` — `handleForgotPassword` generates a reset token and returns it in the HTTP response body. There is no email/out-of-band delivery anywhere in the repo, and no challenge beyond knowing the login. Anyone who knows a username ("admin" is the default) can reset that account's password and log in; session revocation at :275 actually helps the attacker by wiping the victim's sessions. Only mitigation: the 60/min per-IP limiter.
Fix: deliver the token out-of-band (SMTP/webhook), require an authenticated session, or disable the endpoint unless configured.

### C2 — The 6-hourly search rescan stalls the entire API (single SQLite connection)
`internal/database/database.go:38` sets `db.SetMaxOpenConns(1)`; `internal/search/search.go:263-341` (`scanRoot`) opens **one long write transaction** over that single connection while walking a root (up to 500k entries). Every other DB touch — including the session lookup that runs on **every request** (`internal/auth/session.go:50-64` via `SessionAuth`) — blocks until the scan commits. On a large root this is minutes of total API unavailability, on startup (5s after boot, `cmd/nexora/main.go:109-112`), every 6h, and on admin reindex. Cancelling mid-scan commits a torn index (whole root deleted then partially re-inserted).
Fix: batch commits (e.g. 1k rows per tx), keep WAL readers on separate connections (MaxOpenConns > 1 with SQLite WAL), or run the scan with a second connection; also write entries before deleting.

### C3 — S3 folder delete/move/trash silently leaves all children behind (data loss on S3 roots)
`internal/storage/s3_ops.go:368-445` — delete/move operate only on the folder-marker object; recursive delete/move of S3 "directories" never enumerates children, so trashing/deleting/moving a folder on an S3 root orphans its contents (still billed, invisible in UI, effectively lost).
Fix: prefix-listing recursive operations (DeletePrefix/ListObjectsV2 with `force_list_v1` already supported), or refuse folder ops on S3 roots until implemented. Note `List` is prefix-based (s3_ops.go:42-75), so orphaned children remain fully listed and downloadable — the "deleted" data stays visible..

### C4 — PostgreSQL mode is broken end-to-end but advertised
- `migrations/0001_init.sql:4` starts with `PRAGMA foreign_keys = ON;` — a Postgres syntax error; `migrations.MigratePostgresSQL` (`migrations/migrations.go:45-54`) doesn't strip it → migrations fail immediately.
- Every store query uses SQLite `?` placeholders, which lib/pq rejects (the `probeWritable` helper at `database.go:66-73` correctly uses `$N` — proof the authors knew the difference).
- The `DBAdapter`/`ToPostgres` translation layer (`internal/database/postgres.go:59-121`) is **never called** by any store; conversions are incomplete and incorrect anyway: `INSERT OR REPLACE` becomes a single-column `ON CONFLICT ... DO UPDATE SET <first col>` (search.go:274 / playlists/store.go:282 would never update rows), `INSERT OR IGNORE` is not converted at all (handlers_tags.go:136, playlists/store.go:220), and the photo queries' `strftime('%Y'...)` (search/media.go:287,291) are never translated. `MigratePostgresSQL` also rewrites `INTEGER PRIMARY KEY` → `GENERATED ALWAYS AS IDENTITY` (migrations.go:49-50), which rejects explicit-id inserts.
- CI only *compiles* the `-tags postgres` build (`.github/workflows/ci.yml:39-40`), never runs it. `docs/architecture-review.md:30` previously confirmed empirically (`pq: syntax error`).
- `docker-compose.postgres.yml` additionally puts postgres on a separate `nexora-net` network while nexora stays on the default network — the two containers cannot reach each other.
Fix: either fail fast with a clear "unsupported" error and delete the tag/compose/docs, or do it properly (one dialect layer used by all stores, `$N` everywhere, migration converter tested against a real PG).

### C5 — Docker Compose binds :80 as uid 100 with cap_drop ALL → EACCES crash-loop
`docker-compose.yml:37,63` sets `NEXORA_LISTEN_ADDR: ":80"` and maps `"${NEXORA_HTTP_PORT:-80}:80"` while the image runs as `USER nexora` (`Dockerfile:45`, uid 100) with `cap_drop: ALL` (`docker-compose.yml:63`). Binding a port < 1024 requires CAP_NET_BIND_SERVICE, which is dropped → `listen tcp :80: bind: permission denied` on startup, healthcheck on :80 fails, restart loop. The Dockerfile itself listens on :8080 correctly.
Fix: listen on :8080 inside the container and map `${NEXORA_HTTP_PORT:-8080}:8080`, or add `cap_add: [NET_BIND_SERVICE]`.

### C6 — Saved-search "execute" bypasses the root allow-list (and is also broken)
`internal/api/handlers_saved_searches.go:287-302` builds `search.Query` **without `RootIDs`** and without validating the stored `root_id` or the `?root=` param against the user's roots — unlike `handleSearch` (`internal/api/handlers_search.go:37-50`). In `internal/search/search.go:78-99` the allow-list is only applied in the `RootIDs` branch; when a `RootID` is set the query runs as `WHERE root_id = ?` with **no permission check**, letting any user list (names, paths, sizes, mtimes) of roots they cannot access. When no root is set, `len(q.RootIDs)==0` → `return nil,nil` → the endpoint silently returns zero results (the parsed `filters` are never applied either). So it is both a cross-root disclosure and a dead feature.
Fix: populate `RootIDs` from `UserRoots` (like `handleSearch`), validate `root`/stored root, apply filters.

### C7 — Any authenticated user can read all webhook URLs and HMAC secrets
`internal/api/handlers_webhooks.go:14-25` — `handleListWebhooks` requires any authenticated user, while create/delete are admin-only (:30, :69). `ListWebhooks` returns `WebhookTarget` including the populated `Secret` (`internal/events/events.go:261-271`), enabling non-admin users to forge `X-Nexora-Signature` payloads to the configured endpoints.
Fix: restrict list to admins; strip the secret (or mask it) from non-admin responses.

---

## 2. High

### H1 — CORS reflects any Origin with credentials; `NEXORA_CORS_ORIGINS` is dead config
`internal/api/server.go:128-134` — `AllowOriginFunc: func(...) bool { return true }` + `AllowCredentials: true`, and `Authorization` is in `AllowedHeaders` (contradicting the comment at :121-122 claiming it is "not exposed"). `Config.CORSOrigins` (`internal/config/config.go:36,70`) is parsed but **never used**; `.env.example` and docker-compose document it as the CORS allow-list. Currently safe only because the session cookie is `SameSite=Strict` (`handlers_auth.go:512`). Any future cookie-flag loosening silently re-opens cross-origin session use; a malicious page can already issue credentialed GETs (e.g. `/files/raw`) in top-level navigations.
Fix: implement the allow-list (parse CORSOrigins, exact-match or suffix-match), keep `AllowCredentials` off for wildcard.

### H2 — Playlists expose every user's files to every user
`internal/api/handlers_playlists.go:97,155` call `s.Playlists.ListAll()` (`internal/playlists/store.go:57-81`), which selects **all** playlists with **no owner filter** and hydrates items with `root_id` + `path` (and sizes from the search index). Any authenticated user learns the full file-tree layout (paths/names) of roots they may not be allowed to read. `handleListCollaborators` (`handlers_playlists.go:392-407`) also lacks an ownership check and leaks other users' usernames.
Fix: `ListForUser(userID, isAdmin)` mirroring shares/jobs/trash; keep `ListPublic` for the public route.

### H3 — `NEXORA_MAX_UPLOAD_SIZE` is never enforced → disk-fill DoS
`internal/config/config.go:72` defines it (default 512 GB) but it is only referenced by validation (:108). `handleUpload` (`internal/api/handlers_upload.go:32-36`) explicitly has no single-file limit; multipart bodies beyond 32 MB spool to temp files, so any credentialed user can fill the disk. Same for WebDAV PUT.
Fix: `http.MaxBytesReader` + counted streaming in the handler, enforced in the provider.

### H4 — Tailscale auth trusts a client-settable header
`internal/api/handlers_auth.go:441-497` — `handleTailscaleLogin` accepts `Tailscale-User-Login`/Tailscale-User headers with no verification that the request arrived through a Tailscale proxy (no proxy-header check, no peer-IP check, no HTTPS requirement). If the listener is reachable directly with `NEXORA_TAILSCALE_AUTH=true`, anyone can forge identity and auto-provision/log in as a new user (or a known username).
Fix: require the proxy header + TLS, restrict the listener, or validate the peer IP is the Tailscale interface. (Already flagged as M6 in docs/architecture-review.md — still open.)

### H5 — Webhook delivery is an unhardened SSRF primitive
`internal/events/events.go:318` POSTs to the admin-supplied URL with no scheme/IP filtering and default redirect-following; a webhook to `http://169.254.169.254/` or an internal service succeeds (TLS verification is on, but that doesn't stop internal HTTP). Admin-only today, so a compromised admin/credentials escalates to internal-network probing.
Fix: validate `http(s)://` at creation, block loopback/link-local/private targets (or make it an explicit opt-in), cap redirects.

### H6 — Zip extraction has no decompression caps (zip-bomb)
`internal/jobs/jobs.go:396-479` — zip-slip is well defended (:431-470, tests in jobs_test.go), but per-entry and total uncompressed bytes are unbounded (`zf.UncompressedSize64` passed straight to `Write`). A crafted archive can fill the disk. `handleCreateVersion` (`handlers_versions.go:162`) copies arbitrarily large files too.
Fix: caps on uncompressed size per entry and per job, checked while streaming.

### H7 — Tauri webview can read the whole filesystem
`desktop/src-tauri/capabilities/default.json:18-24` grants `fs:allow-stat` and `fs:allow-read-file` with `"path": "**"`, plus `withGlobalTauri: true` (`tauri.conf.json:12`). Any script running in the webview (XSS, compromised dependency) can read arbitrary local files and exfiltrate them through the API. `shell:allow-execute` for VLC with `"args": true` adds an unrestricted-args exec primitive that the frontend doesn't even use (it only uses `shell.open`).
Fix: scope fs access to a dedicated app-data/media directory; delete the unused VLC execute grants or pin args.

### H8 — Mobile auth token in plaintext AsyncStorage + tokens in media URLs
`mobile/src/store/SessionContext.tsx:6-7,34-36,77` persists the session bearer token in unencrypted AsyncStorage (mobile/README.md claims it is "persisted securely"), and `mobile/src/api/client.ts:88-121` appends `?token=` to every thumbnail/raw/transcode URL (session tokens in URLs → logs, screenshot/notification surfaces, other apps). The web app does the same in Tauri mode (`web/src/api/client.ts:106-109`).
Fix: expo-secure-store (Keychain/Keystore); prefer cookies where possible or short-lived scoped media tokens.

### H9 — Frontend: module-level unguarded localStorage can white-screen the app
`web/src/store.ts:50-52` reads `localStorage` and runs `JSON.parse` at module scope (Zustand initializer) with no try/catch — same at `web/src/main.tsx:11` and `App.tsx:34`. Corrupt JSON or blocked storage throws during module evaluation, **before React mounts**, so the ErrorBoundary (`main.tsx:27`) cannot catch it. Contrast the correct guards at `store/player.ts:53-59` and `PhotosView/hooks.ts:15-23`.
Fix: safe-read helpers with defaults everywhere module-level storage is touched.

---

## 3. Medium

Backend:
- **M1 — TOTP 2FA step has no account lockout** (`handlers_auth.go:401-437`): `handleTOTPVerifyLogin` never consults `LoginGuard`; an attacker with the password can brute-force 6-digit codes (with `totp.Validate` accepting ±1 window) throttled only by the per-IP limiter. Add failure counting; move `RecordSuccess` after TOTP verification.
- **M2 — Forgot-password timing branch is inverted** (`handlers_auth.go:215-221`): the 200 ms sleep runs when the user does **not** exist, so existing accounts respond faster — the opposite of the "prevent user enumeration" comment, and the token response confirms existence.
- **M3 — Share password accepted in URL** (`handlers_share_public.go:65,84`): `?p=` lands in proxy/access logs and history; prefer the `X-Share-Password` header only.
- **M4 — /home/usage leaks whole-instance statistics** (`handlers_home_usage.go:93`): the `search_index` GROUP BY query has no root/user filter (quota part at :74-89 is correctly scoped) — any user sees global file counts/bytes per category.
- **M5b — `media_metadata` (photo EXIF/GPS) is wiped by every rescan** (`0012_photo_timeline.sql:3` `ON DELETE CASCADE` from `search_index`): `scanRoot`'s delete-then-reinsert cascades, so every 6h scan destroys EXIF/date/GPS until `ScanMediaMetadata` re-extracts — and re-extraction **always fails for S3 roots** because media.go:105 reads the local filesystem via `filepath.Join` instead of the provider. S3 photo metadata is permanently lost on each scan.
- **M5c — Thumbnail generation is synchronous and unbounded per request** (`preview.go:88-132`, `cover.go:17,84`): `image.Decode` of the full image per request with no concurrency cap (a gallery page decodes several 24 MP images at once); failed encodes leak the temp file.
- **M5 — Shared-root trash is cross-user tamperable** (`handlers_file_ops.go:135-188` + `handlers_files.go:80`): `.nexora-trash` is only *hidden* from listings, not protected; a write-capable user can address `.nexora-trash/<name>` directly and permanently delete/relocate other users' trashed files (row-level checks in `handlers_trash.go:109,156` don't apply to the physical subtree).
- **M6 — Session tokens accepted in query strings** (`internal/auth/middleware.go:22-24`): `?token=` auth leaks tokens to logs/history (used by Tauri/mobile media URLs). Keep for media only with short-lived tokens, or drop.
- **M7 — Search index goes stale on subtree move/rename** (`internal/search/search.go:212-216` + `handlers_file_ops.go:57-58,93-94`): descendants of a moved/renamed directory stay indexed at old paths until the 6-hour rescan. Re-walk and re-index the moved subtree.
- **M8 — S3 writes buffer whole files in RAM, no multipart, listings unpaginated** (`internal/storage/s3_ops.go:313-338`): with "512 GB uploads" advertised, an S3 root can OOM the server on a large file (`Write` does `io.ReadAll` then a single PUT; 10 GB upload ≈ 10 GB RAM), and the shared `http.Client` 60s timeout (s3.go:69-72) kills any transfer slower than 60s — no retry. Same for ZIP extraction and WebDAV PUT through S3. Listings are single-page (1000 max, s3_ops.go:79-89) — folders with >1000 objects are silently truncated. Implement multipart streaming + pagination + recursive delete.
- **M9 — Jobs have no crash recovery** (`internal/jobs/jobs.go:140-160`): after a restart, rows stuck in `pending`/running are never reconciled; archives left in the cache dir. Add a startup sweep.
- **M10 — Audit log grows unbounded** (`internal/audit/audit.go`): append-only, no retention; every op writes a row forever. Add retention/rotation.
- **M11 — WebDAV is dead code that is documented as a feature** (`internal/webdav/webdav.go`, `docs/features.md:447-449`): not mounted in `server.go`, no auth wiring, no tests. If ever wired, note it also has an XML-injection bug (`displayname` unescaped at :133) and a broken COPY/MOVE `Destination` header parse (:207-214). Mount it properly or remove it.
- **M12 — Five documented env vars are inert** (`internal/config/config.go`): `NEXORA_MAX_UPLOAD_SIZE` (only validation), `NEXORA_LOG_FORMAT`, `NEXORA_ALLOW_REGISTRATION`, `NEXORA_READONLY_FS`, `NEXORA_ENABLE_FFMPEG_THUMBS` are parsed but never read; conversely `NEXORA_ALLOW_REGISTRATION`, `NEXORA_READONLY_FS`, `NEXORA_PLAYLIST_COVER_PATH`, `NEXORA_TAILSCALE_AUTH`, `NEXORA_WEB_ROOT` are used but **missing from .env.example**. Wire or remove; finish the example.
- **M13 — Remote account-lockout DoS** (`handlers_auth.go:533`, `guard.go:53-70`): lockout keys are login-only; 5 wrong passwords lock any account for up to 15 min from anywhere (no IP/UA binding). Bind key to IP+login and/or make the lock per-IP first.
- **M14 — Opus is blocked by transcode preflight but allowed in the copy path** (`handlers_transcode.go:71` vs :322): real .opus/.webm audio cannot be transcoded at all (contradictory policy); the preflight map should drop `opus`.
- **M15 — Webhook delivery failures are silently dropped** (`internal/events/events.go:340`): `_ = lastErr` with no logging; a dead webhook target silently stops delivery with no observability. No retry persistence or dead-lettering: after 3 attempts the event is gone.

Frontend:
- **F1 — ImageView drag-to-pan is dead** (`web/src/components/ImageView.tsx:142-157`): `onImgMouseDown` only sets a ref (no setState), so the window listeners (deps `[zoom, pan, fitMode]`) are never attached; panning does nothing despite the UI advertising it.
- **F2 — Browser downloads buffer the whole file in the JS heap** (`web/src/lib/transfer.ts:283-307`): chunk accumulation + `new Blob` holds multi-GB files twice in memory; 3 concurrent downloads can OOM the tab.
- **F3 — Photos infinite-scroll race** (`web/src/components/PhotosView/hooks.ts:128-146`): `loadMore` has no request-sequence guard; changing filters mid-flight appends stale results and skews pagination.
- **F4 — "Close player" leaves the audio stream running** (`web/src/components/PlayerBar.tsx:163-179,192-196`): `stop()` never clears `a.src`/load(), so the last track keeps buffering/playing in the hidden element.
- **F5 — Stale folder listing with keepPreviousData** (`web/src/components/Workspace.tsx:175-188`): after navigating folders, `files.data` holds the previous folder until refetch resolves; on error the stale list persists.
- **F6 — Uncancelled raw fetches race between files** (`PreviewModal.tsx:73-91`, `Editor.tsx:33-43`, `SharePage.tsx:42-44`): fast gallery/editor navigation can show the wrong file's content.
- **F7 — MediaPlayer keydown closure goes stale after transcode fallback** (`MediaPlayer.tsx:1299-1323`): handler deps don't include the async fallback state; keyboard seek uses the wrong code path after fallback.
- **F8 — Markdown renderer allows protocol-relative URLs** (`web/src/lib/markdown.ts:15-19,26`): `src="//host/..."` leaks the workspace URL via Referer to external hosts; escape-first model is otherwise sound. Restrict images to https?/data.
- **F9 — Archive completion popup is blocked** (`useFileOperations.ts:86`): `window.open` from an EventSource callback is not a user gesture — popup blockers routinely suppress the finished-archive download.
- **F10 — Blob URL leaks** (`CoverPickerModal.tsx:269` in-render `createObjectURL`; `SharePage.tsx:77`; `MediaPlayer.tsx:1411` not revoked on unmount).
- **F11 — TransfersPanel re-renders every progress tick** (`TransfersPanel.tsx:115` + `store/transfers.ts:33-46`): whole-panel render per tick; select per-row or batch updates.
- **F12 — CSP only via Go headers / Tauri config**: server middleware sets CSP on Go-served responses (`internal/middleware/middleware.go:52-97`) and Tauri has its own CSP, but the Vite dev server and any non-Go hosting have no CSP; also `connect-src 'self'` may block OSM map tiles in browser mode (`PhotosView/MapGallery.tsx`) — verify map rendering under the header CSP.

Storage/ops extras:
- **M18b — Root deletion orphans rows everywhere** (`roots.go:125-143` deletes only `user_roots`+`storage_roots`): `trash`/favorites/recents/file_versions/search_index rows linger; `search_index` has no FK at all (0001_init.sql:107-117).
- **M18c — Migration 0006 creates a unique index on pre-existing data** (`0006_playlist_enhancements.sql:7`): upgrades from installs that already contain duplicate playlist items will fail at startup.
- **M18d — Background goroutines outlive the DB**: the startup scan (main.go:109-112), maintenance loop (main.go:170-192) and ScanMediaMetadata (main.go:171) run on `context.Background()` and can touch the DB after `db.Close()`.
- **M18e — Quota reporting is a no-op off-Linux** (`quota_other.go:5-6` returns a zero Quota with no error): Home usage tiles show 0 on Windows/macOS.

Mobile/desktop/ops:
- **M16 — Version chaos**: 1.7.2 (docker-compose default), 1.7.6 (mobile package.json), 1.8.0 (tauri.conf.json/Cargo, website index.html softwareVersion), and the website links assets named `Nexora_1.8.0_*` under v1.8.1 labels (website/index.html:529-594); website/docs.html:120 pins a stale `:latest-8141398` commit tag. Single source of truth needed.
- **M17 — Repo hygiene**: `bin/nexora` (an 11.5 MB compiled binary) and `data_dir.txt` (machine-specific UTF-16 path file) are tracked in git (AGENTS.md says such artifacts are gitignored); `mobile/stitch_audio.html` (with Google-hosted image CDN references) is also committed. `git rm --cached` + ignore.
- **M18 — Missing DB indexes**: photos timeline filters `search_index` by (root_id, date) and recents by (user_id, accessed_at) with no covering indexes (`migrations/0012_photo_timeline.sql`, `0004_recents_kind.sql`).
- **M19 — Web updater.json may never be published**: tauri.conf.json points the updater at a GitHub release asset, but the tauri-build workflow runs build-only (no publish step for updater.json) — verify; otherwise auto-update silently never works.
- **M20 — Non-reproducible installs**: `Dockerfile:9` and `tauri-build.yml:59,64` use `npm install` instead of `npm ci`; base images are unpinned (alpine:3.20 / node:20-alpine / golang:1.26-alpine are moving tags).
- **M21 — Mobile config nits**: `app.json:34,44` enables cleartext traffic everywhere (`usesCleartextTraffic` + `NSAllowsArbitraryLoads`) — needed for self-hosted HTTP but should use `NSAllowsLocalNetworking` instead; `app.json:56` disables the modern Android predictive-back gesture; `client.ts:211-214` has a dead branch (`pref === "high"` and the fallthrough return identical URLs, so `auto` silently collapses to high).
- **M22 — dependabot.yml has no mobile/ entry**: Expo pins are deliberate, but transitive/patch drift in the mobile app goes unreviewed.
- **M23 — Desktop Rust nits** (lib.rs): the panic hook writes to a shared temp `nexora-crash.log` (multi-instance clobber); sleep-inhibition state is recorded even when the inhibitor spawn fails (lib.rs:41-53,78-80); `INHIBIT_PID.lock().unwrap()` can panic on a poisoned mutex.

---

## 4. Low / nitpicks (selected)

- `handlers_upload.go:207-254` parseRange: multi-range headers are served as a full-range 206; `bytes=0--5` clamps to whole file (harmless, not RFC-correct).
- Archive jobs silently skip unreadable files yet complete as `done` (jobs.go:342-368) — users get incomplete zips with no warning.
- `quota_linux.go:16` counts `Bfree` (excluding root-reserved space) as "used" — quota numbers skew on Linux.
- `probeWritable` re-writes a probe row into `schema_migrations` on **every boot** (database.go:66-73) — harmless but noisy; `now()` at database.go:85-87 is dead code.
- Trash list sorts by `deleted_at` with only a `(user_id)` index (handlers_trash.go:34).
- Docs drift: SECURITY.md:44 claims "CORS: Configurable" while the server reflects any origin (H1); README:49 says React 18 but the app is React 19.
- `handlers_versions.go:137-142`: `MAX(version)+1` without a transaction/unique constraint — concurrent snapshots can collide.
- `handlers_transcode.go:262-288`: S3 reader (`pipe:0`) leaks on preflight rejection early-return (rc never closed).
- S3 SigV4 logging prints the access key ID into the log stream on every request (s3.go:308-311; the secret key is not printed); virtual-host baseURL forces https even for http endpoints (breaks plain-http MinIO unless `use_path_style`); `List` appends `Z` to `LastModified` unconditionally (s3_ops.go:157,226 — zero Modified for providers already returning UTC); `PresignedURL` returns an unsigned URL (would 403; currently unused).
- `handlers_transcode.go:399,460-463`: HLS `token` param is cosmetic — echoed into playlist URLs, never validated; noise in logs/URLs.
- `handlers_jobs.go:197-224`: archive download doesn't re-check current root permission (revoked since enqueue).
- `handlers_shares.go:133-143`: share URL reflects the `Host` header when `BaseURL` empty.
- `internal/auth/session.go:48-65`: comment says expiry is refreshed; no UPDATE happens — sessions never slide.
- `internal/sharing/sharing.go:96-99`: share tokens stored raw in DB (sessions are hashed) — a DB leak exposes every live share.
- `handlers_saved_searches.go:20-26`: `math/rand` for IDs (auto-seeded since Go 1.20, but inconsistent with crypto `util.NewID`).
- `internal/api/response.go:28-39`: `writePage`/Page dead code.
- `startSession` (`handlers_auth.go:501-517`) swallows session-create errors and still returns 200 with an empty token.
- `_ = s.Audit.Record(...)` / `_ = s.DB.Exec(...)` everywhere — the audit trail silently drops on DB failure.
- `handlers_analytics.go:40-58,190-218`: duplicates/storage-stats walk the whole root synchronously with no ctx cancellation.
- Transcode session IDs are client-chosen UUIDs — a peer who learns one can kill another user's transcode.
- `web/src`: 44 `: any` sites; duplicated `PhotoResult`/Density types between api/types.ts and PhotosView/types.ts (with *different* values: "cozy"|"compact" vs "compact"|"comfortable"|"spacious"); two overlapping toast systems (custom Toaster + sonner) both mounted; `@tanstack/react-virtual` is a dependency but **never used** while FileBrowser (500-row pages), Photos gallery and Playlist tracks render un-virtualized with motion layout/stagger; playlists fetched at module import (`store/playlists.ts:173-175`) even on the public SharePage; MediaPlayer.tsx is 1551 lines (audio + video implementations in one file) and Workspace.tsx 986 — both overdue a split.
- `web/src/api/client.ts:166-179`: HTML error pages become strings, then `as ApiError` reads properties off a string — real error messages lost.
- Hardcoded personal Tailscale hosts in `web/src/api/client.ts:7-13` (shipped in the product; per-user config should live in localStorage/settings).
- `web/src/components/SharePage.tsx:100-108`: `revokeObjectURL` synchronously after `a.click()` — older Safari drops the download.
- Frontend low/nits (from the web audit): PhotoViewer fullscreen button desyncs on Esc (no `fullscreenchange` listener, PhotoViewer.tsx:211-214); `store/player.ts:76-90` `engine.bind` never unbinds (works only because PlayerBar is a permanent singleton); `useAudioContext.ts:46` permanently routes the shared engine element through Web Audio once the lossless view opens (documented caveat); `PhotosView.tsx:85-88` scrolls `document.querySelector("main")` — fragile layout coupling; bare `setTimeout`s without cleanup in Workspace.tsx:429,433 and PhotosView.tsx:183; setState-after-unmount via uncancelled async chains in MediaPlayer.tsx:1118-1136/1223-1233, Editor.tsx:36-42, SharePage.tsx:43 (React 19 no-ops them); `useKeyboardShortcuts.ts:44` uses deprecated `navigator.platform`.

---

## 5. Improvement roadmap

**Security (do first — all small):**
1. Fix C1 (forgot-password), C7 (webhook secret leak), H2 (playlist ListAll), C6 (saved-search scoping), M1 (TOTP lockout), M2 (timing branch).
2. Wire the CORS allow-list (H1); enforce `MaxUploadSize` (H3); harden webhook URLs (H5); zip-bomb caps (H6).
3. Tailscale header validation (H4); Tauri capability scoping + VLC grant removal (H7); SecureStore on mobile (H8); guard module-level localStorage (H9).
4. Hash share tokens at rest; scope trash paths; remove `?p=`/?token= URL auth where possible.

**Reliability:**
1. C2: restructure ScanAll to batch commits + multiple connections (biggest availability win).
2. C3: recursive S3 folder ops (or explicit guard). C5: compose port fix (one-line). C4: decide Postgres (remove vs implement).
3. Jobs startup reconciliation (M9); audit retention (M10); webhook failure logging (M15); S3 multipart + pagination (M8); subtree reindex after move/rename (M7).

**Frontend UX/correctness:**
1. F1 (ImageView pan), F3 (photos race), F4 (player unload), F5 (stale listing) — small, high user impact.
2. F2 streaming downloads; virtualize lists with the already-bundled react-virtual; fix F6/F7/F9/F10.
3. Split MediaPlayer/Workspace; consolidate toast systems; dedupe types; kill the 44 anys with a typed error helper.

**Engineering hygiene:**
1. Delete dead config/env vars or wire them; version single-sourcing; untrack bin/nexora + data_dir.txt.
2. Add missing indexes (M18); verify updater.json publishing (M19).
3. Tests: the codebase has good tests for range/trash/search/sharing — add handler tests for saved-searches, playlists, webhooks (these are exactly where the authz bugs live); run `go test -race` in CI; if PG stays, add a real postgres service-container job (run RunPostgres + one insert/select per store) — CI currently only *compiles* the tag, which is exactly how C4 shipped. Also add a macOS leg and sccache for the Tauri workflow (only Linux/Windows are built today).

---

## 6. What's done well

- **Path traversal is defended in depth**: `CleanRelative` + `Resolve` with symlink evaluation and boundary-aware containment (`internal/storage/path.go:15-91`) — the best part of the codebase.
- **No shell injection**: ffmpeg/ffprobe run via `exec.Command` argument slices; filenames never reach a shell.
- **Zip-slip**: layered raw-name + cleaned-path checks with tests (`jobs.go:431-470`, `jobs_test.go`).
- **AuthN fundamentals**: Argon2id, TOTP, hashed session tokens, double-submit CSRF, per-root read/write grants with admin super-access, SameSite=Strict cookies, HSTS gating.
- **Bounded everything**: job worker pool, webhook queue (256) + 2 workers + retry/backoff, transcode semaphore (2), upload queue (3), transfer pool (3) — no unbounded goroutines.
- **Careful failure handling**: RFC-aware range parsing with suffix support (iOS AVPlayer), write-probe on DB open, graceful shutdown with drain, zip-slip, panic recovery with generic 500.
- **Clean architecture**: single `Deps` struct DI (after the prior review's M1), per-package stores, embedded migrations, sensible interface (StorageProvider) with local + S3.
- **CI posture**: least-privilege workflow permissions, race-safe release publishing, careful input sanitization in publish-image.
- **Frontend discipline**: nearly every listener/observer/rAF has a paired cleanup; markdown renderer escape-first; lazy-loaded heavy views; React Query used consistently.

---

## 7. Method & caveats

- Four background subagents deep-dived (API/auth, storage/infra, web frontend, mobile/desktop/CI) and every finding above was verified against source with file:line references; the highest-impact findings were re-verified independently.
- Go toolchain was unavailable in this environment (`go vet`/`go test`/race detector not executed here); CI covers vet+test+build. Claims about chi's duplicate-route resolution order (server.go:162/168) and the tauri-action updater.json publish behavior (M19) should be confirmed at runtime.
- `docs/architecture-review.md` (2026-08-16) predates this review; its H1/H2/L1/L2 (events/webhooks) and M1 (Deps) are confirmed fixed; H3 (Postgres), M2 (search staleness), M5 (WebDAV), M6 (Tailscale), L3 (forgot-password), L4 (os.Exit in goroutine), L8 (S3 readOnly ignored) remain open — noted above.

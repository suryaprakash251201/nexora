# Architecture

## Overview

```
Browser / Desktop (Tauri, HashRouter) / Mobile (Expo, native nav)
   │   apiUrl: http(s)://host  (Tauri stores nexora-api-url; mobile SecureStore token)
   ▼
React / Vite UI (web) — also embedded at NEXORA_WEB_ROOT for Go to serve
   │  /api/v1  +  /healthz, /readyz, /metrics, /share/:token, /s/:token SPA
   ▼
Go API (Chi) — auth, files, search, previews, shares, playlists, jobs, events, audit
   ├─ SQLite (WAL, BUSY_TIMEOUT) or PostgreSQL (via database.DB dialect wrapper)
   ├─ Filesystem roots (LocalFilesystemProvider + S3Provider via StorageProvider interface)
   ├─ Cache: data/cache/thumbnails (TTL 168h), data/cache/archives (24h), data/versions
   └─ Background: ScanAll (5s after boot + every 6h), ScanMediaMetadata (idle 1m batch 100), maintenance (15m)
```

## Go Backend — `cmd/nexora` + `internal/*`

### Entrypoint (`cmd/nexora/main.go` ~200 LOC)

Order: `config.Load → Validate → database.Open → ensureSessionSecret (persist if blank) → init stores (UserStore, SessionStore, Audit, Guard, Limiter, RootService, Search, Shares, Playlists, Preview, Jobs, Metrics, Events.Bus) → api.NewServer(Deps{…}) → Routes() → http.Server`. After 5 s, `search.ScanAll` + `ScanMediaMetadata` are launched on `context.Background()`; `runMaintenance` ticks at 15 m (session/limiter/share/thumb/archive/reset GC) and 6 h (re-scan).

`Deps` is a single struct param — post-construction field assignment is gone (prevents nil-bus regressions from earlier reviews).

### HTTP Layer (`internal/api/server.go` — authoritative route list)

Chi router with middleware: `RequestID → RealIP(trusted CIDRs) → Recoverer → Metrics → SecurityHeaders(CSP/HSTS) → CSRF(double-submit, exempt list) → SessionAuth → CORS(AllowOriginFunc + AllowCredentials + AllowedHeaders)`.

- **Health (no auth):** `GET /healthz`, `GET /readyz`, `GET /metrics` (when `NEXORA_ENABLE_PROMETHEUS`).
- **Public shares (rate-limited):** `GET/POST /api/v1/share/{token}`.
- **Auth:** `POST /auth/setup|login|tailscale|forgot|reset|password`, `GET /auth/needs-setup|session`, authed `POST /auth/logout|totp/*`, `POST /auth/totp/verify-login`.
- **Authenticated:** `/roots`, `/files` family, `/audio/*`, `/trash`, previews/metadata/editor, `/files/versions`, `/search`, playlists, `GET /users/search`, `/archive|/extract + /jobs`, favorites/recents/home, tags, `/photos`, `/saved-searches`, webhooks, `/shares`.
- **Admin:** `/admin/roots|users|audit|search/reindex|usage`.
- Mounted at `/api/v1`; `NotFound → handleStatic` serves `NEXORA_WEB_ROOT` with SPA fallback and `Cache-Control: no-store` for non-API when `SecureCookies` is on; `Compress` middleware wraps all.

### Packages

| Package | Responsibility | Notes |
|---------|---------------|-------|
| `config` | `NEXORA_*` loading, `RootConfig`, `Validate`, `envBytes` human sizes | `godotenv` auto |
| `database` | `Open` dispatcher, `DB` wrapper (`?`→`$N`, `datetime`→`NOW`, `strftime`→`TO_CHAR`, `OR REPLACE`→`ON CONFLICT`), `Tx` | All stores use `*database.DB` |
| `auth` | `UserStore`, `SessionStore` (SHA-256 token hash, 168h), `LoginGuard` 5/15m, Argon2id, TOTP, ResetToken (sha256, 15m one-time) | |
| `storage` | `StorageProvider` interface + `LocalFilesystemProvider` + `S3Provider` + `RootService` (cached, grants, `EnsureDefaultRoots`), `CleanRelative`/`Resolve` path guard, `Quota` via `Statfs` | Local MIME ~70 exts; S3 SigV4, path vs virtual-hosted, `Prefix`, `UsePathStyle` |
| `search` | `Service{Search, Upsert/Remove/Rename, ScanAll(WalkDir, 500k cap, skip trash/symlinks, tx bulk)}`, `media.go ScanMediaMetadata(batch 100, goexif + 64k header dims) + GetPhotosTimeline(COUNT, facets, COALESCE exif→modified)` | |
| `preview` | `Service(cacheDir,maxSize,ttl,gate 4)` — `Checksum`, `Dimensions`, `Thumbnail(box downscale, JPEG80, 16-hex cache)`, `EditableExtensions` + special names | |
| `preview/cover` | `Cover(MP3 ID3v2/FLAC/M4A)` scoring `cover:10 front:9 …`, folder cover JPEG 82 | `maxCoverFile 60MB` |
| `jobs` | `Manager(workers 2, queue 128)` — `EnqueueArchive/Extract`, `collectFiles` recursion, ZIP streaming, progress 1/16 + 1/8, SSE `Subscribe`, `CleanupOldArchives 24h` | Zip-slip guarded |
| `sharing` | `Store{Create(Argon2id), Access(expiry/cap/pw), ListForUser, IncrementDownload, PurgeExpired}` | Tokens raw in DB |
| `events` | `Bus(queue 256, workers 2, retry 3 backoff 200ms)` — `Emit(non-blocking)`, `Register/ListWebhooks`, HMAC-SHA256 `X-Nexora-Signature` | |
| `audit` | Append-only `audit_logs` | No retention |
| `playlists` | `Store{ListAll/ListForUser(hydrate)/ListPublic, CanEdit, Collaborators role editor}` | |
| `middleware` | `RequestID, Recoverer, SecurityHeaders(CSP frame relaxed for /raw/thumbnail, STS on SecureCookies), RealIP, CSRF, RateLimiter(per-IP), Compress` | |
| `logger` | JSON lines `ts/level/service/msg/caller` | |
| `metrics` | `Registry(httpRequests sync.Map, durationNs, loginFailures, uploadBytes, gauges active_jobs/indexed)` | |
| `webdav` | Full DAV mapping to `StorageProvider` — **currently unwired** (not mounted in `server.go`) | Dead code — don't extend |

### Database & Migrations

- Embedded `migrations/*.sql` (0001 init → 0015 lyrics). Applied via `schema_migrations` table inside a tx. `0001`..`0015` cover: `users/sessions/roots/user_roots/shares/audit/favorites/recents/search_index/jobs/settings/trash/tags/saved_searches/file_versions/media_metadata/webhooks/audio_lyrics` + perf indexes.
- `migrations/rewrite.go` + `migrations/migrations.go` handle Postgres: strip `PRAGMA`, rewrites above. `rewrite_test.go` + `postgres_test.go` cover it; CI runs `TestRunPostgres` against `postgres:16-alpine`.
- `database.Open` validates writability via `probeWritable` (writes a `schema_migrations` probe row) and sets SQLite pragmas: `WAL`, `BUSY_TIMEOUT`, `cache_size`.

### Security Layers

- Passwords: Argon2id; sessions: `RandToken(32)` SHA-256 at rest, HTTP-only `SameSite=Strict` cookie `nexora_session`.
- CSRF: double-submit `nexora_csrf` → `X-CSRF-Token`.
- Rate limiting: per-IP token bucket on auth/share; `LoginGuard` 5 failures/15m lockout.
- Path traversal: `CleanRelative` (reject `..`, `\`, NUL, non-UTF8) + `Resolve(EvalSymlinks, HasPrefix root+sep)`.
- Headers: CSP `default-src 'self'` (frame `self` for `/raw` + `/thumbnail`), `HSTS` only when `SecureCookies`, `no-store` for SPA.

## Frontends

### Web — `web/` (React 19)

- **Stack:** Vite 8 + `@vitejs/plugin-react`, Tailwind 4 + `tw-animate-css` + `shadcn`, Base UI + `cmdk`, Zustand 5 (UI + player + transfers), TanStack Query 5 + Virtual, Motion, Lucide, next-themes, pdfjs-dist.
- **Structure:** `main.tsx` (ThemeProvider `dark`/`light`, QueryClient `retry:1 staleTime:5000`), `App.tsx` (auth state machine — Tauri discovery → splash → needs-setup+session → Workspace/Login), `router.tsx` (`HashRouter` if Tauri else `BrowserRouter`, `/s/:token` public route), `store.ts` (viewMode/density/columns/selection), `store/player.ts` (`PlayerEngine` singleton `<audio>`, queue/shuffle/repeat/volume), `api/client.ts` (fetch wrapper, CSRF read, Tauri Bearer, `getMediaUrl` validated `http(s)` only via `new URL`), `api/endpoints.ts` (single source; no literal `"/favorites"` elsewhere), `api/types.ts` (378 LOC types).
- **Build:** `npm run build` = `tsc -b && vite build` → `web/dist` (5 manualChunks, no sourcemap, `chunkSizeWarningLimit 1200`). Dev `:5173` proxies `/api`+`/healthz` to `:8080`.
- **Design source:** `web/src/index.css` (1462 LOC) — `@theme` brand `#090B12`, accent `#5B8CFF` + `#7A5CFF` + `#35D3FF`, palette 9 variants, glassmorphism `.glass*` + `--shadow-glass`, aurora bg, z-index scale, motion 150/250/400ms.

### Shared Core — `packages/core` (`@nexora/core`)

Single source for `formatBytes`/`formatDate`/`previewKind`/`isEditable`/`cleanTrackTitle`/codec table. Aliased in `web/vite.config.ts` and `mobile/metro.config.js` — never duplicate in `web`/`mobile`.

### Mobile — `mobile/` (Expo 54 / RN 0.81)

- `app.json` `1.0.0` (`usesCleartextTraffic` + `NSAllowsArbitraryLoads` for self-hosted HTTP), scheme `nexora`, `expo-secure-store` (iOS Keychain/EncryptedSharedPreferences), `expo-video` background, `react-native-track-player 4.1.2` patched (`postinstall patch-package` rewrites Kotlin coroutine signatures), `metro.config.js` watches monorepo + aliases `@nexora/core`.
- `App.tsx` providers `SafeArea → Theme → Settings → Session → Audio → ErrorBoundary → RootNavigation`. `SessionContext` migrates legacy `AsyncStorage` token → `SecureStore`. `NavigationContainer` only after auth (tabVisible fix via `setTimeout 0`).
- Read `mobile/AGENTS.md` first — Expo APIs drift; pinned docs are `https://docs.expo.dev/versions/v54.0.0/`.

### Desktop — `desktop/` (Tauri 2)

Wrapper at `src-tauri/tauri.conf.json` `1.8.0`: `beforeBuildCommand npm run build --prefix ../web`, `frontendDist ../../web/dist`, `devUrl http://localhost:5173`, `productName Nexora`, `identifier com.nexora.desktop`, updater `updater.json` + minisign pubkey, bundle `deb/rpm/appimage/nsis/msi`, Linux deps `libwebkit2gtk-4.1-0` etc. Rust `lib.rs` (270 LOC): tray (`Show|Play/Pause|Quit`), single-instance, sleep inhibition (`systemd-inhibit`/`caffeinate`/`SetThreadExecutionState`), global media keys, `window-state` restore, panic hook `temp/nexora-crash.log`. Capabilities scoped to `$APPDATA/$APPCACHE/$RESOURCE/$TEMP/$DOWNLOAD`.

### Website — `website/` (static)

No build. Cloudflare Pages `nexora` project (`suryaprakashinfo.in`). See [website/DEPLOY.md](../website/DEPLOY.md): dashboard zip, `wrangler pages deploy`, or GitHub Action (`website-deploy.yml` on `website/**`).

## Data Flow — File Operation Example

1. **List:** `GET /api/v1/files?root=<id>&path=docs&sort=name&order=asc&dirs_first&offset=0&limit=500` → handler checks `RootService.Permission(user,root)`, calls `provider.List`, attaches tags, returns `FileListResponse{items,has_more}`.
2. **Upload:** `POST /api/v1/files/upload` multipart → `provider.Write` streaming + `Checksum(SHA256)`, `search.Upsert`, `events.Emit(file.created)`, `audit.Record`.
3. **Preview:** `GET /api/v1/files/raw?root=&path=` with `Range: bytes=0-` → `provider.OpenRange` → RFC 9110 206 + `Accept-Ranges: bytes`; image thumb via `GET /files/thumbnail?size=256`.
4. **Trash:** `DELETE /api/v1/files?root=&path=` → `provider.Move(path, .nexora-trash/<ts>_<name>)` then `DB INSERT trash_entries` + `search.Remove`; restore reverses.

## Maintenance & Lifecycle

- **15 m tick:** `sessions.Cleanup` expired, `limiter.Sweep`, `shares.PurgeExpired`, `preview.PurgeStale(TTL)`, `jobs.CleanupOldArchives(24h)`, `users.CleanupExpiredResetTokens`.
- **6 h tick:** `search.ScanAll` (bulk delete+insert, 500 k cap, skips `.nexora-trash`/symlinks).
- **Startup (5 s):** `ScanAll` initial + `ScanMediaMetadata` background (`LEFT JOIN media_metadata`, batch 100, extracts EXIF + dims even when blank).
- **Graceful shutdown:** cancels `runMaintenance`, drains `jobs.Manager` + `events.Bus` bounded queues (no send-on-closed-channel panics).

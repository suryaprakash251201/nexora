# Configuration

All config is `NEXORA_*` env vars (`.env` loaded via `godotenv` in `cmd/nexora/main.go`). `Config.Validate()` (in `internal/config/config.go`) enforces cross-field invariants — bad values fail fast at startup with a clear error rather than silently falling back.

## Quick Setup

```bash
cp .env.example .env
openssl rand -hex 32
# paste into NEXORA_SESSION_SECRET in .env
```

| Scenario | Minimal `.env` changes |
|----------|------------------------|
| Local `http://localhost` | Nothing (defaults work). Optionally `NEXORA_DEFAULT_ROOTS=Files:./data/files:false` for bare-metal dev. |
| Public HTTPS | `NEXORA_BASE_URL=https://files.example.com`, `NEXORA_SESSION_SECRET`, `NEXORA_SECURE_COOKIES=true`, `NEXORA_TRUSTED_PROXIES` if behind a proxy |
| Postgres | `NEXORA_DATABASE_TYPE=postgres`, `NEXORA_DATABASE_URL=postgres://...` |
| S3 root | Create via Admin UI or set in `storage_roots.config` JSON — see [Storage Roots](Storage-Roots) |

## Complete Variable Reference

| Variable | Default | Description |
|----------|---------|-------------|
| **Server** |||
| `NEXORA_LISTEN_ADDR` | `:8080` ( `:80` in Compose) | HTTP listen address |
| `NEXORA_BASE_URL` | `http://localhost:8080` | Public origin for share links. No trailing slash. |
| `NEXORA_WEB_ROOT` | `web/dist` (`/app/web` in container) | Directory serving the built SPA (env-only, not in `.env.example`). |
| **Persistence** |||
| `NEXORA_DATA_DIR` | `./data` (`/app/data`) | DB + `cache/thumbnails`, `cache/archives`, `versions` |
| `NEXORA_DATABASE_TYPE` | `sqlite` | `sqlite` or `postgres` (validated) |
| `NEXORA_DATABASE_PATH` | `$DATA_DIR/nexora.db` | SQLite file path |
| `NEXORA_DATABASE_URL` | — | PostgreSQL URL `postgres://user:pass@host:5432/nexora?sslmode=disable` (required when `postgres`) |
| `NEXORA_THUMBNAIL_CACHE_DIR` | `$DATA_DIR/cache/thumbnails` | Thumbnail cache dir (created on load) |
| `NEXORA_THUMBNAIL_MAX_SIZE` | `20MB` | Max source size to attempt a thumbnail |
| `NEXORA_THUMBNAIL_TTL` | `168h` | Cache entry lifetime; purged on 15 m tick |
| `NEXORA_ENABLE_FFMPEG_THUMBS` | `false` | Enable FFmpeg video thumbnails (requires `ffmpeg` in image). Reserved flag. |
| `NEXORA_MAX_EDITABLE_SIZE` | `5MB` | Built-in editor size cap |
| **Security** |||
| `NEXORA_SESSION_SECRET` | auto-generated | Session signing secret. ≥16 chars when set; else `RandToken(32)` persisted in `settings`. |
| `NEXORA_SESSION_LIFETIME` | `168h` | Session duration (Go `time.ParseDuration`) |
| `NEXORA_SECURE_COOKIES` | `true` def., `false` in Compose | `Secure`, `SameSite=Strict`, gates `HSTS` |
| `NEXORA_TRUSTED_PROXIES` | — | Comma CIDRs allowed to send `X-Forwarded-For`/`X-Real-IP` (e.g. `10.0.0.0/8,172.16.0.0/12`) |
| `NEXORA_CORS_ORIGINS` | — | Comma origins; empty → allow-any (for Tauri/Tailscale convenience) else exact match + `AllowCredentials` |
| `NEXORA_RATE_LIMIT_PER_MIN` | `60` | Per-IP token-bucket for auth/share routes |
| `NEXORA_LOCKOUT_ATTEMPTS` | `5` | Failed logins before lockout |
| `NEXORA_LOCKOUT_WINDOW` | `15m` | Lockout window (also limiter sweep interval) |
| `NEXORA_MAX_UPLOAD_SIZE` | `512GB` | Human sizes accepted (`2GB`, `512MB`); validates but not always enforced in handlers — see note below |
| `NEXORA_ALLOWED_MIME` | — | Comma allow-list for uploads; empty = allow all |
| **Storage** |||
| `NEXORA_DEFAULT_ROOTS` | `Files:/mnt/files:false,...` | Auto-created on first setup: `Name:/path:readOnly[:indexed]` — see below |
| `NEXORA_PLAYLIST_COVER_PATH` | — | Custom dir for playlist covers |
| `NEXORA_TAILSCALE_AUTH` | `false` | Trust `Tailscale-User-Login` header (auto-provision) |
| `NEXORA_ALLOW_REGISTRATION` | `true` | Reserved (parsed, not yet wired) |
| `NEXORA_READONLY_FS` | `false` | Reserved |
| **Observability** |||
| `NEXORA_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `NEXORA_LOG_FORMAT` | `json` | `json`/`text` |
| `NEXORA_ENABLE_PROMETHEUS` | `false` | Exposes `GET /metrics` |
| **Compose-only** |||
| `NEXORA_HTTP_PORT` | `80` | Host port mapping for Compose |
| `NEXORA_VERSION` | `1.8.0` | Image `VERSION` build arg |

**Notes:**

- Human byte sizes (`NEXORA_MAX_UPLOAD_SIZE`, `NEXORA_THUMBNAIL_MAX_SIZE`, `NEXORA_MAX_EDITABLE_SIZE`) are parsed by `envBytes` and accept `512MB`, `2GB`, etc.
- `NEXORA_MAX_UPLOAD_SIZE` is defined/validated but not enforced in all upload paths — large multipart bodies spool to temp files. Treat it as advisory until hardened.
- `NEXORA_CORS_ORIGINS` with empty value purposely opens CORS for Tauri custom schemes and Tailscale clients. For public deployments, set an explicit allow-list.
- `NEXORA_LOG_FORMAT=text` and `NEXORA_ENABLE_FFMPEG_THUMBS` are parsed but inert in some builds — see [Troubleshooting](Troubleshooting).

## Storage Roots Syntax

`NEXORA_DEFAULT_ROOTS` creates roots on **first setup only** (first admin creation). Format:

```
Name:/absolute/path:readOnly[:indexed]
```

- `Name` — display name (`Files`, `Media`…)
- `/absolute/path` — inside container (`/mnt/files` maps to host `./data/files` in Compose)
- `readOnly` — `true`/`ro`/`1` vs `false` (`Media:/mnt/media:true` is read-only)
- `indexed` — optional 4th field `true`/`false` (default `true`) — disable for huge archival mounts you don't want scanned

Example:

```dotenv
NEXORA_DEFAULT_ROOTS=Files:/mnt/files:false,Media:/mnt/media:true,Backups:/mnt/backups:false,Shared:/mnt/shared:false
```

After setup, roots are managed via **Admin → Storage Roots** (CRUD + per-user grants). S3 roots are added there or via DB `storage_roots` (`type='s3'`, `config` JSON) — see [Storage Roots](Storage-Roots).

## Validation Rules

`Config.Validate()` (called before DB open) checks:

- `NEXORA_DATABASE_TYPE` is `sqlite` or `postgres`; when `postgres`, `NEXORA_DATABASE_URL` is required and must be a `postgres://` URL.
- `NEXORA_SESSION_SECRET` when set must be ≥16 chars.
- Each `NEXORA_CORS_ORIGINS` entry must be `http(s)://` or `tauri://` (or empty).

Failures abort startup with a log line — fix `.env` and restart.

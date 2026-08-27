# Nexora — Your Private Self-Hosted File Workspace

<p align="center">
  <img src="web/public/logo.svg" width="96" alt="Nexora logo" />
</p>

<p align="center">
  <strong>Self-hosted file workspace for the home lab. Single container, multiple storage roots, built for ownership.</strong><br/>
  <em>Go API + SQLite/PostgreSQL + React 19 — your files, your server, zero compromise.</em>
</p>

<p align="center">
  <a href="https://github.com/suryaprakash251201/nexora/actions/workflows/ci.yml"><img src="https://github.com/suryaprakash251201/nexora/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/suryaprakash251201/nexora/blob/main/VERSION"><img src="https://img.shields.io/badge/version-1.9.0-5B8CFF?style=flat-square" alt="version 1.9.0" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22C55E?style=flat-square" alt="license MIT" /></a>
  <a href="https://golang.org"><img src="https://img.shields.io/badge/go-1.26-00ADD8?style=flat-square&logo=go" alt="Go 1.26" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/react-19-58C4CC?style=flat-square&logo=react" alt="React 19" /></a>
  <a href="https://hub.docker.com"><img src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker" alt="Docker" /></a>
</p>

<p align="center">
  <a href="https://nexora.suryaprakashinfo.in">Website</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#architecture">Architecture</a> •
  <a href="docs/features.md">Full Feature Guide</a> •
  <a href="https://github.com/suryaprakash251201/nexora/wiki">Wiki</a>
</p>

---

## Why Nexora

Self-hosting shouldn't mean choosing between a bare-bones file browser and an enterprise suite you don't control.

**Nexora** is a single deployable service that gives you:

- **Ownership** — files stay on your disks. No telemetry, no third-party sync.
- **Speed** — Go backend with SQLite (WAL) and indexed search. One container serves API + UI.
- **Polish** — glassmorphism UI with light/dark themes, command palette, keyboard-first workflow.
- **Flexibility** — local filesystem or S3 (AWS/R2/MinIO) roots, SQLite or PostgreSQL, Docker or bare metal, web + desktop + mobile.

> Inspired by Nextcloud/Seafile, rebuilt for the modern stack: React 19 + Vite + Tailwind 4, Chi + Argon2id, and a clean `StorageProvider` abstraction.

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Quick Start](#quick-start)
- [Deployment Variants](#deployment-variants)
- [Mobile & Desktop](#mobile--desktop)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Repository Layout](#repository-layout)
- [Configuration](#configuration)
- [API Overview](#api-overview)
- [Security](#security)
- [Development](#development)
- [Operations](#operations)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### File Workspace
Browse, upload (drag-drop + folder upload), download, create/rename/move/copy/delete/restore, archive to ZIP, extract ZIP. Trash via `.nexora-trash` with restore, favorites, recents, quota-aware usage tiles, and bulk multi-select with shift-range.

### Multiple Storage Roots
Named locations from one UI (`Files`, `Media`, `Backups`…) — each root is local or S3 with read/write grants per user. Admin super-access, read-only flag, and `indexed` toggle for search.

| Root | Type | Example |
|------|------|---------|
| Local filesystem | `local` | `Files:/mnt/files:false` |
| S3 (AWS / R2 / MinIO) | `s3` | JSON `config` with endpoint/bucket/prefix |

### Search & Organization
Indexed search (`search_index` + `media_metadata`) with filters by name, extension, kind, size, and modified date. Sorts: relevance / newest / largest / name. Tags (colored, per-user), saved searches (smart folders), and tag-a-file in one click.

### S3-Compatible Endpoint
Point any S3 client (rclone, aws cli, Cyberduck, restic) at `https://host/s3` — storage roots become buckets, files become objects, writes get versioned and indexed just like UI uploads. Auth is a personal API token (`nxr_…`) used as both access key and secret, with full SigV4 signature verification.

### Previews & Media
Images (zoom, gallery), video (HTTP Range — RFC 9110 — theater + fullscreen + subtitles), audio (lossless engine with vinyl, queue/shuffle/repeat, synced `.lrc` lyrics), PDF (pdfjs), Markdown, and code (400 kB truncation, language detection). Thumbnails are pure-Go, cached at `data/cache/thumbnails`, TTL `168h`.

| Media | Notes |
|-------|-------|
| Audio transcoding | Optional FFmpeg — frag-MP4 remux or `libx264` re-encode, HLS `EXTM3U` segments, 2 concurrent slots |
| Image thumbs | Box downscale, JPEG 80, cache key `sha256(root|rel|size|mod|dim)[:16].jpg` |
| Synced lyrics | `GET/POST/DELETE /api/v1/audio/lyrics` — auto-detects sibling `.lrc` |

### Sharing & Playlists
Revocable links bound to a single file. Scope `download` or `preview-only`, optional password (Argon2id), expiry, and `max_downloads` cap. Public page at `/s/:token`. Audio playlists with public/collaborative modes, editor role, cover picker, and folder-scored auto-covers (MP3 ID3v2, FLAC PICTURE, M4A covr).

### Photos Timeline
Cursor-paginated timeline from `search_index` LEFT JOIN `media_metadata`. Backfilled `width/height` (64 kB header parse — no full decode), EXIF `DateTime/Make/GPS`, facets by year/camera/location, sticky day headers with perfect-row packing, ambient dominant-color viewer, pinch/ctrl-zoom, OSM map clustering, and `On this day` memories strip.

### Storage Analytics
Per-root breakdown by category (images/video/audio/docs/archives/code/other), top-10 largest files, and duplicate groups (same SHA-256) with bulk navigation.

### Administration
Users/roles (`admin`/`user`/`viewer`), root grants, storage usage, audit trail (auth + file + admin events), search reindex, and Prometheus `/metrics` (opt-in).

### UX Highlights
- **Command palette** `Cmd+K` with fuzzy search + folder-scoped file search
- **Density** `compact` / `comfortable` / `spacious` + **column picker** in list view
- **View modes** grid/list, dirs-first, virtualized where needed
- **Theming** light/dark + 4 accents (`midnight` `#5B8CFF`, `amethyst`, `aurora`, `ember`) via `index.css` tokens
- **Keyboard shortcuts** `?` overlay, `G H/F/T` navigation, and full transfer panel with notifications + undo toasts

> Full walkthrough with step-by-step instructions: **[docs/features.md](docs/features.md)**

---

## Screenshots

<p align="center">Click any image to enlarge.</p>

<div align="center">
<table>
<tr>
<td width="33%" align="center"><a href="web/public/screenshots/Screenshot%20From%202026-07-27%2010-27-38.png"><img src="web/public/screenshots/Screenshot%20From%202026-07-27%2010-27-38.png" width="100%" alt="File browser — grid view" loading="lazy"></a><br><sub>File browser</sub></td>
<td width="33%" align="center"><a href="web/public/screenshots/Screenshot%20From%202026-07-27%2010-27-55.png"><img src="web/public/screenshots/Screenshot%20From%202026-07-27%2010-27-55.png" width="100%" alt="File details and previews" loading="lazy"></a><br><sub>Details & previews</sub></td>
<td width="33%" align="center"><a href="web/public/screenshots/Screenshot%20From%202026-07-27%2010-28-03.png"><img src="web/public/screenshots/Screenshot%20From%202026-07-27%2010-28-03.png" width="100%" alt="Search and filters" loading="lazy"></a><br><sub>Search</sub></td>
</tr>
<tr>
<td width="33%" align="center"><a href="web/public/screenshots/Screenshot%20From%202026-07-27%2010-28-20.png"><img src="web/public/screenshots/Screenshot%20From%202026-07-27%2010-28-20.png" width="100%" alt="Sharing dialog" loading="lazy"></a><br><sub>Sharing</sub></td>
<td width="33%" align="center"><a href="web/public/screenshots/Screenshot%20From%202026-07-27%2010-28-27.png"><img src="web/public/screenshots/Screenshot%20From%202026-07-27%2010-28-27.png" width="100%" alt="Audio playlists" loading="lazy"></a><br><sub>Playlists</sub></td>
<td width="33%" align="center"><a href="web/public/screenshots/Screenshot%20From%202026-07-27%2010-28-50.png"><img src="web/public/screenshots/Screenshot%20From%202026-07-27%2010-28-50.png" width="100%" alt="Photos timeline" loading="lazy"></a><br><sub>Photos timeline</sub></td>
</tr>
<tr>
<td width="33%" align="center"><a href="web/public/screenshots/Screenshot%20From%202026-07-27%2010-29-05.png"><img src="web/public/screenshots/Screenshot%20From%202026-07-27%2010-29-05.png" width="100%" alt="Video player" loading="lazy"></a><br><sub>Video player</sub></td>
<td width="33%" align="center"><a href="web/public/screenshots/Screenshot%20From%202026-07-27%2010-29-24.png"><img src="web/public/screenshots/Screenshot%20From%202026-07-27%2010-29-24.png" width="100%" alt="Storage analytics" loading="lazy"></a><br><sub>Analytics</sub></td>
<td width="33%" align="center"><a href="web/public/screenshots/Screenshot%20From%202026-07-27%2010-29-37.png"><img src="web/public/screenshots/Screenshot%20From%202026-07-27%2010-29-37.png" width="100%" alt="Admin panel" loading="lazy"></a><br><sub>Administration</sub></td>
</tr>
<tr>
<td width="33%" align="center"><a href="web/public/screenshots/Screenshot%20From%202026-07-27%2010-30-17.png"><img src="web/public/screenshots/Screenshot%20From%202026-07-27%2010-30-17.png" width="100%" alt="Editor" loading="lazy"></a><br><sub>Editor</sub></td>
<td width="33%" align="center"><a href="web/public/screenshots/Screenshot%20From%202026-07-27%2010-30-36.png"><img src="web/public/screenshots/Screenshot%20From%202026-07-27%2010-30-36.png" width="100%" alt="Command palette" loading="lazy"></a><br><sub>Command palette</sub></td>
<td width="33%" align="center"><a href="web/public/screenshots/Screenshot%20From%202026-07-27%2010-30-49.png"><img src="web/public/screenshots/Screenshot%20From%202026-07-27%2010-30-49.png" width="100%" alt="Mobile / responsive" loading="lazy"></a><br><sub>Responsive</sub></td>
</tr>
</table>
</div>

More polished captures: `website/assets/img/screenshots/shot-*.png` (used on the [landing page](https://nexora.suryaprakashinfo.in)).

---

## Quick Start

**Requirements:** Docker + Docker Compose. No other dependencies.

```bash
# 1. Configure
cp .env.example .env
# edit .env — at minimum set a session secret for production
openssl rand -hex 32   # paste into NEXORA_SESSION_SECRET

# 2. Start (builds API + web)
docker compose up -d --build
docker compose ps

# 3. Verify
curl -f http://localhost/healthz          # {"service":"nexora","status":"ok","version":"1.9.0"}
docker compose logs -f nexora             # tail logs
```

Open `http://localhost` → complete the first-run setup to create the admin account. Default roots from `NEXORA_DEFAULT_ROOTS` are created and granted to that admin.

**Persistent data:**

| Host | Container | Contents |
|------|-----------|----------|
| `nexora-data` volume | `/app/data` | `nexora.db`, `cache/thumbnails`, `cache/archives`, `versions`, `settings` |
| `./data/files` | `/mnt/files` | Read/write — your main workspace |
| `./data/media` | `/mnt/media` | Read-only example mount |
| `./data/backups` | `/mnt/backups` | Read/write |
| `./data/shared` | `/mnt/shared` | Read/write |

Back up the `nexora-data` volume alongside every bind mount.

```bash
docker compose down              # stop without deleting data
docker compose up -d --build     # upgrade (migrations run forward at startup)
```

---

## Deployment Variants

<details>
<summary><strong>Docker run (single container)</strong></summary>

```bash
docker build -t nexora:1.9.0 --build-arg VERSION=1.9.0 .
docker run -d --name nexora -p 8080:80 \
  -v nexora-data:/app/data \
  -v $PWD/data/files:/mnt/files \
  -e NEXORA_SESSION_SECRET=$(openssl rand -hex 32) \
  nexora:1.9.0
curl -f http://localhost:8080/healthz
```

Inside the container the server listens on `:80` (Compose) or `:8080` (from source). Map accordingly.

</details>

<details>
<summary><strong>PostgreSQL (multi-node / large metadata)</strong></summary>

```bash
# Compose with the postgres overlay (starts postgres:16-alpine on nexora-net)
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build
```

Or manual:

```bash
createdb nexora
export NEXORA_DATABASE_TYPE=postgres
export NEXORA_DATABASE_URL="postgres://user:pass@host:5432/nexora?sslmode=disable"
go build -tags postgres -o nexora ./cmd/nexora
./nexora
```

Migrations are written in SQLite syntax and rewritten for Postgres at startup (`migrations/rewrite.go` — `?`→`$N`, `datetime('now')`→`NOW()`, `strftime`→`TO_CHAR`, `INSERT OR REPLACE`→`ON CONFLICT`). All stores go through `internal/database.DB` so handlers keep using `?`.

CI verifies both `go build -tags postgres` and a real PG migration run (`postgres:16-alpine` service).

</details>

<details>
<summary><strong>From source (local dev)</strong></summary>

Prereqs: Go 1.26+, Node 20+, npm. Works on Linux/macOS/Windows with valid host paths.

```bash
# .env — replace Docker mounts with a local root for dev
NEXORA_DEFAULT_ROOTS=Files:./data/files:false
NEXORA_LISTEN_ADDR=:8080
NEXORA_WEB_ROOT=web/dist   # or /app/web in Docker

# Terminal 1 — API
go run ./cmd/nexora        # http://localhost:8080 (loads .env via godotenv)

# Terminal 2 — web (proxies /api + /healthz to :8080)
cd web && npm install && npm run dev   # http://localhost:5173
```

Without `web/dist`, the API still runs but the UI 404s — the Go server serves the built SPA from `NEXORA_WEB_ROOT`.

See [Development](#development) for validation and build commands.

</details>

<details>
<summary><strong>Behind HTTPS (Caddy / Nginx / Traefik / Cloudflare Tunnel)</strong></summary>

Nexora terminates plain HTTP inside the container. Put a TLS proxy in front:

1. Forward your domain to Nexora's HTTP port.
2. In `.env`:
   ```dotenv
   NEXORA_BASE_URL=https://files.example.com  # no trailing slash
   NEXORA_SECURE_COOKIES=true                 # requires HTTPS
   # NEXORA_TRUSTED_PROXIES=172.16.0.0/12    # only if a trusted proxy sets XFF
   ```
3. Block direct public access to the HTTP port when the proxy is on the same host.

Do **not** set `NEXORA_SECURE_COOKIES=true` for plain `http://localhost` — secure cookies require HTTPS.

Minimal Caddy example:

```caddy
files.example.com {
  reverse_proxy localhost:80
}
```

</details>

### Tailscale

Nexora can auto-provision users from `Tailscale-User-Login` headers when `NEXORA_TAILSCALE_AUTH=true`. The desktop client auto-discovers the server by probing Tailscale hosts. See [docs/tailscale.md](docs/tailscale.md) for `tailscale serve` vs `funnel` and the discovery order.

---

## Mobile & Desktop

| App | Stack | Version |
|-----|-------|---------|
| **Web** | React 19, Vite, Tailwind 4, Zustand, React Query, Motion | `1.9.0` — `web/` |
| **Desktop** | Tauri 2 wrapper around `web/dist` | `1.9.0` — `desktop/` |
| **Mobile** | Expo 54 / RN 0.81, `expo-secure-store`, `react-native-track-player` | `1.0.0` independent — `mobile/` |
| **Landing** | Static, Cloudflare Pages | `website/` |

- **Desktop dev:** `cd desktop && npm run dev` (runs `npm run dev --prefix ../web` + `tauri dev` on `http://localhost:5173`). Build: `npm run build` → `src-tauri/target/release/bundle` (`deb`/`rpm`/`AppImage`/`nsis`/`msi`). Updater polls `https://github.com/suryaprakash251201/nexora/releases/latest/download/updater.json` (minisign pubkey in `tauri.conf.json`).
- **Mobile dev:** `cd mobile && npm install && npx expo start` — read `mobile/AGENTS.md` first (Expo 54 drift from training data). `patch-package` on `postinstall` applies `mobile/patches/` (required for `react-native-track-player` on RN 0.81 / Kotlin 2.x). Shared helpers live in `packages/core` (`@nexora/core`) — import `format*`/`previewKind`/`cleanTrackTitle` from there.
- **Website:** `website/` is static → `website/DEPLOY.md` (dashboard upload, `wrangler pages deploy`, or GitHub Action).

---

## Tech Stack

| Area | Implementation |
|------|----------------|
| Frontend | React 19, TypeScript 7, Vite 8, Tailwind 4, React Query 5, Zustand 5, Motion, Base UI, shadcn |
| Backend | Go 1.26, Chi v5, `modernc.org/sqlite` (WAL, `BUSY_TIMEOUT`), optional `lib/pq` for Postgres |
| Storage | `StorageProvider` interface — `LocalFilesystemProvider` + `S3Provider` (SigV4, path/virtual hosted, prefix, R2/MinIO) |
| Auth | Argon2id, server-side sessions (SHA-256 hashed), double-submit CSRF (`SameSite=Strict`), TOTP (`pquerna/otp`), per-root ACL |
| Search | `search.Service` over `search_index` — `ScanAll` on startup + every 6 h, `ScanMediaMetadata` (EXIF/dimensions, batch 100) |
| Media | Pure-Go thumbs + cover art (ID3v2/FLAC/M4A), FFmpeg optional for video thumbs & audio transcoding (frag-MP4, HLS) |
| Jobs | Bounded worker pool (2 workers, queue 128, no unbounded goroutines), ZIP streaming with zip-slip guards, SSE progress |
| Observability | `GET /healthz` (liveness), `GET /readyz` (DB), `GET /metrics` (Prometheus, opt-in), structured JSON logs |
| Deployment | Multi-stage Docker (`100:101`, read-only rootfs, `tmpfs /tmp`, `no-new-privileges`, `nexora-data` volume, `nexora-init` chown) |
| Shared | `packages/core` (`@nexora/core`) — `formatBytes`, `previewKind`, `cleanTrackTitle`, codec table |

---

## Architecture

```mermaid
flowchart TB
  Browser[Browser<br/>React 19 / Vite] ---|/api/v1 + /healthz| API
  Desktop[Desktop<br/>Tauri 2 + web/dist] ---|same /api<br/>HashRouter| API
  Mobile[Mobile<br/>Expo 54 / RN] ---|Bearer token<br/>SecureStore| API

  subgraph Server["Go Server — cmd/nexora + internal/*"]
    API[Chi router<br/>server.go]
    API --> Auth[auth<br/>Argon2id / TOTP / sessions]
    API --> Roots[storage.RootService]
    API --> Search[search.Service]
    API --> Preview[preview.Service]
    API --> Jobs[jobs.Manager]
    API --> Events[events.Bus<br/>webhooks]
  end

  Roots --> Local[(Local FS<br/>/mnt/*)]
  Roots --> S3[(S3 / R2 / MinIO)]
  Search --> DB[(SQLite WAL<br/>or PostgreSQL)]
  Auth --> DB
  Jobs --> DB
  API --> Cache[(Cache<br/>thumbs / archives / versions)]
```

- **Route list is authoritative in `internal/api/server.go`.** App endpoints under `/api/v1`, health at `/healthz` + `/readyz`, static SPA fallback from `NEXORA_WEB_ROOT`.
- **Design tokens** — source of truth is `web/src/index.css` (`@theme` + CSS vars); human-readable summary in [docs/design-system.md](docs/design-system.md).
- **WebDAV** — `internal/webdav` is currently unwired (not mounted) — see note in [AGENTS.md](AGENTS.md).

---

## Repository Layout

```text
cmd/nexora/           Server entrypoint (wiring in main.go: event bus, search, jobs, maintenance)
internal/             Go API — handlers_*.go, auth, storage, search, preview, jobs, middleware, events
migrations/           Embedded SQLite migrations + rewrite.go (Postgres conversion + tests)
web/                  React 19 app (Vite + Tailwind 4 + Zustand + React Query) — dev :5173 proxies to :8080
mobile/               Expo 54 / RN 0.81 — see mobile/AGENTS.md before touching (patches + @nexora/core)
desktop/              Tauri 2 shell around web/dist
website/              Static landing (Cloudflare Pages) — assets, docs.html, DEPLOY.md
packages/core/        @nexora/core — format*, previewKind, cleanTrackTitle, codec table
Dockerfile            Multi-stage (node build + go build + runtime as 100:101)
docker-compose.yml    Recommended deploy (nexora + nexora-init chown sidecar)
docker-compose.postgres.yml  Overlay for postgres:16-alpine
.env.example          Documented NEXORA_* defaults
Makefile              build / test / lint / docker targets
VERSION               Single source of truth (1.9.0) — web/desktop/image derive from it
```

---

## Configuration

All config is `NEXORA_*` env (`.env` loaded via `godotenv`). `Config.Validate()` enforces `NEXORA_DATABASE_URL` for postgres, `NEXORA_SESSION_SECRET` length, and `NEXORA_CORS_ORIGINS` format.

Copy `.env.example` → `.env` for documented defaults, then set at minimum:

```dotenv
NEXORA_SESSION_SECRET=  # openssl rand -hex 32 — auto-generated + persisted if blank (stable secret recommended)
NEXORA_BASE_URL=https://files.example.com
NEXORA_SECURE_COOKIES=true
```

<details>
<summary><strong>Full variable reference</strong></summary>

| Variable | Default | Purpose |
|----------|---------|---------|
| `NEXORA_LISTEN_ADDR` | `:8080` (`:80` in Compose) | HTTP listen address |
| `NEXORA_BASE_URL` | `http://localhost:8080` | Public origin for share links (no trailing slash) |
| `NEXORA_DATA_DIR` | `./data` (`/app/data`) | DB + cache + versions |
| `NEXORA_DATABASE_TYPE` | `sqlite` | `sqlite` or `postgres` |
| `NEXORA_DATABASE_PATH` | `$DATA_DIR/nexora.db` | SQLite file |
| `NEXORA_DATABASE_URL` | — | `postgres://user:pass@host:5432/nexora?sslmode=disable` |
| `NEXORA_THUMBNAIL_CACHE_DIR` | `$DATA_DIR/cache/thumbnails` | Thumbnail cache |
| `NEXORA_THUMBNAIL_MAX_SIZE` | `20MB` | Max source size to attempt a thumb |
| `NEXORA_THUMBNAIL_TTL` | `168h` | Thumbnail cache lifetime |
| `NEXORA_ENABLE_FFMPEG_THUMBS` | `false` | Video thumbs (needs `ffmpeg` in image) |
| `NEXORA_MAX_EDITABLE_SIZE` | `5MB` | Built-in editor size cap |
| `NEXORA_SESSION_SECRET` | auto | Session signing secret (≥16 chars when set) |
| `NEXORA_SESSION_LIFETIME` | `168h` | Session duration (Go duration) |
| `NEXORA_SECURE_COOKIES` | `false` in Compose | `Secure` + HSTS gate |
| `NEXORA_TRUSTED_PROXIES` | — | CIDRs allowed to send `X-Forwarded-For` |
| `NEXORA_CORS_ORIGINS` | — | Comma-separated allow-list; empty→allow-any (for Tauri/Tailscale) |
| `NEXORA_MAX_UPLOAD_SIZE` | `512GB` | Human sizes (`2GB`) accepted |
| `NEXORA_ALLOWED_MIME` | (all) | Comma-separated upload allow-list |
| `NEXORA_RATE_LIMIT_PER_MIN` | `60` | Per-IP login/share limiter |
| `NEXORA_LOCKOUT_ATTEMPTS` | `5` | Failed logins before lockout |
| `NEXORA_LOCKOUT_WINDOW` | `15m` | Lockout window |
| `NEXORA_DEFAULT_ROOTS` | `Files:/mnt/files:false,...` | `Name:/path:readOnly[:indexed]` — auto-created on first setup |
| `NEXORA_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `NEXORA_LOG_FORMAT` | `json` | `json`/`text` |
| `NEXORA_ENABLE_PROMETHEUS` | `false` | Exposes `GET /metrics` |
| `NEXORA_WEB_ROOT` | `web/dist` | Static UI root (env-only) |
| `NEXORA_PLAYLIST_COVER_PATH` | — | Custom playlist cover dir |
| `NEXORA_TAILSCALE_AUTH` | `false` | Trust `Tailscale-User-Login` header |
| `NEXORA_ALLOW_REGISTRATION` | `true` | Reserved |
| `NEXORA_READONLY_FS` | `false` | Reserved |

Postgres note: the Go package compiles with `-tags postgres` (`lib/pq`). CI builds both variants. The dialect wrapper (`internal/database.DB`) rewrites `?`→`$N`, `datetime('now')`→`NOW()`, `strftime`→`TO_CHAR`, and `INSERT OR REPLACE`→`ON CONFLICT` transparently.

</details>

---

## API Overview

Base: `/api/v1`. Health at `/healthz` + `/readyz`. Full list in [internal/api/server.go](internal/api/server.go).

| Group | Examples |
|-------|----------|
| Health | `GET /healthz`, `GET /readyz`, `GET /metrics` (when enabled), `GET /api/v1/version` |
| Public shares | `GET /share/{token}`, `POST /share/{token}/verify`, `GET /share/{token}/download`, `GET /share/{token}/raw` (all rate-limited) |
| Auth | `POST /auth/setup`, `POST /auth/login`, `POST /auth/tailscale`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/totp/*` |
| Files | `GET /files`, `GET /files/stat`, `POST /files/directory`, `POST /files/rename|move|copy`, `DELETE /files`, `POST /files/upload`, `GET /files/download|raw|transcode`, `GET /files/hls/*` |
| Media | `GET /audio/info|formats|lyrics`, `POST /audio/lyrics`, `GET /files/thumbnail|checksum|metadata|transcode` |
| Editor | `GET /files/content`, `POST /files/save` (optimistic `version`) |
| Versions | `GET /files/versions`, `POST /files/versions`, `POST /files/versions/{id}/restore`, `DELETE /files/versions/{id}` |
| Organization | `GET /search`, `GET /tags`, `POST /tags`, `POST /files/tag`, `GET /favorites`, `GET /recents`, `GET /photos`, `GET /saved-searches` |
| Playlists | `GET /playlists`, `POST /playlists`, `PUT /playlists/{id}`, `POST /playlists/{id}/items`, `GET /playlists/public` |
| Jobs | `POST /archive`, `POST /extract`, `GET /jobs`, `GET /jobs/{id}`, `GET /jobs/{id}/events` (SSE), `GET /jobs/{id}/download` |
| Shares | `GET /shares`, `POST /shares`, `DELETE /shares/{id}` |
| Webhooks | `GET /webhooks`, `POST /webhooks`, `DELETE /webhooks/{id}` (events: `file.*`, `directory.created`, `share.*`, `version.*` — HMAC `X-Nexora-Signature`) |
| Admin | `GET/POST/PUT/DELETE /admin/roots`, `GET/POST/PUT/DELETE /admin/users`, `POST /admin/users/{id}/roots`, `GET /admin/audit`, `POST /admin/search/reindex`, `GET /admin/usage` |

All state-changing requests require `X-CSRF-Token` (double-submit, exempt on login/setup/share/csrf/health). Tailscale auth and share password may arrive via `Authorization` / `X-Share-Password` headers.

---

## Security

See [SECURITY.md](SECURITY.md) for the full policy and reporting (48 h ack via GitHub Security Advisories).

**Built-in:**

- Argon2id passwords, SHA-256-hashed session tokens, HTTP-only `SameSite=Strict` cookies, double-submit CSRF
- Per-IP rate limiting + 5/15 min lockout, path-traversal guard (`CleanRelative` + `Resolve` + symlink eval), zip-slip protection, CSP/HSTS/`X-Content-Type-Options` headers
- Permission-scoped roots — path validation prevents escape outside an authorized root
- TOTP optional 2FA, audit trail for auth/admin/file events

**Hardening checklist for public installs:**

1. Terminate HTTPS at a reverse proxy, set `NEXORA_BASE_URL` + `NEXORA_SECURE_COOKIES=true`.
2. Set `NEXORA_CORS_ORIGINS` explicitly (empty allows any origin for Tauri/Tailscale convenience).
3. Generate and persist `NEXORA_SESSION_SECRET` (`openssl rand -hex 32`).
4. Optionally restrict uploads via `NEXORA_ALLOWED_MIME`.
5. Bind `NEXORA_LISTEN_ADDR` to loopback when a proxy is on the same host.
6. Back up `nexora-data` regularly — migrations are forward-only; rollback is restore DB + prior image.

**Docker hardening:** image runs as unprivileged `100:101`, read-only rootfs, `no-new-privileges`, dropped caps, `tmpfs /tmp`, `nexora-init` one-shot chowns mounts.

---

## Development

### Prereqs

- Go 1.26+, Node 20+, npm
- Docker for containered testing; `ffmpeg` optional for video thumbs/transcoding

### Commands

```bash
# Backend
go run ./cmd/nexora              # .env auto-loaded
make test                        # go test ./... -count=1
go test ./internal/api -run TestName -count=1   # single test
make lint                        # go mod tidy + go vet (+ golangci-lint if installed)
make lint-full                   # also web + packages/core typechecks
make build                       # bin/nexora

# Web
cd web && npm install && npm run dev     # :5173 proxies to :8080
cd web && npm run lint                   # tsc --noEmit
cd web && npm run build                  # tsc -b && vite build → web/dist

# Shared helpers — import from @nexora/core, don't duplicate
# packages/core is single source for format*, previewKind, cleanTrackTitle, codec table

# Mobile — read mobile/AGENTS.md first (Expo 54 docs differ from common knowledge)
cd mobile && npm install                 # runs patch-package (patches/ required for RN 0.81)
npx expo start                           # QR for Expo Go

# Desktop
cd desktop && npm run dev                # tauri dev (needs web dev server)
cd desktop && npm run build              # tauri build → src-tauri/target/release/bundle

# Docker
make docker-build                        # image nexora:nexora
docker compose up -d --build
```

CI (`.github/workflows/ci.yml`) runs `go vet`, `go test`, both `postgres` and plain builds, a real Postgres migration test, web typecheck/build, mobile patch verification, and core typecheck — mirror it before pushing.

### Local storage paths (dev)

Use a relative root to avoid host permission issues:

```dotenv
NEXORA_DEFAULT_ROOTS=Files:./data/files:false
```

### Project conventions

- Migrations: add a new numbered `.sql` in `migrations/` — **never** edit an already-applied one.
- Postgres: keep new SQL convertible via `migrations.ToPostgres`; CI compiles the `postgres` tag.
- Design tokens: `web/src/index.css` is truth; `docs/design-system.md` is the human summary.
- Endpoint docs: `internal/api/server.go`.

---

## Operations

### Health

```bash
curl -f http://localhost/healthz   # liveness  — always 200 when process is up
curl -f http://localhost/readyz    # readiness — 200 only when DB is reachable
# Prometheus (when NEXORA_ENABLE_PROMETHEUS=true)
curl http://localhost/metrics
```

### Backup & Restore

Back up **both** the `nexora-data` volume and every bind mount (`./data/files|media|backups|shared`). For Postgres, also dump the PG data volume.

```bash
# SQLite example
docker run --rm -v nexora-data:/data -v $PWD:/backup alpine tar czf /backup/nexora-data.tgz /data
# Restore = stop, restore volume, restart prior image (migrations only go forward)
```

### Observability

- Structured JSON logs (`NEXORA_LOG_LEVEL`, `NEXORA_LOG_FORMAT`)
- Maintenance loop (15 m: session sweep, rate-limit GC, share expiry, thumb purge, archive GC, reset-token GC; 6 h: `search.ScanAll`)
- Job progress via SSE `GET /api/v1/jobs/{id}/events`

### Troubleshooting

See **[docs/features.md#troubleshooting](docs/features.md#troubleshooting)** and the [Wiki](https://github.com/suryaprakash251201/nexora/wiki) for Docker build, DB, permission, and health-check recipes. Common fix:

```bash
docker compose down
sudo chown -R 100:101 data/   # match container uid:gid when perms drift
docker compose up -d --build
```

---

## Contributing

Issues and PRs welcome. Please:

- Run `make lint` (and `cd web && npm run lint`) before pushing.
- Add tests for backend changes (`go test ./... -count=1 -race` locally if possible).
- For `mobile/`, verify `npx patch-package --error-on-fail` after dependency changes.
- Keep migrations forward-only and convertible for Postgres.

Versioning follows SemVer; current version in root [`VERSION`](VERSION) (`1.9.0`) — `web` and `desktop` are synced to it, `mobile` has an independent store version.

---

## License

[MIT](LICENSE) — © 2026 Nexora contributors

---

<p align="center">
  <sub>Built with Go · React · SQLite · Tauri · Expo — self-hosted, forever.</sub>
</p>

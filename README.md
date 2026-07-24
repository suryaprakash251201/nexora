# Nexora

Nexora is a private, self-hosted file workspace. It combines a React interface, a Go API, SQLite metadata, and one or more local storage roots in a single deployable service.

## Features

- **File workspace:** browse, upload, download, create, rename, move, copy, delete, restore, and archive files.
- **Multiple storage roots:** manage named locations from one UI; grant read or write access to individual users.
- **Search and organization:** indexed search, tags, favorites, recents, checksums, metadata, and duplicate-file discovery.
- **Previews and media:** images, video, audio, PDFs, Markdown, and code; video supports range streaming, subtitles, theater mode, and browser fullscreen.
- **Sharing:** create revocable public links with optional expiry, password protection, and download limits.
- **Audio playlists:** create and manage playlists, including public and collaborative playlists.
- **Administration:** users, roles, root access, storage settings, audit history, and search reindexing.
- **Responsive UX:** light/dark themes, profile settings, keyboard shortcuts, and mobile navigation.

## Technical specifications

| Area | Implementation |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Query, Zustand, Motion |
| Backend | Go, Chi router, SQLite with embedded migrations |
| Storage | Local filesystem provider with configurable named roots |
| Authentication | Argon2id passwords, server-side sessions, CSRF protection, optional TOTP |
| Media | Image thumbnails, HTTP Range streaming, optional FFmpeg thumbnails/transcoding |
| Deployment | Multi-stage Docker build; one container serves the API and the compiled web app |
| Persistent data | SQLite, thumbnail cache, and archive workspace in `/app/data` |
| Health | `GET /healthz` for liveness and `GET /readyz` for database readiness |

## Architecture

```text
Browser
  |
  +-- React / Vite interface
          |
          +-- /api/v1
                  |
                  +-- Go API: auth, files, search, previews, shares, playlists, jobs
                  +-- SQLite: users, metadata, settings, audit data
                  +-- Mounted filesystem roots: files, media, backups, shared data
```

## Repository layout

```text
cmd/nexora/          Application entry point
internal/            Go API, auth, storage, search, previews, jobs, middleware
migrations/          Embedded SQLite migrations
web/                 React application
Dockerfile           Production multi-stage image
docker-compose.yml   Docker deployment
.env.example         Runtime configuration template
Makefile             Build, test, and Docker commands
```

## Deploy with Docker

Docker Compose is the recommended deployment path. It builds both applications and exposes Nexora on port `80`.

### 1. Configure the instance

```bash
cp .env.example .env
```

For a public HTTPS deployment, set these values in `.env`:

```dotenv
# Public URL for generated share links; no trailing slash.
NEXORA_BASE_URL=https://files.example.com

# Use a stable random secret for sessions.
NEXORA_SESSION_SECRET=replace-with-a-long-random-secret

# Required when HTTPS is terminated by a reverse proxy.
NEXORA_SECURE_COOKIES=true

# Set only when a trusted proxy supplies client-IP headers.
# NEXORA_TRUSTED_PROXIES=172.16.0.0/12
```

Generate a session secret:

```bash
openssl rand -hex 32
```

If the session secret is blank, Nexora generates one and persists it in SQLite. Supplying a stable secret is recommended for managed deployments.

### 2. Start Nexora

```bash
docker compose up -d --build
docker compose ps
```

Open `http://localhost` for a local installation. Complete the first-run screen to create the administrator account. Nexora creates the configured default storage roots and grants that administrator access.

The included Compose file mounts the following folders:

| Host folder | Container path | Access |
| --- | --- | --- |
| `./data/files` | `/mnt/files` | Read/write |
| `./data/media` | `/mnt/media` | Read-only |
| `./data/backups` | `/mnt/backups` | Read/write |
| `./data/shared` | `/mnt/shared` | Read/write |

The named `nexora-data` volume contains SQLite, the thumbnail cache, and temporary archive workspace. Back it up alongside the mounted storage folders.

### 3. Verify and operate

```bash
curl -f http://localhost/healthz
docker compose logs -f nexora
docker compose restart nexora
```

Stop the services without deleting data:

```bash
docker compose down
```

## Deploy behind HTTPS

Nexora serves HTTP inside its container. For an internet-facing server, place Caddy, Nginx, Traefik, Cloudflare Tunnel, or another TLS proxy in front of it.

1. Configure the proxy to forward your domain to Nexora's HTTP port.
2. Set `NEXORA_BASE_URL` to the public HTTPS URL.
3. Set `NEXORA_SECURE_COOKIES=true`.
4. Set `NEXORA_TRUSTED_PROXIES` only to the proxy networks that should be trusted for `X-Forwarded-For` and `X-Real-IP`.
5. Prevent direct public access to the HTTP port when the proxy is on the same server.

Do not enable `NEXORA_SECURE_COOKIES=true` for a plain `http://localhost` installation because secure cookies require HTTPS.

## Local development

Prerequisites: Go 1.26+, Node.js 20+, and npm. Docker Desktop is the easiest local route on Windows; source development works when storage root paths are valid for the host operating system.

Create local configuration and replace the Docker-oriented default roots in `.env` with a local one:

```dotenv
NEXORA_DEFAULT_ROOTS=Files:./data/files:false
```

Run the API:

```bash
go run ./cmd/nexora
```

Run the web app in a second terminal:

```bash
cd web
npm install
npm run dev
```

The Vite development server is available at `http://localhost:5173` and proxies `/api` and `/healthz` to `http://localhost:8080`.

### Validation and build commands

```bash
# Frontend type check
cd web && npm run lint

# Production frontend build
cd web && npm run build

# Backend tests
make test

# Production image
make docker-build
```

## Configuration reference

Copy `.env.example` to `.env` for the documented defaults. Key settings:

| Variable | Purpose |
| --- | --- |
| `NEXORA_LISTEN_ADDR` | HTTP listen address; Compose sets this to `:80`. |
| `NEXORA_BASE_URL` | Public base URL for generated share links. |
| `NEXORA_DATA_DIR` | Database, cache, and archive-workspace directory. |
| `NEXORA_DATABASE_PATH` | SQLite database path. |
| `NEXORA_SESSION_SECRET` | Session-signing secret. |
| `NEXORA_SECURE_COOKIES` | Set to `true` for HTTPS. |
| `NEXORA_MAX_UPLOAD_SIZE` | Maximum upload size, for example `2GB`. |
| `NEXORA_ALLOWED_MIME` | Optional comma-separated upload allowlist. |
| `NEXORA_DEFAULT_ROOTS` | Roots created on first setup: `Name:/path:readOnly[:indexed]`. |
| `NEXORA_TRUSTED_PROXIES` | Proxy CIDRs allowed to send client-IP headers. |
| `NEXORA_CORS_ORIGINS` | Allowed browser origins; empty disables CORS. |
| `NEXORA_ENABLE_FFMPEG_THUMBS` | Enables FFmpeg video thumbnail generation. |
| `NEXORA_ENABLE_PROMETHEUS` | Enables the `/metrics` endpoint. |
| `NEXORA_MAX_EDITABLE_SIZE` | Maximum file size for the built-in editor. |

## Security and operations

- Passwords use Argon2id; sessions are server-side and use HTTP-only cookies.
- State-changing requests require CSRF validation.
- Login attempts are rate-limited and protected by account lockouts.
- Storage access is permission-scoped, and path validation prevents traversal outside an authorized root.
- The Docker image runs as an unprivileged user with a read-only root filesystem, dropped capabilities, and a temporary `/tmp` filesystem.
- Audit records cover authentication, administration, and file activity.

Upgrade with:

```bash
docker compose up -d --build
```

Back up the `nexora-data` volume and every mounted storage folder before upgrades. Migrations run forward at startup; restoring the database and prior image is the safe rollback method.

## API and design

Application endpoints are under `/api/v1`; public health checks are `/healthz` and `/readyz`. The complete current route list is in [internal/api/server.go](internal/api/server.go).

Frontend design tokens and visual guidance are in [docs/design-system.md](docs/design-system.md). Brand assets are in [web/public](web/public).

## License

[MIT](LICENSE)

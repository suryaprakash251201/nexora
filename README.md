# Nexora

**Your private file workspace.**

Nexora is a modern, lightweight, secure, self-hosted file-management platform — a
fast alternative to File Browser. It runs efficiently on low-spec hardware (2
vCPU / 1 GB RAM) and deploys as a single Docker container with a small image
and low idle memory.

## Brand Guidelines

### Logo
- **Primary logo**: [logo.svg](web/public/logo.svg) - SVG vector with gradient
- **Favicon**: [favicon.svg](web/public/favicon.svg) - Simplified N-shape with blue gradient

### Colors
- **Primary blue**: `#2563EB` (accessible for colorblind users)
- **Dark mode blue**: `#3B82F6`
- Consistent theming across light and dark modes with WCAG AA contrast ratios

### Design Philosophy
- **Glassmorphism**: Translucent layered effects with backdrop blur
- **Accessibility**: All text meets 4.5:1 contrast ratio, keyboard navigation
- **Performance**: Optimized animations with reduced motion support
- **Consistency**: 12-column grid, spacing scale, unified component system

## Resources

### Design System
See [docs/design-system.md](docs/design-system.md) for complete design guidelines, color palette, typography, and component specifications.

### Brand Assets
All official brand assets are in the `web/public/` directory.

### Live Demo
Deploy with Docker: `docker compose up -d --build`

Visit `http://localhost:80` to see the live application.

---

## Why Nexora

- **Fast & small** — Go backend (single static binary) + a tiny React/Vite UI.
  SQLite by default, native file APIs, no always-on services.
- **Secure by default** — Argon2id password hashing, HTTP-only session cookies,
  CSRF protection, security headers (CSP/HSTS-class), login rate-limiting with
  exponential backoff, strict path validation (no traversal), and audit logging.
- **Multi-storage** — manage several named storage roots (Files, Media,
  Backups, Shared…) from one dashboard; users only see what they're authorized
  for.
- **Rich previews** — images, video (HTTP Range streaming), audio, PDF,
  markdown, and code, plus a built-in editor for text/code files.
- **Sharing** — expiring, optionally password-protected, optionally capped
  share links with revocation.
- **Docker-native** — multi-stage build, non-root user, read-only root FS,
  dropped capabilities, `/healthz` + `/readyz`, named volume for data.

---

## Architecture

Nexora is a **modular monolith**. The backend is written in Go and organized
around interfaces so storage adapters can be added later without touching the
API layer.

```
Browser (React/Vite)  ──HTTP/JSON──▶  Go API (Chi router)
                                      ├─ auth (Argon2id, sessions, CSRF, guard)
                                      ├─ storage (provider abstraction + local FS)
                                      ├─ files / search / sharing / preview / jobs
                                      ├─ audit (append-only log)
                                      └─ database (SQLite WAL, embedded migrations)
```

### Storage provider abstraction

A single interface drives every backend:

```go
type StorageProvider interface {
    List(path string) ([]FileInfo, error)
    Stat(path string) (FileInfo, error)
    Read(path string) (io.ReadCloser, error)
    Write(path string, r io.Reader, size int64) error
    CreateDirectory(path string) error
    Move(source, destination string) error
    Copy(source, destination string) error
    Delete(path string) error
    OpenRange(path string, start, end int64) (io.ReadCloser, int64, error)
    Search(q SearchQuery) ([]FileInfo, error)
    GetQuota() (Quota, error)
}
```

- Implemented now: **`LocalFilesystemProvider`**.
- Designed for later: **S3**, **SFTP**, **WebDAV**, **SMB/NFS** (host-mounted).

### Repository layout

```
cmd/nexora/main.go      Entrypoint: wiring, graceful shutdown, maintenance.
internal/
  auth/                 Password hashing, sessions, CSRF, login guard, middleware.
  config/               Environment-based configuration with secure defaults.
  database/             SQLite open + WAL tuning.
  api/                  Versioned REST API (/api/v1) + static file server.
  middleware/           Request ID, security headers, real-IP, rate limit, CSRF.
  storage/              Provider interface, local FS, roots service, path safety.
  audit/                Append-only audit log store.
  logger/               Structured JSON logger.
  util/                 Shared helpers.
migrations/             Embedded, ordered SQL migrations.
web/                    React + Vite + TypeScript front end (built to web/dist).
Dockerfile, docker-compose.yml, .env.example, Makefile, README.md, LICENSE
```

---

## Quick start (Docker)

```bash
# 1. Configure
cp .env.example .env
# Generate a session secret and paste it into .env:
openssl rand -hex 32

# 2. Create the host directories that will be mounted:
mkdir -p data/files data/media data/backups data/shared

# 3. Launch
docker compose up -d --build

# 4. Open http://localhost:8080 and complete first-run setup.
```

On first launch, Nexora detects there are no users and shows the **setup**
screen to create the initial admin account. Default storage roots are created
from `NEXORA_DEFAULT_ROOTS` and the admin is granted full access.

### Equivalent with the binary (local dev)

```bash
make build
mkdir -p data/files data/media data/backups data/shared
./bin/nexora            # reads .env if present, or sensible defaults
```

---

## Configuration

All settings are environment variables (optionally loaded from `.env`). The most
important are summarized below; see `.env.example` for the full list.

| Variable | Default | Purpose |
|---|---|---|
| `NEXORA_LISTEN_ADDR` | `:8080` | Listen address/port. |
| `NEXORA_DATA_DIR` | `./data` | App data directory (DB, cache). |
| `NEXORA_DATABASE_PATH` | `./data/nexora.db` | SQLite database file. |
| `NEXORA_SESSION_SECRET` | auto | Signs sessions/tokens. Generate with `openssl rand -hex 32`. |
| `NEXORA_SESSION_LIFETIME` | `168h` | Session duration. |
| `NEXORA_MAX_UPLOAD_SIZE` | `2GB` | Max upload size (bytes or `2GB`). |
| `NEXORA_RATE_LIMIT_PER_MIN` | `60` | Login attempts per IP per minute. |
| `NEXORA_LOCKOUT_ATTEMPTS` / `WINDOW` | `5` / `15m` | Lockout thresholds. |
| `NEXORA_TRUSTED_PROXIES` | `` | CIDRs allowed to set client IP headers. |
| `NEXORA_CORS_ORIGINS` | `` | CORS origins (disabled if empty). |
| `NEXORA_LOG_LEVEL` / `FORMAT` | `info` / `json` | Logging. |
| `NEXORA_DEFAULT_ROOTS` | see example | Roots auto-created on first run. |
| `NEXORA_ENABLE_PROMETHEUS` | `false` | Optional metrics endpoint. |

---

## API (v1)

Base path: `/api/v1`. Errors use a consistent envelope:

```json
{ "error": "code", "message": "human readable", "request": "<request-id>" }
```

Highlights (more added per phase):

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/healthz` | – | Liveness. |
| `GET` | `/readyz` | – | Readiness (DB ping). |
| `GET` | `/version` | – | Version info. |
| `POST` | `/auth/setup` | – | First-run admin creation. |
| `POST` | `/auth/login` | – | Login (rate-limited). |
| `GET` | `/auth/session` | ✓ | Current user. |
| `POST` | `/auth/logout` | ✓ | Logout (CSRF). |
| `POST` | `/auth/password` | ✓ | Change password (CSRF). |
| `GET` | `/roots` | ✓ | Storage roots the user can access. |

State-changing requests require a `X-CSRF-Token` header matching the
`nexora_csrf` cookie (issued automatically). List/search/audit endpoints are
paginated (cursor/offset) and include `X-Request-ID`.

---

## Security model

- **Passwords:** Argon2id (`m=64MiB, t=1, p=4`), per-user salt.
- **Sessions:** random token, SHA-256 stored hash, HTTP-only + SameSite=Lax
  cookie, server-side expiry and cleanup.
- **CSRF:** double-submit cookie for all unsafe methods.
- **Path safety:** every path is cleaned and resolved; traversal (`..`),
  absolute paths, backslashes, and null bytes are rejected. Users never see or
  traverse host paths outside their authorized roots.
- **Rate limiting / lockout:** per-IP login limiter + per-account exponential
  backoff after repeated failures.
- **Headers:** CSP, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options: DENY`, restrictive Permissions-Policy.
- **Audit:** logins, failed logins, uploads, deletes, moves, shares, and admin
  actions are recorded.
- **Container:** non-root user, read-only root filesystem, dropped capabilities
  (`cap_drop: ALL`), `no-new-privileges`.

---

## Reverse proxy (optional)

Nexora binds plain HTTP on port `8080`. Put a TLS-terminating proxy in front.
Examples for **Caddy** and **Nginx** are provided in `docker-compose.example.yml`
and the `docs/` proxy snippets. Don't bind the container port publicly without a
proxy unless you accept plain HTTP. Cloudflare Tunnel and Tailscale access are
documented but not bundled.

---

## Backup & restore

Nexora stores everything in `NEXORA_DATA_DIR` (database + cache). To back up:

```bash
# Stop the container to ensure a clean SQLite state (or rely on WAL checkpoint):
docker compose exec nexora /bin/sh -c 'cp /app/data/nexora.db /tmp/nexora.db.bak'
docker cp nexora:/tmp/nexora.db.bak ./nexora.db.bak
# Also back up your host bind-mount directories (data/files, data/media, ...).
```

Restore by stopping the container, replacing `nexora.db` (and the bind-mount
contents), and starting again.

---

## Upgrade & rollback

```bash
docker compose pull        # or: docker compose up -d --build
docker compose up -d
```

Because migrations are embedded and forward-only, downgrades are not automatic.
To roll back: restore the previous image tag **and** the database backup taken
before the upgrade.


---

## License

MIT — see [LICENSE](./LICENSE).

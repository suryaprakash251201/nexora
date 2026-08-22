# Installation

Nexora ships as a single container that serves both the Go API and the compiled React app (`web/dist` at `NEXORA_WEB_ROOT`). Choose the path that fits your environment.

## A. Docker Compose (recommended)

```bash
cp .env.example .env
# edit .env — see Configuration
docker compose up -d --build
curl -f http://localhost/healthz
```

Compose details ([docker-compose.yml](../docker-compose.yml)):

- Build arg `VERSION` defaults from `VERSION` file (`1.8.0`).
- `nexora-init` one-shot (Alpine) `chown -R 100:101 /mnt/files /mnt/backups /mnt/shared /app/data` so the unprivileged `nexora` user (100:101) can write with a read-only rootfs (`read_only: true`, `tmpfs: /tmp`, `no-new-privileges`, `cap_drop: ALL`).
- Healthcheck: `wget -qO- http://127.0.0.1:80/healthz`.
- Ports: `${NEXORA_HTTP_PORT:-80}:80` — change the host side to avoid conflicts.

**Upgrade:**

```bash
git pull
docker compose up -d --build
```

**Stop without deleting data:**

```bash
docker compose down
```

## B. Single `docker run`

```bash
docker build -t nexora:1.8.0 --build-arg VERSION=1.8.0 .
docker run -d --name nexora -p 8080:80 \
  -v nexora-data:/app/data \
  -v $PWD/data/files:/mnt/files \
  -v $PWD/data/media:/mnt/media:ro \
  -v $PWD/data/backups:/mnt/backups \
  -v $PWD/data/shared:/mnt/shared \
  -e NEXORA_SESSION_SECRET=$(openssl rand -hex 32) \
  -e NEXORA_BASE_URL=http://localhost:8080 \
  nexora:1.8.0
```

Inside the image `NEXORA_LISTEN_ADDR` is `:80`; map host → container accordingly. Host networking is set at build time to avoid DNS failures behind Tailscale MagicDNS — not needed at runtime.

## C. PostgreSQL (scale / multi-node)

Default is **SQLite** (WAL, zero deps). For concurrent writes, HA, or 100 GB+ metadata:

**Compose overlay:**

```bash
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build
```

`docker-compose.postgres.yml` starts `postgres:16-alpine` on `nexora-net` with `nexora:nexora / nexora_test` DB.

**Manual / bare metal:**

```bash
createdb nexora
export NEXORA_DATABASE_TYPE=postgres
export NEXORA_DATABASE_URL="postgres://user:pass@host:5432/nexora?sslmode=disable"
go build -tags postgres -o nexora ./cmd/nexora
./nexora
```

Migrations are SQLite-authored and rewritten on the fly (`migrations/rewrite.go`): `?`→`$N`, `datetime('now')`→`NOW()`, `strftime`→`TO_CHAR`, `INSERT OR REPLACE`→`ON CONFLICT`, stripping `PRAGMA`. All stores use `internal/database.DB` so handlers stay `?`-style. CI verifies `go build -tags postgres` plus a real PG migration test against `postgres:16-alpine`.

To migrate data from SQLite, dump and import — schema is auto-created on first Postgres boot.

## D. From Source (bare metal / local dev)

Prereqs: **Go 1.26+**, **Node 20+**, npm. No Docker required — just valid host paths.

```bash
NEXORA_DEFAULT_ROOTS=Files:./data/files:false  # in .env — Docker mounts won't exist on host
go run ./cmd/nexora                            # http://localhost:8080 (loads .env via godotenv)

# second terminal
cd web && npm install && npm run dev           # http://localhost:5173 — proxies /api + /healthz to :8080
```

Build the UI for production:

```bash
cd web && npm run build   # tsc -b && vite build → web/dist (no sourcemap)
# then export NEXORA_WEB_ROOT=web/dist before running the server
```

Without `web/dist` the API still runs; the UI 404s (Go serves `web/dist` via `NEXORA_WEB_ROOT` with SPA fallback).

## E. Desktop & Mobile

Desktop wraps the same `web/dist`; mobile is an Expo app — both point at the running server's `/api`.

- **Desktop (Tauri 2):** `cd desktop && npm run dev` (runs `npm run dev --prefix ../web` + `tauri dev`). Build `npm run build` → `src-tauri/target/release/bundle` (`deb`/`rpm`/`AppImage`/`nsis`/`msi`). Uses `HashRouter` (no server fallback on `file://`), `window-state`, tray hide-to-close, updater polling `updater.json`.
- **Mobile (Expo 54 / RN 0.81):** `cd mobile && npm install && npx expo start`. See [Mobile & Desktop](Mobile-and-Desktop) for patches and `@nexora/core`.

## Image & Versioning

- Single source of truth: root `VERSION` (`1.8.0`) → `web/package.json`, `desktop/package.json`, `tauri.conf.json`, `Cargo.toml`, `Dockerfile` `VERSION` arg. `mobile` is independent (`1.0.0`).
- Base images in `Dockerfile`/`tauri-build.yml` are moving tags (`alpine:3.20`, `node:20-alpine`, `golang:1.26-alpine`); `npm ci` is used for reproducible installs where supported.

## Verifying the Install

```bash
curl -f http://localhost/healthz   # liveness
curl -f http://localhost/readyz    # DB readiness
# Prometheus (when NEXORA_ENABLE_PROMETHEUS=true)
curl http://localhost/metrics
docker compose logs -f nexora
```

If the UI shows `http://localhost` setup but API is on another origin, set `NEXORA_CORS_ORIGINS` and `NEXORA_BASE_URL` correctly (see [Configuration](Configuration) and [Deployment](Deployment)).

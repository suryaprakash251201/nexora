# Deployment

## Environments

| Path | When | How |
|------|------|-----|
| **Compose (recommended)** | Home lab, single host | `docker compose up -d --build` |
| **`docker run`** | One-off / testing | `docker run -p 8080:80 …` |
| **Bare metal** | No Docker / Windows native | `go run ./cmd/nexora` + `cd web && npm run dev` |
| **Postgres** | Multi-node / 100 GB+ metadata | Compose overlay or `go build -tags postgres` |
| **Cloud** | Internet-facing | Behind Caddy/Nginx/Traefik/Cloudflare Tunnel + harden per [Security](Security) |

## HTTPS — Put a TLS Proxy in Front

Nexora listens plain HTTP inside the container. Never expose that port directly to the internet.

**1. Configure Nexora (`.env`):**

```dotenv
NEXORA_BASE_URL=https://files.example.com  # no trailing slash
NEXORA_SECURE_COOKIES=true                 # enables Secure + HSTS
# NEXORA_TRUSTED_PROXIES=172.16.0.0/12    # only the proxy CIDRs — needed for correct RealIP/rate limit
# NEXORA_CORS_ORIGINS=https://files.example.com  # lock down when public
```

For `http://localhost` keep `SECURE_COOKIES=false`.

**2. Example Caddy:**

```caddy
files.example.com {
  reverse_proxy localhost:80
}
# or for dev convenience
:80 {
  reverse_proxy localhost:8080
}
```

**Nginx sketch:**

```nginx
server {
  listen 443 ssl http2;
  server_name files.example.com;
  location / {
    proxy_pass http://127.0.0.1:80;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Host $host;
  }
}
```

**With Cloudflare Tunnel:** `cloudflared tunnel --url http://localhost:80`.

Block direct access to the HTTP port when the proxy is on the same host (e.g. `NEXORA_LISTEN_ADDR=127.0.0.1:80` or firewall rule).

## Tailscale

Nexora supports `NEXORA_TAILSCALE_AUTH=true` — requests with header `Tailscale-User-Login` are auto-provisioned as `user`.

- **Serve vs Funnel:** `tailscale serve` (tailnet-only) is safe; `tailscale funnel` (internet) shares the same header trust — ensure the listener is tailnet-only when that flag is enabled.
- **Discovery (desktop):** `web/src/api/client.ts` probes (in order, 3 s each):
  `http://localhost:8080` → `http://127.0.0.1:8080` → `https://pms2.tail58d7ea.ts.net` → `http://pms2.tail58d7ea.ts.net` → `http://100.67.251.1:80` via `GET /api/v1/auth/needs-setup`. Override via `localStorage nexora-api-url` (validated `http(s)://` only).
- Detailed doc: [docs/tailscale.md](../docs/tailscale.md).

## Backup & Restore

**What to back up:**

| Data | Container path | Host / Volume |
|------|----------------|---------------|
| SQLite PG DB + cache + versions + settings | `/app/data` | `nexora-data` volume — includes `nexora.db`, `cache/thumbnails`, `cache/archives`, `versions` |
| Your files | `/mnt/files|/mnt/media|/mnt/backups|/mnt/shared` | Bind mounts `./data/*` |
| Postgres (when enabled) | `/var/lib/postgresql/data` | `postgres_data` volume from `docker-compose.postgres.yml` |

**SQLite example:**

```bash
# consistent backup — stop or snapshot the volume
docker compose down  # or: docker run --volumes-from nexora …
docker run --rm -v nexora-data:/data -v $PWD:/backup alpine \
  tar czf /backup/nexora-data-$(date +%F).tgz -C / data
# plus: tar czf files.tgz data/files data/media data/backups data/shared
```

**Postgres:** `pg_dump -h localhost -U nexora nexora > backup.sql` or `pg_basebackup`.

**Restore / Rollback:** Migrations run forward at startup and are never downgraded. Rollback = stop, restore `nexora.db` (or PG dump) + `web/dist` from the prior image/tag, then restart. Keep image + DB snapshot paired.

## Observability

- **Liveness:** `GET /healthz` → `{service:"nexora", status:"ok", version:"1.8.0"}` (always 200 when process is up).
- **Readiness:** `GET /readyz` → 200 only when DB is reachable (`probeWritable`).
- **Prometheus:** `GET /metrics` when `NEXORA_ENABLE_PROMETHEUS=true` (`nexora_http_requests_total`, `nexora_*` gauges for jobs/search indexed).
- **Logs:** JSON lines `ts/level/service/msg/caller` to stdout; `docker compose logs -f nexora`.
- **Maintenance:** 15 m sweep (sessions/limiter/share/thumb/archive/reset) + 6 h `ScanAll` (see [Architecture](Architecture)).

## Resource Planning

- SQLite `search_index` caps at 500 k entries per `ScanAll`; increase available disk for `cache/thumbnails` and `cache/archives` (archives TTL 24h).
- Job queue 128 and pool 2 — when full new jobs are marked `failed` (retry from UI). Transcode semaphore 2, thumbnail gate 4.
- `NEXORA_THUMBNAIL_MAX_SIZE 20MB` — larger sources skip thumb generation.
- For S3 roots, large uploads buffer in RAM (no multipart) and listings cap at 1000 — size the host accordingly.

## Upgrading

```bash
git pull
# bump .env NEXORA_VERSION if pinned, or leave at default 1.8.0
docker compose up -d --build
docker compose logs -f nexora
curl -f http://localhost/healthz
```

Check [CHANGELOG.md](../CHANGELOG.md) for breaking migrations or config changes.

## Web (Static) Deployment

Landing page `website/` is static (no build) — Cloudflare Pages project `nexora` (`suryaprakashinfo.in`). Three paths (see [website/DEPLOY.md](../website/DEPLOY.md)): dashboard zip upload, `wrangler pages deploy website --project-name=nexora`, or GitHub Action on `website/**` push (requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`). Verify `200` and `robots.txt`/`sitemap.xml`.

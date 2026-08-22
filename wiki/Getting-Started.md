# Getting Started

You can have Nexora running locally in under 2 minutes. Docker Compose is the recommended path.

## 1. Prerequisites

- **Docker** + **Docker Compose** (v2)
- 1 GB free disk, 512 MB RAM (more for large libraries)
- No other service on port `80` (or set `NEXORA_HTTP_PORT`)

## 2. Configure

```bash
git clone https://github.com/suryaprakash251201/nexora.git
cd nexora
cp .env.example .env
```

Edit `.env` for your environment. For a quick local run the defaults work. For anything beyond `localhost`, set:

```dotenv
NEXORA_BASE_URL=https://files.example.com   # no trailing slash — used for share links
NEXORA_SESSION_SECRET=<paste output of: openssl rand -hex 32>
NEXORA_SECURE_COOKIES=true                  # only when behind HTTPS
```

If `NEXORA_SESSION_SECRET` is left blank, Nexora generates a random one and persists it in the DB (`settings` table). A stable secret is recommended for managed deployments so sessions survive restarts.

> **Local dev without Docker?** Use a single relative root so permissions are trivial:
> ```dotenv
> NEXORA_DEFAULT_ROOTS=Files:./data/files:false
> NEXORA_LISTEN_ADDR=:8080
> ```

## 3. Start

```bash
docker compose up -d --build
docker compose ps
curl -f http://localhost/healthz
# {"service":"nexora","status":"ok","version":"1.8.0"}
```

Open `http://localhost` → complete the first-run **Setup** screen to create the admin. The roots from `NEXORA_DEFAULT_ROOTS` are created and granted to that admin automatically.

## 4. Verify & Operate

```bash
docker compose logs -f nexora     # tail logs (JSON lines: ts/level/msg)
docker compose restart nexora
docker compose down               # stop without deleting data
```

**Persistent data lives in two places:**

| What | Where | Backup? |
|------|-------|---------|
| DB + thumbs + versions | `nexora-data` volume → `/app/data` | Yes |
| Your files | `./data/files`, `./data/media`, etc. → `/mnt/*` | Yes |

Back up both. Migrations run forward at startup; rollback = restore DB + prior image.

## 5. Next Steps

- **Expose to the internet:** [Deployment — HTTPS & Tailscale](Deployment)
- **Add S3 storage or per-user roots:** [Storage Roots](Storage-Roots) + [Configuration](Configuration)
- **Secure it:** [Security](Security)
- **Build from source or customize:** [Development](Development)

## Quick Video Path

- Browse → click a folder, breadcrumb back, sort by name/modified/size/type.
- Upload → drag-drop onto the browser or **Upload** button (folder upload via `webkitdirectory`).
- Search → top bar or **Search** in sidebar (filters: kind, extension, size, date).
- Share → right-click → **Share** → scope/password/expiry/limit → copy `/s/:token`.
- Playlist → select audio → **Add to playlist** → play from sidebar.
- Photos → sidebar **Photos** → year/camera/location filters, map toggle.

Full walkthrough: [Features](Features) and [docs/features.md](../docs/features.md).

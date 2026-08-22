# Troubleshooting

## Docker

### Build fails

```bash
docker compose down
docker system prune -f
docker compose build --no-cache
docker compose up -d
```

If behind Tailscale MagicDNS (`100.100.100.100`) container DNS may fail (`no such package`) — `docker-compose.yml` sets `network: host` on the build so `RUN` steps use host resolver.

### Container restarts / `bind: permission denied`

The image runs as `100:101` with `cap_drop: ALL` and `read_only: true`. Binding `<1024` requires `CAP_NET_BIND_SERVICE`. Nexora's `Dockerfile` listens on `:8080`; Compose maps `${NEXORA_HTTP_PORT:-80}:80`. Don't map a privileged port without either listening on `:8080` inside (default) or adding `cap_add: [NET_BIND_SERVICE]`.

### Healthcheck fails

```bash
docker compose logs nexora
curl -v http://localhost/healthz
curl -v http://localhost/readyz   # DB readiness separate from liveness
docker compose restart nexora
```

### Storage permissions

Bind mounts owned by host `root` are invisible to `100:101`. `nexora-init` chowns writable mounts on every `compose up`. If perms drift:

```bash
docker compose down
sudo chown -R 100:101 data/
# or: sudo chown -R $USER:$USER data/ && chmod -R 775 data/files data/backups data/shared
docker compose up -d
```

**Symptom (pre-1.9.0):** uploads/deletes *inside subfolders* fail with a generic "Storage operation failed" while the root folder works — the subfolders were created by another user after init ran.

Since **1.9.0** the server names the real cause:

| Message | Meaning | Fix |
|---|---|---|
| `permission_denied` — "Filesystem permission denied (check storage directory ownership)" | `EACCES`/`EPERM` writing under that path | `chown -R 100:101 <mount>` or re-run `nexora-init` |
| `read_only` — "Storage is mounted read-only" | filesystem mounted `ro`, or root flagged read-only in Nexora | remount rw / toggle root setting |
| `storage_full` — "No space left on the storage device" | `ENOSPC` | free space / extend volume |

Works at the root but fails one level deep → check ownership of just those subfolders: `ls -la /data/Movies` vs `ls -la /data/Movies/2024`.

## Database

### Reset SQLite (destructive)

```bash
docker compose down
rm -rf data/nexora.db* data/cache
docker compose up -d
```

### Postgres connection

```bash
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d
docker compose logs postgres
# also:
go test -tags postgres -run TestRunPostgres ./migrations -count=1 -v
```

If migrations fail with `PRAGMA`, ensure you're on `1.9.0` — `migrations/rewrite.go` strips it and handles dialect conversion. Earlier versions were broken on Postgres.

### Uploads stuck at 100% in the transfer panel

Fixed in **v1.9.0** (background scans could pin the single SQLite connection; now chunked + pooled). If you upgraded: restart the server — the pool change applies on boot. Still stuck? Check `docker compose logs nexora` for `search:` lines while reproducing.

### Search index stale after large move

`Search.Rename` only re-indexes the top entry; descendants stay at old paths until the 6 h `ScanAll`. Admin can force **Search → Reindex** (`POST /api/v1/admin/search/reindex`) or wait. S3 roots may have orphaned listings (see [Storage Roots](Storage-Roots)).

## Config

### `.env` typos silent?

`godotenv` loads `.env`; unknown keys are ignored. Validate via startup logs — `Config.Validate()` logs and exits on bad `DATABASE_URL`, short `SESSION_SECRET`, or malformed `CORS_ORIGINS`.

### `NEXORA_MAX_UPLOAD_SIZE` not enforced?

Validated but not strictly enforced in all upload paths (multipart >32 MB spools to temp files). Front with ingress `client_max_body_size` when public.

### `NEXORA_CORS_ORIGINS` seems dead

It now works: `AllowOriginFunc` echoes exact `Origin` when the allow-list is non-empty (else allow-any for Tauri/Tailscale). Ensure origins include scheme (`https://…`, not bare host).

## UI / Web

### UI 404 but API works

`web/dist` missing — the Go server serves SPA from `NEXORA_WEB_ROOT`. Run `cd web && npm run build` then restart the server.

### `t sc --noEmit` fails

```bash
cd web && npm ci && npx tsc --noEmit
# mismatched Node version — use Node 20 (22 in CI)
```

### Command palette / search not updating

Hard refresh (`Cmd+Shift+R`), clear `localStorage` (`nexora.density`, `nexora.columns`, `nexora-api-url`, `accent-theme`) if corrupted storage breaks early module evaluation (see `store.ts` guards).

## Mobile

### `patch-package` errors

```bash
cd mobile && npm ci
npx patch-package --error-on-fail  # CI gate
```

Patches target `react-native-track-player 4.1.2` + `image-size 1.2.1`. After upgrading either, refresh patches (`npx patch-package package-name`).

### Cleartext HTTP rejected (iOS/Android)

Expected for self-hosted `http://` — `mobile/app.json` sets `usesCleartextTraffic: true` + `NSAllowsArbitraryLoads: true`. `NSAllowsLocalNetworking` is the modern narrower alternative.

## Desktop

### `cargo` / `webkit` missing

Install Linux deps (`libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libappindicator3-1`, `librsvg2-2`, `libnotify4`, `openssl`) and `rustup` (1.86+).

### Window invisible after minimize-to-tray

Tray requires a system tray (e.g. GNOME `extension-appindicator`). On Wayland without it, `Setup` logs `Tray unavailable, closing window will quit` — windows then exit on close instead of hiding.

## API

```bash
# auth check
curl -i http://localhost/api/v1/auth/session -H "Cookie: session=..."
# CSRF — fetch token
curl http://localhost/api/v1/csrf
# share probe
curl http://localhost/api/v1/share/<token>
# file listing
curl "http://localhost/api/v1/files?root=<id>&path=&limit=10" -H "Cookie: session=..."
# version check
curl http://localhost/api/v1/version
```

All state-changing calls need `X-CSRF-Token: <value of nexora_csrf cookie>` plus the session cookie.

## Getting Help

- Open an issue with: version (`cat VERSION` / `curl /healthz`), `docker compose logs nexora` snippet, and steps to reproduce.
- Security issues → see [Security](Security) (do not file public issues).

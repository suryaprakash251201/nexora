# Security

> **Reporting:** *Do not* open a public issue for vulnerabilities. Use the repository's **Security → Report a vulnerability** (GitHub Security Advisories) or the contact on the profile. Acknowledgement within **48 hours**; coordinated disclosure after a fix. See [SECURITY.md](../SECURITY.md).

## Threat Model

Nexora is designed for **single-tenant home-lab** deployment behind a trusted network or reverse proxy. It hardens the common self-hosted pitfalls (credential replay, CSRF, path traversal, zip-slip, log exposure) but is not an enterprise multi-tenant DLP system.

## Built-in Protections

| Area | Mechanism | File |
|------|-----------|------|
| **Passwords** | Argon2id (memory-hard, `x/crypto`) | `internal/auth/password.go` |
| **Sessions** | `RandToken(32)` SHA-256 at rest, HTTP-only `SameSite=Strict` cookie `nexora_session`, 168 h expiry, `DeleteAllForUser` on password reset | `internal/auth/session.go`, `handlers_auth.go` |
| **CSRF** | Double-submit `nexora_csrf` → `X-CSRF-Token` on every mutation; exempt only login/setup/share/health/csrf | `internal/middleware/csrf.go` |
| **Rate limiting** | Per-IP token bucket on auth/share (`NEXORA_RATE_LIMIT_PER_MIN=60`) + `LoginGuard` 5 failures / 15 m lockout | `internal/middleware/ratelimit.go`, `internal/auth/guard.go` |
| **Path traversal** | `CleanRelative` (reject `..`, `\`, NUL, non-UTF8) + `Resolve(EvalSymlinks + HasPrefix root+sep)` | `internal/storage/path.go` |
| **Zip-slip** | 5-step raw-name + cleaned-path checks before write — tested in `jobs_test.go` | `internal/jobs/jobs.go` |
| **Headers** | CSP `default-src 'self'` (frame relaxed to `self` for `/raw`+`/thumbnail`), `HSTS` only when `SecureCookies`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` | `internal/middleware/middleware.go` |
| **Per-root ACL** | Every `/files` handler calls `RootService.Permission`; admin is super-user | `internal/storage/roots.go` |
| **TOTP** | `pquerna/otp` with staged `totp_secret` → `totp_enabled` | `internal/auth/totp.go` |
| **Audit** | Append-only `audit_logs(action,target,ip,detail)` for auth/admin/file events | `internal/audit/audit.go` |
| **Container** | Unprivileged `100:101`, read-only rootfs, `tmpfs /tmp`, `no-new-privileges`, dropped caps, `nexora-init` chown | `Dockerfile`, `docker-compose.yml` |

## Hardening Checklist (public installs)

1. **HTTPS everywhere.** Terminate TLS at Caddy/Nginx/Traefik/Cloudflare Tunnel; set:
   ```dotenv
   NEXORA_BASE_URL=https://files.example.com
   NEXORA_SECURE_COOKIES=true
   ```
   Don't set `SECURE_COOKIES=true` on plain `http://localhost`.

2. **Lock CORS.** `NEXORA_CORS_ORIGINS` empty → allow-any (for Tauri/Tailscale convenience). For public facing, set an explicit allow-list (`https://files.example.com,https://app.files.example.com`).

3. **Stable session secret.** Generate once: `openssl rand -hex 32` → `NEXORA_SESSION_SECRET`. If blank, the server persists a random one in `settings` — fine for ephemeral installs, but rotate deliberately.

4. **Trusted proxies.** Only set `NEXORA_TRUSTED_PROXIES` to the CIDRs that actually terminate `X-Forwarded-For`/`X-Real-IP`. Untrusted proxy ranges let a client spoof its IP past the rate limiter and `RealIP` filter.

5. **Upload policy.** Set `NEXORA_ALLOWED_MIME` (CSV allow-list) and front the upload path with an ingress `client_max_body_size` / `LimitRequestBody` — `NEXORA_MAX_UPLOAD_SIZE` is validated but not strictly enforced in all handlers.

6. **Disk & quota.** Archive jobs stream ZIPs; still front disk with monitoring. Quota reports are Linux-only (`Statfs`) — don't rely on them on Windows/macOS off-Linux.

7. **Backups & rollback.** Back up `nexora-data` + every bind mount; migrations are forward-only (see [Deployment](Deployment)).

8. **Tailscale.** If `NEXORA_TAILSCALE_AUTH=true`, ensure the listener is **only** reachable via the Tailscale proxy — the header `Tailscale-User-Login` is trusted verbatim when that flag is on.

## Known Trade-offs & Deferred Hardening

From periodic reviews ([docs/architecture-review.md](../docs/architecture-review.md), [docs/code-review-2026-08.md](../docs/code-review-2026-08.md)) — tracked for the roadmap, not blockers for home-lab use but worth knowing:

- **Forgot-password** returns the reset token in-band (no email) — fine for single-user LAN, account-takeover vector if exposed publicly. Disable or front with an authenticated session when public.
- **Sessions in URLs** (`?token=` for Tauri/mobile media URLs) — leaks to logs/screenshots; prefer cookies where possible or short-lived scoped media tokens.
- **Share tokens stored raw** in DB (sessions are hashed) — a DB leak exposes live share links.
- **Webhook SSRF** — `events.Bus` POSTs to admin-supplied URLs with no scheme/IP filtering (redirects followed). Restrict webhook targets to `http(s)://` and private ranges when hardening.
- **S3 & ZIP** — S3 `Write` buffers whole files in RAM (no multipart), listings single-page (≤1000), recursive folder delete not yet implemented; ZIP extraction has no per-entry decompression caps (zip-bomb). Front large uploads or keep S3 for modest assets until multipart lands.
- **WebDAV** is implemented but not mounted — documented feature is inactive (also XML `displayname` injection if ever wired).
- **Tauri fs scope** — currently narrowed to `$APPDATA/$APPCACHE/$RESOURCE/$TEMP/$DOWNLOAD` (earlier `**` was too broad).
- **Mobile token storage** — now in `expo-secure-store` (Keychain/EncryptedSharedPreferences) with migration from legacy `AsyncStorage`.

## Roles

| Role | Capabilities |
|------|--------------|
| `admin` | Full filesystem (all roots), user/role/root management, audit, reindex, webhooks, usage |
| `user` | Roots granted via `user_roots`, own favorites/recents/tags/versions/playlists/shares |
| `viewer` | Same as `user` but write operations rejected (where enforced) |

## Security Headers (summary)

```http
Content-Security-Policy: default-src 'self'; img-src 'self' http: https: data: blob:; media-src 'self' http: https: blob:; script-src 'self'; frame-ancestors 'self'  # relaxed for /raw, /thumbnail
Strict-Transport-Security: max-age=31536000; includeSubDomains  # only when NEXORA_SECURE_COOKIES=true
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cache-Control: no-store  # for SPA (non-API) when SecureCookies is on
```

## Audit Log

Append-only `audit_logs` rows: `action` (e.g. `setup`, `login_failed`, `totp_enabled`, `create_directory`, `version_restored`), `target`, `client_ip`, `detail` JSON, queried via `GET /api/v1/admin/audit?limit=&offset=`. No retention — grows unbounded; add rotation when needed.

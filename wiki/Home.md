# Nexora Wiki

Welcome to the **Nexora** knowledge base. This wiki is the companion to the [README](../README.md) — deeper dives, how-tos, and reference material.

> **Version:** `1.9.0` (root `VERSION` file) • **Go** 1.26 • **React** 19 • **Expo** 54 • **Tauri** 2  
> Website: https://nexora.suryaprakashinfo.in • Demo: https://pms2.tail58d7ea.ts.net (community)

## What's New in v1.9.0

- 🎤 **Synced lyrics end-to-end** — Apple Music-style fullscreen panel, click-to-seek karaoke lines, and strict `<song>.lrc` sidecar files saved next to your music (editable in the built-in editor).
- ⚡ **Upload reliability** — background library scans no longer block uploads/API writes at the database (chunked index transactions + WAL connection pool).
- 🔍 **Honest storage errors** — permission, read-only and disk-full failures now say exactly what's wrong instead of a generic message.

## Start Here

| Page | What you'll find |
|------|------------------|
| [Getting Started](Getting-Started) | 5-minute Docker setup → first login |
| [Installation](Installation) | Docker Compose, `docker run`, bare metal, PostgreSQL |
| [Configuration](Configuration) | Every `NEXORA_*` var, storage-root syntax, storage types |
| [Features](Features) | Complete feature tour with screenshots |
| [Architecture](Architecture) | Go/React/Tauri/Expo layout, request flow, storage abstraction |
| [API Reference](API-Reference) | All `/api/v1` + public share + health endpoints |
| [Storage Roots](Storage-Roots) | Local vs S3 (AWS/R2/MinIO), permissions, quotas |
| [Mobile & Desktop](Mobile-and-Desktop) | Expo patches, Tauri build, distribution |
| [Deployment](Deployment) | HTTPS proxy, Tailscale, backup/restore, monitoring |
| [Security](Security) | Threat model, hardening checklist, reporting |
| [Development](Development) | Backend, web, core, make targets, testing, conventions |
| [Troubleshooting](Troubleshooting) | Docker, DB, perms, health checks, common fixes |
| [Design System](Design-System) | Tokens, glassmorphism, theming — summary of `web/src/index.css` |

## Quick Links

- **Feature guide (in-repo):** [docs/features.md](../docs/features.md)
- **Design tokens (source of truth):** [web/src/index.css](../web/src/index.css) + [docs/design-system.md](../docs/design-system.md)
- **Route list (source of truth):** [internal/api/server.go](../internal/api/server.go)
- **Migrations:** [migrations/](../migrations/) + [migrations/rewrite.go](../migrations/rewrite.go)
- **Changelog:** [CHANGELOG.md](../CHANGELOG.md) • **Security:** [SECURITY.md](../SECURITY.md)

## For Contributors

See [Contributing](Contributing) and [Development](Development). Run `make lint` (and `cd web && npm run lint`) before opening a PR — CI mirrors that exactly ([.github/workflows/ci.yml](../.github/workflows/ci.yml)).

---

<p align="center"><sub>Wiki version is tracked with the repo. If a page lags behind <code>VERSION</code>, please open an issue.</sub></p>

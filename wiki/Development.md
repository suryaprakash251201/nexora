# Development

## Prereqs

- **Go** 1.26+ (`go vet`, `go test`, `modernc.org/sqlite` pure Go — no `cgo`)
- **Node** 20+, npm
- **Docker** for containered validation
- Optional: `ffmpeg`/`ffprobe` for video thumbs & transcoding; `golangci-lint` for full lint

## Quick Dev Loop

```bash
# .env for bare-metal dev — use a host-relative root
NEXORA_DEFAULT_ROOTS=Files:./data/files:false
NEXORA_LISTEN_ADDR=:8080

# Terminal 1 — API (godotenv loads .env)
go run ./cmd/nexora          # http://localhost:8080

# Terminal 2 — web (proxies /api + /healthz to :8080)
cd web && npm install && npm run dev   # http://localhost:5173
```

Without `web/dist`, the API still runs — the UI 404s (`NEXORA_WEB_ROOT` serves the SPA with fallback; `AGENTS.md` note).

## Backend — `internal/*` + `cmd/nexora`

```bash
make test            # go test ./... -count=1
go test ./internal/api -run TestName -count=1
go test ./internal/api -run TestName -count=1 -race  # add -race periodically
make lint            # go mod tidy + go vet (+ golangci-lint if installed)
make lint-full       # also: cd web && tsc --noEmit ; cd packages/core && tsc --noEmit
make build           # bin/nexora  (ldflags -X Version from VERSION)
make docker-build    # nexora:nexora image
```

### Conventions

- **Migrations:** add a new `migrations/NNNN_name.sql` — never edit an already-applied one (tracked in `schema_migrations`). Keep SQL convertible via `migrations/rewrite.go` → `ToPostgres`. `PRAGMA` etc. will be stripped, but test it.
- **Postgres:** all stores use `*database.DB` (not `*sql.DB`) so `Rebind` (`?`→`$N`) happens transparently. Keep new SQL `?`-style. CI builds `-tags postgres` — must keep compiling.
- **AuthZ:** every file handler must call `RootService.Permission` — compare with neighboring handlers if unsure.
- **Deps injection:** `api.NewServer(Deps{…})` is the single struct — don't add post-construction field assignments.
- **WebDAV:** `internal/webdav` is dead code (not mounted) — do not extend until the decision is made.

### Testing

In-repo tests for range parsing, delete→trash regression, sharing, search. Postgres proof via `go test -tags postgres -run TestRunPostgres ./migrations` against `postgres:16-alpine` (see CI). Run with `-count=1` to avoid caching; `-race` is not in CI by default.

## Web — `web/`

```bash
cd web && npm install && npm run dev   # :5173
cd web && npm run lint                 # tsc --noEmit (this is "lint")
cd web && npm run build                # tsc -b && vite build → web/dist
```

- **Source of truth for tokens:** `web/src/index.css` (`@theme` + CSS vars). [docs/design-system.md](../docs/design-system.md) is the summary — if they diverge, `index.css` wins.
- **Conventions:** import from `@nexora/core` (`formatBytes`, `previewKind`, `cleanTrackTitle`, codecs) — don't duplicate. Path strings only via `web/src/api/endpoints.ts`. `server.go` is the endpoint doc. Tauri auto-discovery and media URL sanitization live in `web/src/api/client.ts`.
- **CI mirrors:** `web` typecheck + build in [ci.yml](../.github/workflows/ci.yml).

## Shared Core — `packages/core` (`@nexora/core`)

```bash
cd packages/core && npx tsc --noEmit
```

Exports: `format*`, `previewKind`, `cleanTrackTitle`, `transcode` codec table. Both `web` and `mobile` alias `@nexora/core` → `../packages/core/src` (see `mobile/AGENTS.md`).

## Mobile — `mobile/` (Expo 54)

> **Read `mobile/AGENTS.md` before touching this directory.** Expo APIs drift from training data — use versioned docs at `https://docs.expo.dev/versions/v54.0.0/` (fetch `.md` suffix).

```bash
cd mobile && npm install    # runs postinstall patch-package (patches/ required)
npx expo start              # QR for Expo Go (--android / --ios / --web)
```

- **Patches:** `patch-package` applies `mobile/patches/` (`react-native-track-player+4.1.2.patch` for RN 0.81/Kotlin 2.x, `image-size+1.2.1.patch` CVE). CI runs `npx patch-package --error-on-fail` — refresh patches on dependency upgrades.
- **SecureStore:** tokens in `expo-secure-store` (Keychain/EncryptedSharedPreferences) with migration from `AsyncStorage`.

## Desktop — `desktop/` (Tauri 2)

```bash
cd desktop && npm run dev    # runs npm run dev --prefix ../web, then tauri dev
cd desktop && npm run build  # runs npm run build --prefix ../web, then cargo bundle
```

- Config at `desktop/src-tauri/tauri.conf.json` (`frontendDist ../../web/dist`, `devUrl http://localhost:5173`, minisign updater `updater.json`, bundle `deb/rpm/appimage/nsis/msi`).
- Rust watcher in `src-tauri/src/lib.rs`: tray, single-instance, sleep inhibition (`systemd-inhibit`/`caffeinate`/Win API), global media keys, window-state restore.

## CI — `.github/workflows/ci.yml`

```text
backend: go vet + go test + go build (+ -tags postgres)
postgres: postgres:16-alpine service, go test -tags postgres -run TestRunPostgres
frontend: npm ci + tsc --noEmit + vite build  (web/)
patches:  npm ci + patch-package --error-on-fail (mobile/)
core:     tsc --noEmit (packages/core)
```

Other workflows: `publish-image` (multi-arch), `tauri-build` (Linux/Windows), `mobile-build` (APK/IPA), `website-deploy` (path-filtered), `codeql` weekly. `dependabot.yml` weekly Mon 09:00 Asia/Kolkata (no `mobile` entry — transitive + patches reviewed manually).

Reproduce CI locally before pushing:

```bash
make lint-full
cd web && npm run build
go build -tags postgres -o /tmp/nexora-pg ./cmd/nexora
cd mobile && npx patch-package --error-on-fail
```

## Repository Notes

- **Binaries** `nexora`/`nexora_test`, `web/dist/`, `data/`, `node_modules/` are gitignored — don't commit.
- **WebDAV** is unwired dead code — don't extend.
- **E2E** `web/playwright.config.mjs` targets `http://192.168.1.5` and `web/e2e/` is gitignored — not in CI.
- Follow `AGENTS.md` for layout/expectations when the assistant or contributor is working in-repo.

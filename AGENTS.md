# Nexora

Self-hosted file workspace. Go API + SQLite with embedded migrations, plus four frontends: React web app (`web/`), Expo mobile app (`mobile/`), Tauri desktop wrapper (`desktop/`), landing page (`website/`).

## Layout

- `cmd/nexora` — server entrypoint; dependency wiring lives in `main.go` (event bus, search, jobs, maintenance goroutines).
- `internal/` — Go API. Route list source of truth: `internal/api/server.go`. Handlers in `internal/api/handlers_*.go`.
- `migrations/` — embedded SQLite migrations, applied automatically at startup (tracked in `schema_migrations`). Add a new numbered `.sql` file; never edit an already-applied one.
- `web/` — React 19 + Vite + Tailwind 4 + React Query + Zustand. Dev server on `:5173` proxies `/api` and `/healthz` to `:8080`.
- `mobile/` — Expo 54 / RN 0.81. **Read `mobile/AGENTS.md` before touching it** (Expo API drift from training data; check versioned docs at https://docs.expo.dev/versions/v54.0.0/). `patch-package` runs on `postinstall` and applies `mobile/patches/` — required for react-native-track-player on RN 0.81; reinstall after changing deps/patches.
- `desktop/` — Tauri 2 shell around the web build.

## Commands

- Backend dev: `go run ./cmd/nexora` (`.env` loaded automatically via godotenv).
- Backend tests: `make test` (= `go test ./... -count=1`); single test: `go test ./internal/api -count=1 -run TestName`.
- `make lint` = `go mod tidy && go vet` — not a real linter.
- Frontend dev: `cd web && npm install && npm run dev`.
- Frontend typecheck: `cd web && npm run lint` (= `npx tsc --noEmit`). Frontend build: `npm run build` (= `tsc -b && vite build`).
- CI (`.github/workflows/ci.yml`) runs `go vet ./...`, `go test ./... -count=1`, and builds both plain and `-tags postgres` variants, plus web typecheck/build — mirror this before pushing.
- `web/playwright.config.mjs` targets a live instance (`http://192.168.1.5`) and `web/e2e/` is empty and gitignored — e2e is not part of CI.

## Gotchas

- PostgreSQL is a build-time option (`go build -tags postgres`, `NEXORA_DATABASE_TYPE=postgres`). Migrations are written in SQLite syntax and string-converted for Postgres (`migrations.MigratePostgresSQL`) — keep new migrations convertible; CI compiles the postgres tag so it must keep building.
- The server serves the built UI from `web/dist` (default `NEXORA_WEB_ROOT`); with no build, the API runs but the UI 404s.
- All config is `NEXORA_*` env vars in `.env` (see `.env.example`). If `NEXORA_SESSION_SECRET` is empty, a random secret is generated and persisted in SQLite.
- Docker: container runs as uid 100/gid 101 with read-only root fs and tmpfs `/tmp`; `nexora-init` one-shot chowns the bind mounts. Data lives in the `nexora-data` volume (`/app/data`: SQLite DB, thumbnail cache, archive workspace).
- Repo-root `nexora` / `nexora_test` binaries, `web/dist/`, `data/`, `node_modules/` are gitignored build artifacts — don't commit them.
- UI design tokens and conventions: `docs/design-system.md`. Endpoint docs: `internal/api/server.go`.

# Changelog
All notable changes to Nexora are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/) and the project adheres to [Semantic Versioning](https://semver.org/). The single source of truth for the current version is the repo-root `VERSION` file (`1.8.0`) — `web`, `desktop`, and the Docker image all derive from it; `mobile` has an independent app-store version (`1.0.0`).

## [1.8.0] - 2026-08-20

## [Unreleased]
### Changed
- Web UI: file grid/list selection now uses a tint + ring affordance (was opacity dimming); keyboard focus rings visible on all tiles/rows; arrow keys move focus between items (grid-aware Up/Down/Left/Right).
- Web UI: hover action on files is contextual — Play for audio/video, Preview (eye) for documents/images, Open folder for directories.
- Web UI: breadcrumb crumbs are real drop targets again — dropping a selection moves it into that folder (`onDropToFolder` → `useClipboard.movePathsTo`).
- Web UI: theme follows OS preference by default (`enableSystem`); users who toggled explicitly keep their choice. Light-mode splash, skeleton shimmer, accent buttons and quota bars no longer render dark artifacts.
- Web UI: z-index stacking now flows through documented CSS tokens (`--z-float/60`, `--z-transfers/65`, `--z-veil/70`, `--z-fullscreen/80`, `--z-modal/100`, `--z-palette/110`, `--z-toast/130`); all arbitrary `z-[n]` classes replaced, toasts explicitly topmost.
- Web UI: player cover-art/play-button/EQ-bar gradients and analytics category colors use accent palette tokens (`accent-secondary`, multi-accent palette) instead of hardcoded purple/pink Tailwind stops — the four accent themes now restyle media surfaces and charts.
- Web UI: shared `Modal` locks body scroll while open; header/footer tints use glass tokens instead of `white/[0.02]`.

### Fixed
- Web UI: defined the previously-missing `no-scrollbar` / `mask-edges` utilities (breadcrumbs and filter chips showed native scrollbars); removed invalid `role="grid"` ARIA in favor of list semantics; `aria-current` on sidebar navigation; `role="alert"` on login errors; password visibility toggle restored to tab order; checkmarks replace chevrons in sort/filter menus; hardcoded palette colors replaced with semantic tokens in TrashView, error states and chrome hovers; deduplicated logo SVGs into `NexoraLogo` (Sidebar, Login, Setup); scrubbed private hostname from login error text.


### Added
- Synced lyrics (.lrc) live lyrics panel in the fullscreen audio player (web/desktop) with edit support; backend `GET/POST/DELETE /api/v1/audio/lyrics` with auto-detection of sibling `.lrc` files.
- Dialect-aware DB wrapper (`internal/database.DB`) so the same queries run on SQLite and PostgreSQL (`?` → `$N`, `datetime('now')` → `NOW()`, `strftime` → `TO_CHAR`, `INSERT OR REPLACE` → `ON CONFLICT`).
- `migrations/rewrite.go` shared converter and unit tests for `MigratePostgresSQL` / `ToPostgres`.
- Graceful shutdown fixes: cancellable `runMaintenance` and bounded queue guards in `jobs.Manager` and `events.Bus` (no more send-on-closed-channel panics).
- Mobile: Bearer token now stored in the OS keychain via `expo-secure-store` (iOS Keychain / Android EncryptedSharedPreferences) with migration from `AsyncStorage`.
- Docker: reproducible web stage via `npm ci` guidance; tightened desktop filesystem capabilities (scoped to `$APPDATA/$RESOURCE/$DOWNLOAD/$TEMP`).

### Changed
- `internal/api.Server.DB` and all stores now take `*database.DB` instead of raw `*sql.DB`.
- Desktop `fs:allow-*` scoped from `**` to app data / download dirs; `shell:allow-execute` (VLC) documented.
- `internal/config.Validate()` now checks `NEXORA_DATABASE_TYPE`, requires `NEXORA_DATABASE_URL` for postgres, validates `NEXORA_SESSION_SECRET` length and `NEXORA_CORS_ORIGINS` format.
- `docker-compose.yml` default version bumped to `1.8.0`; `web` package version synced to `1.8.0`.

### Fixed
- PostgreSQL migrations no longer fail on `PRAGMA foreign_keys = ON` (now stripped) and handle `BOOLEAN`/`strftime` correctly.
- `database/postgres.go` pool config typo (`SetMaxIdleTime` → `SetConnMaxIdleTime`).

## [1.7.2] - prior
- Previous Docker Compose default version.

## [1.3.0] - prior
- Previous web frontend version before unification with desktop (now `1.8.0`).

[1.8.0]: https://github.com/suryaprakash251201/nexora/releases/tag/v1.8.0

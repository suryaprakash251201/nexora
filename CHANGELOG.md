# Changelog
All notable changes to Nexora are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/) and the project adheres to [Semantic Versioning](https://semver.org/). The single source of truth for the current version is the repo-root `VERSION` file (`1.9.0`) — `web`, `desktop`, and the Docker image all derive from it; `mobile` has an independent app-store version (`1.0.0`).

## [1.9.0] - 2026-08-22

### Added
- Strict synced-lyrics saving: `POST /api/v1/audio/lyrics` now writes `<song>.lrc` next to the audio file through the storage provider (local and S3 roots); `DELETE` removes the sidecar. Legacy DB shadow rows are cleaned up on save — the `.lrc` file is the single source of truth.
- Synced lyrics (.lrc) live panel in the fullscreen audio player (web/desktop) with edit support and auto-detection of sibling `.lrc` files.
- Lyrics create flow: tracks without lyrics show an Add-lyrics action in the fullscreen player.
- `.lrc` is now an editable text type end-to-end: server allowlist, `@nexora/core` preview/editable sets, "Synced lyrics" language badge, timestamp-insert helper in the text editor, and an LRC template in the New-file dialog.
- Dialect-aware DB wrapper (`internal/database.DB`) so the same queries run on SQLite and PostgreSQL (`?` → `$N`, `datetime('now')` → `NOW()`, `strftime` → `TO_CHAR`, `INSERT OR REPLACE` → `ON CONFLICT`).
- `migrations/rewrite.go` shared converter and unit tests for `MigratePostgresSQL` / `ToPostgres`.
- Graceful shutdown fixes: cancellable `runMaintenance` and bounded queue guards in `jobs.Manager` and `events.Bus` (no more send-on-closed-channel panics).
- Mobile: Bearer token now stored in the OS keychain via `expo-secure-store` (iOS Keychain / Android EncryptedSharedPreferences) with migration from `AsyncStorage`.
- Docker: reproducible web stage via `npm ci`; tightened desktop filesystem capabilities (scoped to `$APPDATA/$RESOURCE/$DOWNLOAD/$TEMP`).
- Project wiki (`wiki/`) with API reference, architecture, deployment, troubleshooting and more.

### Added
- Backend: scheduled SQLite database backups — set `NEXORA_BACKUP_DIR` to enable daily `VACUUM INTO` snapshots (`NEXORA_BACKUP_KEEP`, default 7, prunes oldest; `NEXORA_BACKUP_HOUR`, default 3am local). Postgres deployments are skipped with a hint to use pg_dump. Package `internal/backup` with unit tests (filename format, pruning, snapshot validity, dialect skip).
- Web: PWA support — installable app via `manifest.webmanifest` and a conservative service worker (network-first shell so updates land on reload; cache-first only for content-hashed `/assets/*`; `/api/*` never cached; registration skipped under Tauri/non-secure origins).
- Web: virtualized file list and grid (`@tanstack/react-virtual`, dependency already present but previously unused) — large folders no longer render thousands of DOM nodes; grid columns adapt to container width via ResizeObserver.
- Web: clipboard paste upload — Ctrl/Cmd+V pastes OS files/screenshots into the current folder (files view, writable roots).
- Web: keyboard power-pack in the file browser — Shift+Arrow range selection from a click/navigation anchor, Home/End jump (+Shift selects), on top of the existing roving arrow-key focus.
- Web: sidebar hover now prefetches lazy view chunks (admin/search/shares/playlists/analytics/photos) in addition to query data.
- Web CI: Vitest unit tests for `@nexora/core` formatters (`npm test`), Playwright e2e smoke scaffold in `web/e2e/` (env-driven `NEXORA_E2E_URL/USER/PASS`, skips gracefully when server or creds are absent), and a bundle-size gate (`npm run size`, wired into CI after build).

### Changed
- Fullscreen lyrics redesigned Apple Music-style: transparent panel floating on the blurred cover backdrop (no card), karaoke-style active-line highlighting with glow, gradient fade masks, hover-revealed edit/delete actions; player column shifts aside on desktop for side-by-side viewing.
- Web UI: file grid/list selection now uses a tint + ring affordance (was opacity dimming); keyboard focus rings visible on all tiles/rows; arrow keys move focus between items (grid-aware Up/Down/Left/Right).
- Web UI: hover action on files is contextual — Play for audio/video, Preview (eye) for documents/images, Open folder for directories.
- Web UI: breadcrumb crumbs are real drop targets again — dropping a selection moves it into that folder (`onDropToFolder` → `useClipboard.movePathsTo`), and also accept external OS file drops to upload into that folder.
- Web UI: theme follows OS preference by default (`enableSystem`); users who toggled explicitly keep their choice. Light-mode splash, skeleton shimmer, accent buttons and quota bars no longer render dark artifacts.
- Web UI: z-index stacking flows through documented CSS tokens (`--z-float/60`, `--z-transfers/65`, `--z-veil/70`, `--z-fullscreen/80`, `--z-modal/100`, `--z-palette/110`, `--z-toast/130`); all arbitrary `z-[n]` classes replaced, toasts explicitly topmost.
- Web UI: player cover-art/play-button/EQ-bar gradients and analytics category colors use accent palette tokens instead of hardcoded purple/pink Tailwind stops — all four accent themes restyle media surfaces and charts.
- Web UI: shared `Modal` locks body scroll while open; header/footer tints use glass tokens.
- Web UI: consolidated 17 hand-rolled CTA buttons onto the `Button` primitive; modal text inputs use the `glass-input` treatment consistently.
- Web UI: file list uses a full ARIA grid pattern; file grid tiles use a multiselectable listbox pattern for screen readers.
- Backend: graceful-shutdown context propagation in search scanner and jobs/events managers; preview thumbnails encode JPEG once (serve + cache from the same bytes); dead code removed.
- `internal/api.Server.DB` and all stores now take `*database.DB` instead of raw `*sql.DB`.
- Desktop `fs:allow-*` scoped from `**` to app data / download dirs; `shell:allow-execute` (VLC) documented.
- `internal/config.Validate()` checks `NEXORA_DATABASE_TYPE`, requires `NEXORA_DATABASE_URL` for postgres, validates `NEXORA_SESSION_SECRET` length and `NEXORA_CORS_ORIGINS` format.

### Fixed
- Web: file grid rendered as a single-column list — the width measurement (ResizeObserver) attached only on mount, before the loading skeleton was replaced by the real scroll container, so the computed column count collapsed to 1. The scroll element is now tracked reactively (callback ref → state), the observer re-attaches when it mounts, and column math accounts for per-density container padding.
- Web: React error #310 ("rendered more hooks than during the previous render") in FileBrowser — the virtualization hooks were declared after the loading/error/empty early returns; they now run unconditionally above every return so the hook order is stable across state transitions.
- Web: React error #310 ("rendered more hooks than during the previous render") in FileBrowser — the virtualization hooks were declared after the loading/error/empty early returns; they now run unconditionally above every return so the hook order is stable across state transitions.
- **Uploads no longer stall at 100%**: SQLite pool raised to 8 connections (WAL + 30s busy timeout) and the search indexer commits in 2000-entry chunks — background scans no longer pin the database and block uploads/API writes for minutes.
- Storage failures are now actionable: wrapped OS errors (`EACCES`/`EPERM`) surface as 403 "Filesystem permission denied (check storage directory ownership)", read-only mounts as 403 `read_only`, disk-full as 507 `storage_full` — instead of an opaque 500 "Storage operation failed".
- Lyrics/queue/fullscreen buttons in the fullscreen player no longer stop responding after opening lyrics (panel overlay overlap).
- Archive jobs clean up partial `.zip` output on failure; failed jobs can't hand out corrupt downloads.
- Background scanner sleeps wake immediately on shutdown; media metadata scan honors context cancellation.
- PostgreSQL migrations no longer fail on `PRAGMA foreign_keys = ON` (now stripped) and handle `BOOLEAN`/`strftime` correctly.
- `database/postgres.go` pool config typo (`SetMaxIdleTime` → `SetConnMaxIdleTime`).
- Web UI: removed duplicate `PhotosView/ConfirmDialog` in favor of shared `ui/ConfirmDialog`; defined missing `no-scrollbar` / `mask-edges` utilities; fixed invalid `role="grid"` ARIA, sidebar `aria-current`, login `role="alert"`; restored password visibility toggle to tab order; deduplicated logo SVGs; scrubbed private hostname from login error text.

## [1.7.2] - prior
- Previous Docker Compose default version.

## [1.3.0] - prior
- Previous web frontend version before unification with desktop (now `1.8.0`).

[1.8.0]: https://github.com/suryaprakash251201/nexora/releases/tag/v1.8.0

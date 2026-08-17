# Nexora Backend — Architecture Review

Date: 2026-08-16 · Scope: `cmd/nexora`, `internal/*` (~14.6k LoC Go)

## 1. What is good

- **Clean package boundaries.** `api`, `auth`, `storage`, `search`, `jobs`,
  `sharing`, `playlists`, `preview`, `metrics`, `middleware`, `events`,
  `audit`, `webdav` are separable and mostly dependency-light.
- **`StorageProvider` interface.** Local + S3 implementations behind one
  interface; adding SFTP/WebDAV-backed providers later does not touch the API
  layer. Path traversal is centrally blocked (`Resolve`/`CleanRelative`).
- **Defense-in-depth on authn/authz.** Argon2id passwords, TOTP, hashed
  session tokens, double-submit CSRF, in-memory rate limiting + login lockout,
  per-root read/write grants with admin super-access, CSP/security headers.
- **Careful failure handling in hot paths.** Range requests (RFC 9110),
  zip-slip-safe extraction, bounded job worker pool, write-probe on DB open,
  graceful shutdown.
- **Tests pass and cover tricky areas** (range parsing, delete→trash
  regression, search index, sharing).

## 2. Findings by severity

### 🔴 High

| # | Finding | Evidence | Recommendation |
|---|---------|----------|----------------|
| H1 | **Webhook signatures are forgeable.** `events.computeHMAC` ignores the secret and produces a byte-XOR "hash" (`md5Hash`), so the `X-Nexora-Signature` header authenticates nothing and is trivially predictable. | `internal/events/events.go` (`computeHMAC`, `md5Hash`) | Real `crypto/hmac` + SHA-256 over the payload with the shared secret. |
| H2 | **The event bus / webhook feature is dead.** `Server.Events` is never assigned in `main.go`, so webhook create/delete are no-ops and `GET /webhooks` always returns `[]`. Nothing ever calls `Bus.Emit`. | `cmd/nexora/main.go` (no `srv.Events = …`), `handlers_webhooks.go` (`if s.Events != nil`), zero `Emit` call sites | Wire the bus, persist webhooks, emit events from file/share/version operations. |
| H3 | **PostgreSQL mode cannot work.** Every parameterized query uses SQLite `?` placeholders (lib/pq needs `$N` — verified: `pq: syntax error`), migration `0001` starts with `PRAGMA foreign_keys = ON;` (Postgres rejects `PRAGMA`), and `INSERT OR REPLACE` (search index) is invalid Postgres. The `DBAdapter`/`ToPostgres` "translation" layer is dead code — nothing calls it. | `internal/database/postgres.go` (unused `Adapt`/`ToPostgres`), all stores use `*sql.DB` + `?`; empirical test against `postgres:16-alpine` | Either (a) stop advertising Postgres support (fail fast with a clear error), or (b) do it properly: a real SQL layer (e.g. `sqlc`/`goose` with `$N` placeholders), remove `PRAGMA`, replace `INSERT OR REPLACE`, and gate the dialect with one adapter used by all stores. |

### 🟠 Medium

| # | Finding | Evidence | Recommendation |
|---|---------|----------|----------------|
| M1 | **Fragile server construction.** `NewServer` takes 10 positional args, then 6 more fields (`Search`, `Shares`, `Preview`, `Jobs`, `Metrics`, `WebRoot`, `Events`) are assigned after construction in `main.go`. Any new dependency is a silent omission risk (this is exactly how the events bus went dead). | `cmd/nexora/main.go:80-88`, `internal/api/server.go` | Single `Deps` struct parameter; compiler forces all fields. |
| M2 | **Search index goes stale on subtree move/rename.** `Search.Rename` only deletes the old top-level entry; moving a directory leaves descendants indexed at old paths until the 6-hour rescan. | `internal/search/search.go` (`Rename`), `handlers_file_ops.go` (`indexRemove`+`indexUpsert`) | Re-walk the moved subtree and re-index via the provider (works for local + S3 since both have `List`). |
| M3 | **Raw SQL inside API handlers.** Tags, favorites/recents, saved searches, versions and parts of playlists do direct `s.DB.Exec/Query` in the api package rather than going through stores, so persistence rules live in two layers and are hard to test. | `handlers_tags.go`, `handlers_favorites.go`, `handlers_saved_searches.go`, `handlers_versions.go` | Move each into a store package (like `playlists`/`sharing` already are). |
| M4 | **No transaction across filesystem + DB state.** Trash uses move-then-insert with best-effort undo; version creation, tags, recents, and index updates are separate non-atomic writes. FS and DB can drift (e.g. crash between `provider.Move` and `INSERT INTO trash`). | `handlers_file_ops.go` (`handleDelete`), `handlers_versions.go` | Accept documented best-effort semantics, or introduce an operation journal / outbox. At minimum, make trash-record failure paths retryable and log clearly. |
| M5 | **WebDAV is implemented but not mounted.** `internal/webdav` compiles but has no route, no auth wiring, no tests. | `server.go` (no `/dav` route), `webdav/webdav.go` | Mount per-root handlers under authenticated routes (e.g. `GET /api/v1/dav/{rootID}/*`), or delete the package. |
| M6 | **Tailscale auth trusts a client-settable header.** `Tailscale-User-Login` is accepted without verifying the request actually came through a Tailscale proxy (`Tailscale-Proxy` header + HTTPS). If the server is reachable directly with `NEXORA_TAILSCALE_AUTH=true`, anyone can forge identity → instant admin-less account. | `handlers_auth.go` (`handleTailscaleLogin`) | Require the proxy header and `SecureCookies`/HTTPS; document that the listener must be Tailscale-only. |

### 🟡 Low / polish

| # | Finding | Recommendation |
|---|---------|----------------|
| L1 | `Bus.Subscribe` registers only under the **first** requested type, so multi-type subscriptions silently miss events. | Register under every type (fixed in this review). |
| L2 | `Emit` spawns an unbounded goroutine per event (+1 per webhook); high event volume can exhaust memory. | Bounded worker pool + queue (fixed in this review). |
| L3 | `handleForgotPassword` returns the raw reset token to the caller (no email). Fine for single-user LAN, but it is an account-takeover vector if exposed publicly; also `time.Sleep(200ms)` blocks a worker. | Document as intentional; consider email/out-of-band delivery or rate-limit harder; prefer `select`+timer. |
| L4 | `main.go` calls `os.Exit` inside the listener goroutine — skips `defer db.Close()`/`jobMgr.Stop()`. | Return the error to `main` instead. |
| L5 | Error/DTO plumbing is duplicated: `writeJSONError` in auth middleware hand-rolls JSON; `handleFindDuplicates` uses code `"unauthorized"` vs `"unauthenticated"` elsewhere. | Single error envelope helper; consistent codes. |
| L6 | `ScanAll` walks `root.Path` with `filepath.WalkDir` — silently indexes nothing for S3 roots (and ignores the `Path` prefix). | Route scanning through `StorageProvider.List` so S3 roots can be indexed. |
| L7 | Config is a flat 30-field struct with 2-field `Validate`; typos in env names silently fall back to defaults. | Group config (server/db/security/storage), validate cross-field invariants, test `Load`. |
| L8 | `newS3ProviderFromConfig` ignores `readOnly` (`_ = readOnly`). | Wire `readOnly` into S3 provider. |

## 3. What was changed in this pass

Implemented (see git diff):

1. **H1/H2/L1/L2 — events & webhooks made real and safe**:
   - Real HMAC-SHA256 signatures (`X-Nexora-Signature`).
   - `Subscribe` honors every requested type; `Emit` uses a bounded worker pool
     (2 workers, 256-queue) with per-webhook retry/backoff — no unbounded
     goroutines.
   - Webhooks persisted in a new `webhooks` table (migration `0013`), loaded at
     startup, CRUD through the bus; `GET /webhooks` now returns stored targets.
   - Events are emitted from upload, create/move/copy/rename/delete, trash
     restore, share create/revoke, and version create/restore handlers.
2. **M1 — dependency-injected server construction**: `api.NewServer(Deps{…})`
   with a single struct; `main.go` and the regression test updated; the
   post-construction field-assignment pattern is gone.

## 4. Suggested follow-ups (not done here)

- **Postgres (H3):** decide remove-vs-implement. If keeping it, the DBAdapter
  approach needs to become the *only* query path (all stores), `$N`
  placeholders everywhere, `PRAGMA`/`INSERT OR REPLACE` removed from
  migrations and runtime SQL.
- **M2 subtree reindex**, **M3 store extraction**, **M5 WebDAV mount**,
  **M6 Tailscale hardening**, **L6 S3 scan** — each is self-contained and can
  be a separate PR.

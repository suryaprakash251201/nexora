# Nexora Backend — Bug Analysis & Fix Plan

**Date:** 2026-08-26
**Scope:** `cmd/nexora`, `internal/**`, `migrations/**` (101 Go files, ~18.3k LOC)
**Build target:** Go 1.26 (system has 1.25; `go vet` clean, `staticcheck` not runnable due to toolchain mismatch)
**Test status:** All existing tests pass (15 packages, ~0.5s)

## Methodology

- Full read of `cmd/nexora/main.go`, `internal/api/server.go` (route table), `database/`, `auth/`, `jobs/`, `events/`, `search/`, `storage/path.go`, `sharing/`
- Spot-read of high-risk handlers: `handlers_uploads_resumable.go`, `handlers_transcode.go`, `handlers_file_ops.go`, `handlers_trash.go`, `handlers_share_public.go`, `handlers_auth.go`, `handlers_static.go`
- Static patterns: ignored errors, missing transactions, TOCTOU windows, closed-channel sends, slice-aliasing in place, missing input validation, race conditions
- All findings cross-checked against existing tests; tests pass despite many of these (tests are sparse, mostly unit-level)

## Severity legend

- 🔴 **P0 — Security or data integrity** (exploitable, may corrupt/lose user data)
- 🟠 **P1 — Correctness** (user-visible bug, wrong results, race condition)
- 🟡 **P2 — Robustness** (resource leak, edge-case crash, log noise)
- ⚪ **P3 — Polish** (UX or minor cleanup)

---

## 🔴 P0-1: Folder-into-self move / copy creates infinite loop or silently fails

**File:** `internal/api/handlers_file_ops.go` (`handleMove`, `handleCopy`)

`acc.provider.Move(src, dst)` is called with user-supplied `src` and `dst` and **no containment check**. A user with write access to root `R` can issue `move src="R/photos" dst="R/photos/2024"`. Behavior depends on the provider: `local.go` `os.Rename` fails on non-empty dirs and on cross-device moves; recursive moves can silently move the parent into its own child. Worst case: the same path becomes `R/photos/2024/.../photos/...` — endless tree, path resolution breaks for the index, and the file is unreachable.

`handleCopy` has the same issue.

**Fix:** In `handleMove`/`handleCopy`, after `CleanRelative(dst)`, check that `dst` is not `src` and is not a strict descendant of `src`. Pseudocode:

```go
if dst == src || strings.HasPrefix(dst, src+"/") {
    writeError(w, http.StatusBadRequest, "invalid_destination", "cannot move/copy a folder into itself", rid)
    return
}
```

The same check belongs in `handleRename` when the rename target is in the same parent (e.g. `a` → `a` does nothing; if `a` is a dir, same constraint).

---

## 🔴 P0-2: Reset-token one-time use is best-effort; expired tokens still get deleted

**File:** `internal/auth/store.go` (`ConsumeResetToken`)

```go
err := s.db.QueryRow(`SELECT id, user_id, expires_at FROM reset_tokens WHERE token_hash=?`, tokenHash).Scan(...)
if err != nil { return "", err }
// Delete regardless (one-time use).
_, _ = s.db.Exec(`DELETE FROM reset_tokens WHERE id=?`, id)
if expiresAt < util.NowUTC() { return "", fmt.Errorf("reset token expired") }
```

Two issues:
1. **Expired tokens are still deleted** — the comment says "one-time use" but the DELETE happens before the expiry check. A second attempt with the same token returns `ErrNotFound` (DB lookup), masking the "expired" reason. Not a security issue, but a UX bug and an audit-trail bug.
2. **No transaction** between SELECT and DELETE — two concurrent reset requests for the same token can both pass the SELECT, both consume, both succeed in rotating the password. The DELETE alone doesn't prevent a parallel "use".

**Fix:** Wrap the lookup+delete+expiry check in a single transaction with `SELECT ... FOR UPDATE` semantics, or use a single `DELETE FROM reset_tokens WHERE id=? AND token_hash=? AND expires_at >= ?` and check rows affected. Always return `ErrExpired` distinctly from `ErrNotFound` so the audit log tells the truth.

---

## 🔴 P0-3: Static-file handler can escape the web root on hostile paths

**File:** `internal/api/handlers_static.go` (`handleStatic`)

```go
clean := filepath.Clean(r.URL.Path)
candidate := filepath.Join(root, filepath.FromSlash(clean))
if !strings.HasPrefix(candidate, filepath.Clean(root)) { ... serve placeholder ... }
```

`filepath.Clean("/../etc/passwd")` → `/etc/passwd` (it does not collapse `..` at the OS level because `r.URL.Path` is treated as a relative path by `filepath.Clean`, which on Linux normalizes `/../etc/passwd` to `/etc/passwd` only if it sees it as absolute). However, `clean := filepath.Clean(r.URL.Path)` — if the URL is `/../../etc/passwd`, then `filepath.Clean` returns `/etc/passwd`, and `Join(root, "/etc/passwd")` becomes `<root>/etc/passwd`, which is inside root — fine. **But** if URL is `//etc/passwd`, `filepath.Clean` keeps it as `//etc/passwd`, and `Join(root, "//etc/passwd")` produces something else. And on Windows, separators are `\\`, but the slice check `contains "/assets/"` only matches `/`.

The bigger concern: the check is `strings.HasPrefix(candidate, filepath.Clean(root))` without the trailing separator, so `<root>` as the root and a candidate like `<root>-other/file.html` would falsely pass (sibling-directory attack) on the raw prefix check. The `Clean`+`HasPrefix` here is wrong because the check value is missing the separator.

**Fix:** Use `filepath.Rel(root, candidate)` and ensure the result does not start with `..`. Or check `candidate == root || strings.HasPrefix(candidate, root+string(filepath.Separator))`. Reject and serve placeholder otherwise.

---

## 🟠 P1-1: Session lifetime is fixed, not sliding (comment lies, behavior surprise)

**File:** `internal/auth/session.go` (`Lookup`)

Comment says "refreshing the expiry if still valid" but the code never extends `expires_at`. Every session expires exactly `NEXORA_SESSION_LIFETIME` after creation, regardless of activity. Active users get logged out unexpectedly at the lifetime boundary even if they were using the app continuously. The setting name implies `168h` of session, but with no activity sliding window it's effectively `168h` from login only.

**Fix:** Either:
- (a) Make the comment match the code: rename doc to "fixed-lifetime session, no sliding window".
- (b) Make the code match the comment: add `UPDATE sessions SET expires_at = ? WHERE id = ?` when remaining lifetime is below a threshold (e.g. <50%). Wrap in a transaction with the SELECT to avoid races.

(b) is what users expect for a "session lifetime" setting; (a) is what the code does today.

---

## 🟠 P1-2: Resumable upload chunk race — same index from two connections

**File:** `internal/api/handlers_uploads_resumable.go` (`handleUploadChunk`)

The "idempotent" claim is conditional on serial writes. Two concurrent PUTs with the same `?index=N` will:

1. Both `OpenFile(tmp, O_CREATE|O_WRONLY|O_TRUNC, ...)` — both succeed (different OS file handles).
2. Both `io.Copy` their bytes.
3. Both `Close()` their file handles.
4. Both `os.Rename(tmp, final)` — second one wins (atomic POSIX rename).

The last writer wins, but the result might be a chunk with bytes from the *slower* client mixed in, or an off-by-one if the chunk sizes differ. The "uploaded bytes" in `scanParts` reports the on-disk size, which is one client's bytes but the client might think the other succeeded.

**Fix:** Add a per-session, per-index mutex (a `sync.Map[sessionID] -> *indexedLock` or simpler: one mutex per session that serializes all writes for that session). Or: write to a content-addressed temp name (hash of the content) and rename into place. Or: lock the per-session dir with `flock`.

---

## 🟠 P1-3: Transcode session cleanup not deferred; panics leak ffmpeg

**File:** `internal/api/handlers_transcode.go`

`tcm.startSession(sessionID, ...)` is called before the long-running `cmd.Run()`. If anything panics between (e.g. a nil-deref in `flushWriter.Write` if the response writer does not implement `http.Flusher` and we passed a non-flusher interface), `tcm.stopSession` is never called and the ffmpeg process keeps running in the background. The 30-minute stale cleanup eventually reaps it, but the resource is held indefinitely in the meantime.

**Fix:** Use `defer tcm.stopSession(sessionID)` immediately after `startSession`, or wrap the body in a function and defer from inside.

---

## 🟠 P1-4: Transcode has no per-request timeout; one client can pin a semaphore slot forever

**File:** `internal/api/handlers_transcode.go` (`handleTranscode`)

The transcode semaphore is bounded to 2 concurrent slots. Each `cmd.Run()` blocks until ffmpeg exits. There is no `context.WithTimeout` for the transcode context, so a client that opens the connection and never reads (or reads very slowly) keeps the slot occupied. A 10GB file transcoded to MP4 with no reader = a slot held for hours.

**Fix:** Add `ctx, cancel := context.WithTimeout(r.Context(), 4*time.Hour)` (or configurable via env) and pass `ctx` to `exec.CommandContext`. Also: in the `flushWriter.Write`, if `Write` errors (client gone), call `cancel()` immediately instead of waiting for the timeout.

---

## 🟠 P1-5: Stream-shared download counts failed downloads against the cap

**File:** `internal/api/handlers_share_public.go` (`streamShared`)

```go
if download {
    _ = s.Shares.IncrementDownload(sh.ID)        // ← bumped first
    s.emitShareEvent(events.EventShareDownload, r, sh, rel)
    ...
    rc, rerr := provider.Read(rel)
    if rerr != nil { writeError(404) ; return }   // ← already counted
}
```

If the file disappeared between share creation and the read (deleted, root disabled, transient I/O error), the counter is bumped but the user gets a 404. The share is now one download "used" for nothing. Repeat 5 times on a `MaxDownloads: 5` share and the share is exhausted.

**Fix:** Move `IncrementDownload` to after the first successful `io.Copy` chunk. Or wrap the read+copy and only bump on success — but counting partial success is also problematic. Best: bump after the first 4KB successfully written (signals the response actually started).

---

## 🟠 P1-6: Trash restore has TOCTOU; undo is best-effort and may fail silently

**File:** `internal/api/handlers_trash.go` (`handleRestoreTrash`)

1. `provider.Stat(t.OriginalPath)` — checks if a file already exists at the original location.
2. Time passes; another client writes to that path.
3. `provider.Move(t.TrashPath, t.OriginalPath)` — provider may overwrite, may fail, may rename-and-replace depending on implementation. On S3 it's a copy+delete which would clobber the new file.

The "undo" path is `_ = acc.provider.Move(t.OriginalPath, t.TrashPath)` — errors are swallowed. A user can end up with the trash entry deleted (via the failed DB DELETE), the file in the original location, but the wrong content (clobbered).

**Fix:** Use a temp name during restore (`provider.Move(trash, _tmp_)` then `provider.Move(_tmp_, original)` in a single rename). Or hold a per-share/per-trash-entry lock (out of scope). At minimum, log the failed undo and return an explicit "data may be inconsistent, contact admin" 500 — currently the error is silently dropped.

---

## 🟠 P1-7: Search index is stale for renamed directories' subtrees

**File:** `internal/api/handlers_file_ops.go` (`handleRename`, `handleMove`) and `internal/search/search.go` (`Rename`)

```go
// search.Rename:
s.Remove(rootID, src)
// comment: "The caller re-scans lazily; we index the new top entry opportunistically
// via Upsert on the next stat. A background scan reconciles the rest."
```

The handler then calls `s.indexUpsert(req.Root, acc.provider, dest)` for the renamed top entry. **But the descendants of `src` are removed from the index and not re-added.** Search results will be empty for everything under the renamed directory until the next `ScanAll` (every 6 hours). Files inside the renamed folder become unsearchable for up to 6 hours.

**Fix:** After moving/renaming a directory, walk its subtree and `Upsert` every entry. Or fire an async re-scan for the affected root scoped to the new path. Cheapest fix: have `search.Rename` actually rename (UPDATE path) instead of delete-then-pray.

---

## 🟠 P1-8: `events.Bus.Emit` can panic if listener channel is closed during send

**File:** `internal/events/events.go` (`Emit`)

```go
for _, ch := range listeners {
    select {
    case ch <- evt:
    default:
        // drop
    }
}
```

The channel is owned by the subscriber (returned from `Subscribe` as a `<-chan Event`; the bus never closes it). If a caller mistakenly closes their channel, or if `Stop()` is called and the bus decides to close listener channels (it doesn't today, but it could in a refactor), the `ch <- evt` would panic. There's no `defer recover` and no check.

Today: no panic in practice because channels are never closed inside the bus. **Latent bug, will bite a future refactor.**

**Fix:** Use a recover wrapper around the send, or document the contract explicitly and add a `//nolint` comment. Best: use a small `sendOrDrop(ch, evt)` helper that recovers.

---

## 🟠 P1-9: Share folder ZIP stream has no size/depth limit

**File:** `internal/api/handlers_share_public.go` (`streamFolderZip`)

The walk collects every file path into a `[]string`, then `provider.Read` each one. A 100k-file shared folder is fine in memory but a 10M-file share blows up. A symlink loop (if the provider doesn't already guard) blows up the stack. The download counter is bumped once for the whole folder regardless of whether the ZIP completes.

**Fix:** Cap the file count (`maxShareEntries` already exists for info; reuse for ZIP). Cap total uncompressed size and reject. Reject if recursion depth exceeds N. Bump the counter only on first successful byte sent.

---

## 🟡 P2-1: `CleanupOldArchives` deletes DB row before file — orphans on failure

**File:** `internal/jobs/jobs.go`

```go
for _, id := range ids {
    if _, err := m.db.Exec(`DELETE FROM jobs WHERE id=?`, id); err != nil { ... continue }
    _ = os.Remove(m.ArchivePath(id))  // ← ignored error, file may be left
}
```

If the file remove fails, we have an orphan `.zip` on disk with no DB row pointing to it. The reverse ordering is safer: remove file first (and only on success), then remove row. Even better: do both in a transaction (the `os.Remove` is outside SQL, but at least a marker file in `archives/.purge` would be visible to a janitor).

Also: this loop is `TypeArchive` only. `TypeExtract` jobs leave extracted files behind forever (the job row is removed, but the destination directory + files are not).

**Fix:** Swap the order; log the file remove error; add a `CleanupOldExtracts` that records the destination and revists it. Or merge both into one cleanup pass that walks the cache dir and matches by mtime.

---

## 🟡 P2-2: `attachTags` ignores DB errors silently

**File:** `internal/api/handlers_files.go` (`attachTags`)

The function ignores the error from `db.Query` and from `rows.Scan` — if the query fails (e.g. table missing after a botched migration), the response goes out with `tags: []` for every file. No log, no error to the user. The web client renders files with no tags and the user wonders where their tags went.

**Fix:** Log the error via `s.Log.Warn`; still return `[]` but at least surface the failure.

---

## 🟡 P2-3: `handlers_audio.go` `strconv.Atoi` results ignored

**File:** `internal/api/handlers_audio.go` lines 281, 286, 291

```go
v, _ := strconv.Atoi(s)
v, _ := strconv.ParseInt(s, 10, 64)
v, _ := strconv.ParseFloat(s, 64)
```

If the user supplies a non-numeric value (e.g. `?duration=abc`), `v` is 0 and the code proceeds with a default-or-broken value. Not exploitable (defaults are safe), but a malformed query string silently uses 0 instead of returning 400.

**Fix:** `if err != nil { writeError(400, ...) ; return }`.

---

## 🟡 P2-4: `handlers_preview.go` same — `size, _ := strconv.Atoi(...)`

**File:** `internal/api/handlers_preview.go:25`

Same pattern as P2-3.

---

## 🟡 P2-5: `handlers_saved_searches.go` same — limit/offset parsed with `_`

**File:** `internal/api/handlers_saved_searches.go:284-285`

Same pattern. Negative or non-numeric values silently become 0.

---

## 🟡 P2-6: `handlers_share_public.go` info handler probe uses `Access` for a side-effect-free read

**File:** `internal/api/handlers_share_public.go` `handleSharePublicInfo`

```go
if sh.ExpiresAt != nil {
    if _, aerr := s.Shares.Access(token, ""); aerr == sharing.ErrExpired {
        status = "expired"
    }
}
```

For a password-protected share, `Access` returns `ErrPassword` (not `ErrExpired`), so this branch is moot — but it still does the (cheap) Argon2id verify with an empty password. On every page load. For a busy share with a high `MaxDownloads` cap, the empty-password verify is still CPU work per request. Add a `s.Shares.GetByToken` + explicit expiry check (no Argon2id).

---

## 🟡 P2-7: `jobs.Subscribe` cancel closes channel that may be mid-publish

**File:** `internal/jobs/jobs.go` (`Subscribe`, `publish`)

`Subscribe` returns a buffered channel and a cancel func that closes it. `publish` does `select { case ch <- j: default: }` — non-blocking. If `cancel` runs concurrently with `publish`, the channel can be closed between the read of the channel and the send — but actually `select { case ch <- ... : default: }` will panic on send to closed channel.

Today: in practice, the SSE handler holds the cancel until the client disconnects, and `publish` only fires on state changes, so the window is tiny but real. Same root cause as P1-8 — fix at the bus layer.

**Fix:** Recover in the send, or use a sentinel/quit channel pattern.

---

## 🟡 P2-8: `database/probeWritable` runs on raw `*sql.DB` with `$N` placeholders

**File:** `internal/database/database.go:70` (`probeWritable`)

This was investigated and is **not a bug** today (modernc.org/sqlite via libsqlite ≥ 3.32 supports `$N` natively, verified with a probe script). But it bypasses the `database.DB` wrapper convention; a future change to the wrapper that assumes `*DB` is used everywhere would miss this. The wrapper is the abstraction boundary; probe should go through it.

**Fix:** Wrap the raw `*sql.DB` in `Wrap(db, "sqlite")` first, or use `?` placeholders (which work on both backends via the wrapper). The current code uses `$N` which is "fine but inconsistent" — change to `?` to keep the abstraction clean.

---

## 🟡 P2-9: `handlers_file_ops.go` trash move is not transactional

**File:** `internal/api/handlers_file_ops.go` (`handleDelete` non-permanent path)

```go
if err := acc.provider.Move(rel, trashRel); err != nil { ... }
// DB INSERT
_, err = s.DB.Exec(`INSERT INTO trash ...`, ...)
if err != nil { _ = acc.provider.Move(trashRel, rel); return 500 }
```

The "undo" move can fail (e.g. trash dir doesn't exist anymore) — `_ = ` swallows the error. The file is in trash, no DB row. The user sees "internal error" but the file is already gone from where they thought it was.

**Fix:** Log the undo failure and emit a metric / audit event so operators can find the orphan. Consider creating the trash dir upfront (provider should, but verify).

---

## 🟡 P2-10: `handlers_static.go` `Cache-Control: immutable` for `/assets/` is path-based, not content-hash-based

The current logic does `strings.Contains(candidate, "/assets/")`. Vite outputs hashed assets at `/assets/<name>-<hash>.js` but **also** outputs `/assets/index-<hash>.js`. That's correct in practice for Vite's default output. **Not a bug** — just brittle if the build output structure changes. The right check is by file extension (`.js`, `.css`, `.woff2` with hash in name) or by reading the manifest.

---

## ⚪ P3-1: `internal/webdav` is dead code

Documented in `AGENTS.md`. No action — just don't extend it. Consider adding a `// Deprecated` comment on `internal/webdav/webdav.go` to signal to contributors.

---

## ⚪ P3-2: `cookies.txt` and `pi-session-*.html` committed to repo root

`cookies.txt` (207B) and `pi-session-2026-07-26T05-43-31-876Z_019f9cf3-3324-7da8-8a76-d2430702d80d.html` (3.4MB) are in the repo root. Both should be gitignored. The HTML is a session log; the cookies.txt may contain session cookies. Neither is in `.gitignore`.

**Fix:** Add `cookies.txt`, `pi-session-*.html`, `*.zip` (for `website-dist.zip` which is also there) to `.gitignore`.

---

## ⚪ P3-3: Version drift: README says 1.8.0, VERSION and package.json say 1.9.0

`README.md:11` still says `version-1.8.0`. The badge should be `1.9.0`.

---

## ⚪ P3-4: `data/` is owned by root, not suryaprakash

Likely from a Docker bind mount. The `nexora-init` one-shot in the Dockerfile fixes this on first run of the actual container; the current `data/` is local dev leakage. Not a bug, but if you develop locally against this dir, the next container run will see files owned by `100:101` and your local edits will need sudo.

---

# Fix Plan (proposed order)

## Phase 1 — Security & data integrity (P0, ~1 week)

1. **P0-1** Add folder-into-self check to `handleMove`/`handleCopy`/`handleRename`. Add unit tests for `Resolve` + handler.
2. **P0-2** Wrap `ConsumeResetToken` in a transaction; return `ErrExpired` vs `ErrNotFound` distinctly; add tests for race + expiry ordering.
3. **P0-3** Fix `handleStatic` path-escape with `filepath.Rel` + `Sep` check + explicit `/api/` prefix protection; add a fuzz test.

## Phase 2 — Correctness (P1, ~1.5 weeks)

4. **P1-1** Decide sliding vs fixed session lifetime; document and implement the choice consistently.
5. **P1-2** Add per-session write lock to `handleUploadChunk` (sync.Map of mutexes keyed by upload ID).
6. **P1-3** `defer tcm.stopSession` in `handleTranscode`; add a small panic-recovery middleware if needed.
7. **P1-4** Add transcode timeout (configurable, default 4h); also bail on `Write` error.
8. **P1-5** Move `IncrementDownload` after first successful write in `streamShared`.
9. **P1-6** Add `Log.Error` on the trash-restore undo path; add a transactional restore helper that uses a temp name.
10. **P1-7** Fix `search.Rename` to actually move subtree entries; or trigger an async re-scan of the destination.
11. **P1-8** Add `sendOrDrop` helper in events bus with recover; document channel ownership.
12. **P1-9** Cap share folder ZIP walk; cap file count and total bytes.

## Phase 3 — Robustness (P2, ~3 days)

13. **P2-1** Swap `CleanupOldArchives` order; add extract-job cleanup; add a janitor scan.
14. **P2-2, P2-3, P2-4, P2-5** Fix all the `strconv.X(..., _)` patterns to error-propagate.
15. **P2-6** Bypass `Access` in `handleSharePublicInfo`; use `GetByToken` + explicit expiry check.
16. **P2-7** Same as P1-8 (jobs subscribe cancel).
17. **P2-8** Change `probeWritable` to use `?` placeholders.
18. **P2-9** Log the trash undo failure path; emit a metric for orphan-trash detection.

## Phase 4 — Polish (P3, opportunistic)

19. Add `cookies.txt`, `pi-session-*.html`, `*.zip` to `.gitignore`.
20. Update README badge from 1.8.0 to 1.9.0.
21. Mark `internal/webdav` as deprecated.

---

# Testing gaps to fill as part of the fix work

The current test coverage is sparse relative to the handler count:

- 8 test files in `internal/api/` for 38 handler files (21%)
- Missing integration tests for: `handleUploadChunk` race, `handleMove` self-folder, share counter race, transcode session cleanup, CSRF behavior
- No e2e / table-driven test for the path-cleaning in `storage.CleanRelative` and `Resolve` (the unit tests in `path_test.go` are good, but the handler layer doesn't reuse them as smoke tests)
- Recommended additions:
  - `handlers_move_test.go` — folder-into-self, sibling-root, cross-root
  - `handlers_upload_race_test.go` — two parallel chunks at same index
  - `handlers_trash_test.go` — concurrent restore, undo failure
  - `handlers_share_counter_test.go` — failed download shouldn't count
  - `handlers_static_test.go` — path traversal cases
  - `handlers_reset_token_test.go` — expiry + race

---

# Summary

| Severity | Count | Examples |
|---|---|---|
| 🔴 P0 Security/Integrity | 3 | Folder-into-self move, reset-token race, static-file path escape |
| 🟠 P1 Correctness | 9 | Session sliding window, upload chunk race, transcode leaks, share counter race |
| 🟡 P2 Robustness | 10 | Ignored errors, transactional gaps, closed-channel races |
| ⚪ P3 Polish | 4 | Dead code, gitignore, version drift |

The backend is generally well-structured (DI server, dialect wrapper, race-free design *within* transactions), but several **TOCTOU windows** and **best-effort compensating actions** are the recurring pattern. The most impactful fixes are P0-1 (data loss potential), P0-2 (auth race), and P1-2 (upload data corruption under retry).

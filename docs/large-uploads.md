# Large File Uploads — Architecture & Operations Notes

## Root cause of the historical "Network error at 1.5 GB" failure

The original single-request path used Go's `r.ParseMultipartForm(32MB)`, which
spills any part larger than 32 MB into a **temp file in `/tmp`** before the
handler copies it to the destination. In the reference Docker deployment
(`/tmp` is an unbounded-default tmpfs on a read-only root filesystem), that
tmpfs is ~1.5 GB. Uploads died at exactly that offset with `ENOSPC` mid-parse,
which surfaced client-side as `Network error at 1.5 GB — connection closed by
server`.

## What changed

1. **Single-shot path now streams** (`handlers_upload.go`): parts are piped
   straight from the request body into the storage provider via
   `r.MultipartReader()` + provider `Write`. No temp file, no double write,
   flat memory regardless of size.
2. **Resumable chunked uploads** for files ≥ 64 MB (client threshold):
   - `POST /files/uploads/init` `{root,path,name,size,mime,chunk_size}`
     → `{uploadId, chunkSize, totalChunks}` (chunk clamped 4–64 MiB)
   - `PUT /files/uploads/{id}/chunk?index=N` — raw body; idempotent
     (`.part.tmp` → rename); per-chunk size guards
   - `GET /files/uploads/{id}/status` → `{uploadedBytes, nextChunk, complete}`
     derived from disk, so sessions survive server restarts
   - `POST /files/uploads/{id}/complete` — verifies all chunks + total size,
     streams `io.MultiReader` of parts into the provider under a
     `<dest>.nxpart` staging name, then `Move()` onto the final name
   - `DELETE /files/uploads/{id}` cancels and cleans up
   - Abandoned sessions are purged after `NEXORA_UPLOAD_TTL` (default 24h) by
     the maintenance loop; active sessions are never touched (mtime check).
3. **Frontend transfer manager**: ≥64 MB uploads use bounded-parallel chunks
   (3 at a time, 16 MiB), per-chunk retry with exponential backoff (1/2/4/8 s)
   only for transient failures (network reset, 429, 5xx), pause/resume/cancel,
   real byte-based progress (acked + in-flight), "Finalizing on server…"
   state during assembly, and precise failure messages mapped from error
   codes (`disk_full`, `permission_denied`, `upload_expired`, …).
4. **Structured server logs** per phase: `upload init/chunk-fail/complete/
   failed` with upload_id, user_id, filename, sizes, chunk counts, duration,
   remote_ip, and classified error code.

## Reverse proxy guidance

Because large files are sent as ≤64 MiB chunks, proxy body limits only need to
accommodate the chunk size plus small API calls:

- **Nginx**: `client_max_body_size 72m; proxy_request_buffering off;`
  (stream straight through), generous `proxy_read_timeout`.
- **Caddy/Traefik**: defaults fine; disable request buffering middleware if
  present.
- **Cloudflare**: free plans cap requests at ~100 MB — chunked mode fits under
  that where single-request uploads never could. Paid plans have higher caps;
  Tailscale/LAN access bypasses CF entirely and is recommended for
  multi-GB transfers.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `NEXORA_UPLOAD_TTL` | `24h` | Age at which abandoned upload sessions are purged |
| `NEXORA_TRASH_TTL` | off | Trash auto-purge (see CHANGELOG) |

Chunk size is negotiated by the client (16 MiB default) and clamped
server-side to 4–64 MiB.

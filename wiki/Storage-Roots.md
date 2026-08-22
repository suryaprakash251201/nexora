# Storage Roots

Nexora is not bound to a single directory. Every file operation is scoped to a **root** — a named mount with its own provider, permissions, and indexing policy. The API enforces `RootService.Permission(user, rootID)` on every `/files` call; path traversal outside an authorized root is rejected before the provider is touched.

## Types

| Type | `storage_roots.type` | `config` | Use |
|------|----------------------|----------|-----|
| **Local** | `local` | `""` | Filesystem path (`/mnt/files`) on the server. Default. |
| **S3** | `s3` | JSON `S3Config` | AWS S3, Cloudflare R2, MinIO, any S3-compatible. |

Both implement `StorageProvider`:

```go
type StorageProvider interface {
  List(path, offset, limit) …
  Stat(path) …
  Read/Write/Mkdir/Move/Copy/Delete …
  OpenRange(path, offset, length) …
  Search(query) …
  GetQuota() …
}
```

`RootService` caches providers by `root.ID` (lock-guarded, invalidated on update) and gates writes via `readOnly`.

## Local Roots

`LocalFilesystemProvider{rootPath, readOnly}` — `WalkDir`-based listing, MIME by extension (~70 mappings), `Statfs` quota, range reads via `os.Open` + `Seek`.

Security: `CleanRelative` rejects `..`, `\`, NUL, non-UTF8. `Resolve(rel)` does `EvalSymlinks` and checks `HasPrefix(cleaned, root+sep)` — escapes become `ErrTraversal`.

Hidden directories: `.nexora-trash` is hidden from listings and is the physical trash subtree (`Move(path, .nexora-trash/<ts>_<name>)`). It is not protected beyond hiding — direct addressing of `/.nexora-trash/...` is prevented by allow-list but the subtree can be listed via raw provider calls.

## S3 Roots

Configuration lives as JSON in `storage_roots.config`:

```json
{
  "endpoint": "https://s3.amazonaws.com",
  "region": "us-east-1",
  "bucket": "my-nexora-files",
  "access_key_id": "AKIA...",
  "secret_access_key": "...",
  "use_path_style": false,
  "prefix": "nexora/",
  "force_list_v1": false
}
```

- `endpoint` — `https://<account>.r2.cloudflarestorage.com` for R2, `http://localhost:9000` for MinIO.
- `use_path_style` — `true` for MinIO.
- `prefix` — optional key prefix inside the bucket.
- `region` — auto-extracted from `s3.<region>.amazonaws.com` when empty.
- `force_list_v1` — for providers without V2.

Signed via SigV4 (sorted query + canonical headers). `List` falls back `V2 → V1 → NoDelimiter` (manual grouping). `PresignedURL` exists but currently returns unsigned URLs (unused in handlers — raw streaming goes through the server).

**Capabilities & Limits:**

| Operation | Status | Caveat |
|-----------|--------|--------|
| List/Search | ✅ | Single page ≤1000; folders with >1000 objects are truncated |
| Upload/Download | ✅ | `Write` does `io.ReadAll` then single PUT — large files buffer in RAM (no multipart, shared `http.Client` 60 s timeout, no retry). `Read`/`OpenRange` are streamed. |
| Delete | ✅ | Single key only; deleting a folder marker leaves children orphaned (still listed/downloadable via prefix, billed, invisible as a folder delete). |
| Move/Copy | ✅ | Copy + Delete |
| Range streaming | ✅ | |
| Create directory | ✅ | Marker object |
| Quota | Stub `1TB` placeholder | Not backed by `ListObjects` metering |

`MaxUploadSize` multipart cap and MIME allow-list apply to S3 too, but S3 writes can still OOM on a 10 GB file without multipart. Listings and ZIP extraction through S3 share the same single-PUT path.

## Creating & Managing Roots

**On first setup** (`POST /auth/setup`) roots from `NEXORA_DEFAULT_ROOTS` are created:

```dotenv
NEXORA_DEFAULT_ROOTS=Files:/mnt/files:false,Media:/mnt/media:true,Backups:/mnt/backups:false
# Name:/path:readOnly[:indexed]   readOnly: true/ro/1 vs false; indexed: true/false (default true)
```

Set `indexed=false` for huge archival mounts you don't want `ScanAll` to walk.

**After setup:** Admin → **Storage Roots** (or `GET/POST/PUT/DELETE /api/v1/admin/roots`):

- `GET /admin/roots` — all roots with quota.
- `POST /admin/roots` `{name, path, icon?, type?, config?, read_only?, indexed?}`.
- `PUT /admin/roots/{id}` — update name/path/icon/config/flags (invalidates provider cache).
- `DELETE /admin/roots/{id}` — removes `user_roots` + `storage_roots` only (orphan `trash`/favorites/recents/`search_index` rows may linger — manual cleanup if migrating away).

**Per-user access:** `POST /admin/users/{id}/roots` `{root_id, permission: read|write}`, `DELETE /admin/users/{id}/roots/{rootId}`, `GET /admin/users/{id}/roots`. Admin has implicit full access.

**User view:** `GET /api/v1/roots` lists only roots the user can access (with `permission` field). `GET /files?root=<id>` validates against that set before dispatching to the provider.

## Permissions

- `read` — list, stat, preview, download, checksum, metadata.
- `write` — plus create/rename/move/copy/delete/upload/save.

`readOnly` roots reject writes at the provider layer even when the user has `write` permission.

## Quota & Analytics

`GetQuota()` on local roots runs `syscall.Statfs` (Linux — off-Linux returns zero `Quota`). `GET /admin/usage` and `GET /home/usage` aggregate that with `search_index` counts by MIME category. Thumbnails/archives/versions are outside roots — they live on `NEXORA_DATA_DIR`.

## Best Practices

- Bind local roots with `nexora-init` chown (`100:101`) in Compose — host `root`-owned `./data/*` is invisible to the container user otherwise.
- Use separate buckets or distinct `prefix` per root to isolate S3 data and simplify lifecycle policies.
- Set `indexed=true` for searchable roots, `false` for cold backups.
- Prefer `UsePathStyle=false` (virtual-hosted) for AWS/R2; `true` for plain-HTTP MinIO (avoids forced `https` baseURL).
- Orphan cleanup after root deletion: `DELETE FROM search_index WHERE root_id=?` etc., if you need hard removal.

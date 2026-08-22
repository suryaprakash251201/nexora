# Features

Complete reference for all Nexora capabilities. The [README Features](../README.md#features) is the overview; this page is the manual.

## Getting Started

### Quick Start (Docker)

```bash
cp .env.example .env
# edit .env
docker compose up -d --build
curl -f http://localhost/healthz
open http://localhost
```

Complete the Setup Wizard to create the admin. `NEXORA_DEFAULT_ROOTS` roots are auto-created.

### Environment Essentials

```bash
NEXORA_SESSION_SECRET=$(openssl rand -hex 32)   # recommended — else auto + persisted
NEXORA_BASE_URL=https://files.example.com      # for share links
NEXORA_SECURE_COOKIES=true                     # only with HTTPS
```

---

## File Browser

Main workspace with grid/list, dirs-first, pagination (500/5000), and indexed search bar.

| Action | How |
|--------|-----|
| Navigate | Click folder, breadcrumb back, or `G` nav shortcuts |
| Upload | Drag-drop files/folders or **Upload** button (`webkitdirectory` for folders) |
| Download | Right-click → Download, or multi-select → Download bar |
| Preview | Click file → `PreviewModal` (image/video/audio/pdf/markdown/code) |
| Rename/Move/Copy/Delete | Right-click → action, or selection bar |
| Archive | Right-click or selection → **Archive (ZIP)** (async job with SSE progress) |
| Extract | Click a `.zip` → **Extract** (zip-slip guarded) |
| Favorites | Right-click → Add to favorites (star, persists per user) |
| Trash | Delete → `.nexora-trash/<ts>_<name>`; restore/delete from **Trash** |

Density control (top toolbar, next to list/grid): **Compact** / **Comfortable** (default) / **Spacious**. Column picker (list view, toolbar Columns icon): toggle **Kind**, **Size**, **Modified**. Both persist in `localStorage` (`nexora.density`, `nexora.columns`).

## Storage Roots

Multiple named locations from one UI (`Files`, `Media`…).

```bash
NEXORA_DEFAULT_ROOTS=Files:/mnt/files:false,Media:/mnt/media:true,Backups:/mnt/backups:false
# Name:/path:readOnly[:indexed]
```

Admin → **Storage Roots**: create/modify/delete, set `icon`, per-user grants (read/write), `indexed` toggle. Each root is `type: local` or `s3` (`storage_roots.config` JSON for S3). See [Storage Roots](Storage-Roots) for S3 details.

## Search & Organization

- **Inline search:** top bar filters current folder substring instantly.
- **Global search:** sidebar **Search** → indexed full-text (`GET /search?q=&kind=&sort=&limit=&offset=&root=`) with kind→ext mapping.
- **Smart Folders (Saved Searches):** sidebar **Smart Folders** → **New** (name, query, root, sort, pin) → **Execute**. Implemented via `GET/POST/PUT/DELETE /saved-searches` + `GET /saved-searches/{id}/execute`.
- **Tags:** `GET/POST /tags` (color, per-user), `POST /files/tag` + `DELETE /files/tag` (batch).
- **Filters:** All/Folders/Documents/Images/Videos/Audio/Archives; sorts Name/Modified/Size/Type.

## Sharing

Right-click → **Share** → scope (`download`/`preview-only`), optional password, expiry hours, max downloads. Link is `/s/:token` (public route) or `/api/v1/share/{token}` API. Revoke from **Shared** sidebar; expiry/password/max caps enforced server-side (password Argon2id, token counter via `IncrementDownload`).

Public endpoints are rate-limited per IP and exempt from CSRF.

## Playlists

Select audio files → **Add to playlist**. Sidebar **Playlists**: create/rename/delete, add/remove items, set public/collaborative, manage collaborators (`editor` role), pick cover. `GET /playlists` (user-scoped) + `GET /playlists/public`, `POST /playlists/{id}/items` (`INSERT OR IGNORE`), `PATCH /playlists/{id}` for meta. Cover priority: MP3 ID3v2 APIC → FLAC PICTURE → M4A covr, else folder-scored `cover:10 front:9 folder:8…`.

## Photos Timeline

Sidebar **Photos** → cursor-paginated timeline (`GET /photos?year=&month=&make=&has_location=&favorites_only=&date_from=&date_to=&sort=&limit=&cursor=`). Facets: `years`, `cameras`, `locations`. Day-grouped perfect-row packing with real aspect ratios, sticky day headers, `On this day` memories strip, infinite scroll, `PhotoViewer` with ambient dominant-color, pinch/ctrl-zoom, filmstrip, info + OSM map clustering (grid, zero deps), selection + filter menu + command palette.

Backfill: `ScanMediaMetadata` extracts EXIF (`DateTimeOriginal`, GPS, Make/Model) + dims (PNG/GIF/WebP/JPEG magic, 64 kB no full decode; backfills `0` dims).

## Media & Previews

| Kind | Capabilities |
|------|--------------|
| Image | Zoom 0.25–5, wheel Ctrl+scroll, gallery prev/next, checkerboard backdrop |
| Video | Range streaming (RFC 9110 206 + suffix support for iOS), theater/fullscreen, subtitles, transcode fallback |
| Audio | Lossless engine (single `<audio>` element), queue/shuffle/repeat, vinyl disc, EQ, `AudioInfoPanel`, `.lrc` synced lyrics (`GET/POST/DELETE /audio/lyrics`) |
| PDF | pdfjs-dist with paginated dotted-grid backdrop |
| Markdown | `renderMarkdown` → `.markdown-body` |
| Code | Truncated at 400 kB, `codeLanguage(ext)` detection |

**Transcoding:** optional FFmpeg (`GET /files/transcode?root=&path=&format=&quality=&start=&session=`) — frag-MP4 remux vs `libx264 veryfast crf23`, AAC 128/192/320k, `flac/flac24/wav` passthrough, HLS `GET /files/hls/playlist.m3u8 + segment.ts`, semaphore 2, session manager kills old ffmpeg on seek.

## Storage Analytics

Sidebar **Analytics**: select a root → overview cards (count + size), category distribution bars, expandable details, top-10 largest files (click to navigate), duplicate groups (same SHA-256, total billed size).

Access: `GET /stats?root=` + `GET /files/duplicates?root=` (full walk, no ctx cancel — large roots can take time).

## File Versioning

Properties / Details drawer → **Version History** → New snapshot (optional note) → list (version/size/date) → Restore (rotate icon) → Delete old. Stored at `data/versions/<id>`. API: `GET/POST /files/versions?root=&path=`, `POST /files/versions/{id}/restore`, `DELETE /files/versions/{id}`. Events `version.created/restored`.

## Bulk Operations

- Select via checkboxes, `Cmd/Ctrl+A` (all), `Shift+click` (range), or selection mode toggle (`Cmd+Shift+X`).
- Bar actions: Download/Move/Copy/Archive/Share/Favorite/Delete/Tag/Rename. Rename supports Replace/Prefix/Suffix/Regex preview before apply.
- Transfers panel handles the upload queue (3 concurrent) and download pool (3 concurrent) with progress + done/error states.

## S3 Cloud Storage

Implement `StorageProvider` via `S3Config{Endpoint,Region,Bucket,AccessKeyID,SecretAccessKey,UsePathStyle,Prefix,ForceListV1}` (JSON in `storage_roots.config`). Duplicate of [Storage Roots](Storage-Roots).

| Operation | Supported |
|-----------|-----------|
| List/Search | ✅ (V2→V1→NoDelimiter fallback, manual grouping; single-page ≤1000) |
| Upload/Download | ✅ (single PUT; large files buffer in RAM — no multipart yet) |
| Delete | ✅ (single key; recursive folder delete must be added for folders with children) |
| Move/Copy | ✅ (Copy+Delete) |
| Range streaming | ✅ |
| Create directory | ✅ (marker object) |

## Webhooks & Events

Admin-authenticated webhooks (`GET/POST/DELETE /webhooks`) listen to the event bus.

**Events:** `file.created/updated/deleted/moved/copied/renamed/restored`, `directory.created`, `share.created/revoked`, `version.created/restored`.

Register:

```bash
curl -X POST http://localhost/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{"url":"https://example.com/hook","secret":"s3cret","events":["file.created"]}'
```

Delivery: `POST` JSON `{id,type,user_id,root_id,path,size,timestamp,metadata}` with headers `X-Nexora-Event`, `X-Nexora-Event-ID`, `X-Nexora-Signature` (HMAC-SHA256 over body with the secret). Bus is bounded (queue 256, 2 workers, retry 3 × 200 ms backoff). Failures are not persisted (dead-letter to be added).

## Media Utilities

- **Checksums:** `GET /files/checksum?root=&path=` (SHA-256).
- **Metadata:** `GET /files/metadata?root=&path=` (dimensions, editable flag).
- **Duplicates:** `GET /files/duplicates?root=&path=` (hash groups).
- **Quota:** `GET /admin/usage` + `GET /home/usage` (Linux `Statfs`; zero on Windows/macOS off-Linux).
- **Editor:** `GET /files/content` + `POST /files/save` with optimistic concurrency (`version = modified RFC3339Nano`), `MAX_EDITABLE_SIZE 5MB`, NUL rejection.

## UI/UX Extras

| Feature | Where | Notes |
|---------|-------|-------|
| Command palette | `Cmd/Ctrl+K` | `cmdk`, fuzzy + folder-scoped file search, actions: nav, file ops, view toggles, admin |
| Keyboard help | `?` or `Cmd/Ctrl+/` | Searchable overlay |
| Toasts with undo | After delete/rename/snapshot | `sonner` global + `store.ts` toasts; 4 s auto-dismiss |
| Transfers panel | Bottom of workspace | Glow `n-transfer-glow`, progress, retry/notify, sleep inhibition in Tauri |
| Mobile nav | `MobileNav` | When viewport < breakpoint |

## Kinds & Supported Extensions (abridged)

From `internal/storage/mime.go` and search kinds:

- **image:** `jpg/jpeg/png/gif/webp/bmp/tiff/svg/heic` — thumbnailable
- **video:** `mp4/mov/avi/mkv/webm/m4v/ts/mpg/mpeg/hevc` — range streamed
- **audio:** `mp3/flac/m4a/ogg/wav/opus/aac/wma/aiff` — playlist + cover + transcoding
- **document:** `pdf/docx/xlsx/pptx/txt/md/csv/json` — previews where possible
- **archive:** `zip/tar/gz/rar/7z` — archive/extract
- **code:** `go/ts/js/py/rs/…` + special names `dockerfile,.gitignore,.env,makefile` — editable

Taxonomy drift is expected — `previewKind` in `@nexora/core` is the source for UI, `storage/mime.go` for backend.

---

*Last updated: 1.8.0 — see [docs/features.md](../docs/features.md) for the original detailed guide.*

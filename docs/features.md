# Nexora Features & Usage Guide

A complete reference for all Nexora features with step-by-step usage instructions.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Core Features](#core-features)
3. [UI/UX Enhancements](#uiux-enhancements)
4. [Smart Folders](#smart-folders)
5. [File Versioning](#file-versioning)
6. [Storage Analytics](#storage-analytics)
7. [Bulk Operations](#bulk-operations)
8. [PostgreSQL Migration](#postgresql-migration)
9. [S3 Cloud Storage](#s3-cloud-storage)
10. [WebDAV Network Drive](#webdav-network-drive)
11. [Webhooks & Events](#webhooks--events)
12. [Keyboard Shortcuts](#keyboard-shortcuts)
13. [Tags & Labels](#tags--labels)
14. [S3-Compatible Endpoint](#s3-compatible-endpoint)
15. [Administration Console](#administration-console)
16. [Configuration Reference](#configuration-reference)
17. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Quick Start (Docker)

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your settings

# 2. Start Nexora
docker compose up -d --build

# 3. Verify health
curl -f http://localhost/healthz
# Response: {"service":"nexora","status":"ok","version":"1.6.0"}

# 4. Open browser
open http://localhost
```

### First-Run Setup

1. Open `http://localhost` in your browser
2. Complete the **Setup Wizard** to create your admin account
3. Default storage roots are auto-created from `NEXORA_DEFAULT_ROOTS`

### Environment Variables

```bash
# Required
NEXORA_SESSION_SECRET=<generate with: openssl rand -hex 32>

# Optional but recommended for HTTPS
NEXORA_BASE_URL=https://files.example.com
NEXORA_SECURE_COOKIES=true
```

---

## Core Features

### File Browser

The main file workspace with multiple views:

| Feature | How to Use |
|---------|------------|
| **Navigate** | Click folders to enter, use breadcrumbs to go back |
| **Upload** | Drag-drop files onto the browser, or click the **Upload** button |
| **Download** | Right-click a file → **Download**, or select files → **Download** in the bar |
| **Preview** | Click any file to preview (images, videos, audio, PDFs, Markdown, code) |
| **Rename** | Right-click → **Rename** |
| **Move/Copy** | Right-click → **Move** or **Copy**, then pick destination folder |
| **Delete** | Right-click → **Delete** (moves to trash) |
| **Archive** | Right-click → **Archive (ZIP)** to create a compressed archive |
| **Favorites** | Right-click → **Add to favorites** (star icon in sidebar) |

### Multiple Storage Roots

```bash
# Configure in .env (format: Name:path:readOnly:indexed)
NEXORA_DEFAULT_ROOTS=Files:/mnt/files:false,Media:/mnt/media:true,Backups:/mnt/backups:false

# Admin can create/modify roots from Admin Panel → Storage Roots
```

### Search

- **Instant search**: Type in the search bar at the top of the file browser
- **Global search**: Click **Search** in the sidebar for full-text search across all roots
- **Search inside files**: tick **In file contents** in the Search filters — the query is matched against the extracted content of PDFs (text layer), plain-text files (markdown, logs, code, …) and, when Tesseract is installed, OCR'd images. Every term must match (AND). Extraction runs in the background (new files are indexed within ~30s) and up to `NEXORA_EXTRACT_MAX_SIZE` (default 10 MB) per file.
- **Filter by type**: Use the **Filter** dropdown (All, Documents, Images, Videos, Audio, Archives, Folders)
- **Sort**: Click the **Sort** button to sort by Name, Modified, Size, or Type

### Enabling OCR (optional)

Image search requires the `tesseract-ocr` package on the server:

```bash
# Debian/Ubuntu host or container
apt-get install -y tesseract-ocr
```

Restart Nexora — it auto-detects `/usr/bin/tesseract`, or set `NEXORA_OCR_BIN=/path/to/tesseract`. Without OCR the other content search (PDF + text) still works.

### Sharing

1. Right-click a file → **Share**
2. Configure share options:
   - **Scope**: Download or Preview-only
   - **Password**: Optional password protection
   - **Expiry**: Set expiration in hours
   - **Download limit**: Max number of downloads
3. Copy the generated share link
4. Revoke shares from **Shared** in the sidebar

### Playlists

- **Create**: Select audio files → right-click → **Add to playlist** → name your playlist
- **Manage**: Click **Playlists** in the sidebar to view, rename, or delete playlists
- **Play**: Click any playlist to start playback, use the player bar at the bottom

---

## UI/UX Enhancements

### Density Control

Change the visual density of the file browser for your preference.

| Mode | Best For | How to Use |
|------|----------|------------|
| **Compact** | Power users, many files | Click the density button (3 stacked lines) next to view toggle → select leftmost icon |
| **Comfortable** | Day-to-day use (default) | Click the density button → select middle icon |
| **Spacious** | Touch screens, accessibility | Click the density button → select rightmost icon |

**Where to find**: Top toolbar, next to the List/Grid toggle buttons.

### Column Picker (List View)

Show or hide columns in the list view.

1. Switch to **List view** (click the list icon in the toolbar)
2. Click the **Columns** icon (4 bars) in the toolbar
3. Check/uncheck the columns you want:
   - **Kind** - File type
   - **Size** - File size
   - **Modified** - Last modified date

Your column preferences are saved in localStorage and persist across sessions.

### Command Palette

Quick access to all commands with fuzzy search.

| Shortcut | Description |
|----------|-------------|
| `Cmd+K` / `Ctrl+K` | Open command palette |
| Type to search | Fuzzy search commands and files |
| `↑` `↓` | Navigate results |
| `Enter` | Execute selected command |
| `Esc` | Close palette |

**Available commands**:
- Navigation: Go to Home, Files, Search, Trash, Favorites, Recents, Shared, Playlists
- File operations: New Folder, New Text File, Upload, Refresh, Download, Share, Favorite, Rename, Move, Copy, Archive, Delete
- View: Toggle list/grid, toggle selection mode
- Settings: Open admin panel, help

**Pro tip**: When in the file browser, the command palette also searches your current folder's files!

### Toast Notifications with Undo

Actions show notifications with optional undo:

| Action | Toast Message | Action Button |
|--------|--------------|---------------|
| File deleted | "File moved to trash" | **Undo** - Restores the file |
| File renamed | "File renamed" | - |
| Snapshot created | "Snapshot created" | - |

Toasts auto-dismiss after 4 seconds. Click the **X** to dismiss early.

### Keyboard Shortcuts Overlay

Press **`?`** (or **`Cmd+/`** / **`Ctrl+/`**) anywhere to see all available keyboard shortcuts in a searchable overlay.

---

## Smart Folders

Smart Folders are saved searches that auto-update with matching files. Perfect for:
- "All PDF documents"
- "Images modified this week"  
- "Videos larger than 100MB"
- "Music files in a specific root"

### Creating a Smart Folder

1. Click **Smart Folders** in the sidebar
2. Click **New** button
3. Fill in:
   - **Name**: e.g., "Recent Photos"
   - **Search Query**: e.g., "vacation" (matches file names)
   - **Root** (optional): Limit to a specific storage root
   - **Sort**: Name, Modified, Size, or Type
   - **Order**: Ascending or Descending
   - **Pin to top**: Keeps it at the top of the list
4. Click **Create**

### Using Smart Folders

- **Execute**: Click any smart folder to run the saved search
- **Edit**: Hover over a smart folder → click the **pencil** icon
- **Delete**: Hover → click the **trash** icon
- **Pin/Unpin**: Hover → click the **pin** icon to toggle

### Filtering Smart Folders

Click the **Filters** button to filter smart folders by:
- **Kind**: All, Folders, Documents, Images, Videos, Audio, Archives
- **Modified**: Any time, Past week, Past month

---

## File Versioning

Track and restore previous versions of any file. Each time you save a snapshot, a copy of the file is preserved.

### Creating a Snapshot

1. Locate a file in the file browser
2. Right-click the file → **Version history** (or open the Details drawer → **Versions** tab)
3. Click **New snapshot**
4. Optionally add a note (e.g., "Before major edit")
5. Click **Save**

### Automatic snapshots

Since versioning is on by default, Nexora also captures a snapshot **automatically** whenever
you overwrite an existing file — resumable or single-request upload, drag-and-drop, or saving
from the built-in text editor. These auto-snapshots are marked with an **auto** tag in the
panel so you can tell them apart from snapshots you took by hand. That means every bad
overwrite is undoable with one click, even if you never thought to snapshot.

### Retention

- **Per-file cap** (`NEXORA_VERSION_MAX_PER_FILE`, default 50): when you exceed it, the oldest
  snapshots for that file are pruned automatically as new ones are taken.
- **Age cap** (`NEXORA_VERSION_MAX_AGE`): the maintenance sweep purges snapshots older than
  this (e.g. `180d`).
- **Total-size cap** (`NEXORA_VERSION_MAX_TOTAL_BYTES`): once version storage across all files
  exceeds this, the oldest snapshots (while keeping the newest per file) are dropped.
- **File-size cap** (`NEXORA_VERSION_MAX_FILE_SIZE`, default 256 MB): snapshots skip files
  larger than this so a 20 GB ISO doesn't duplicate itself on every overwrite.
- Set `NEXORA_VERSION_ENABLED=false` to turn the whole feature off, or
  `NEXORA_VERSION_AUTO=false` to keep manual snapshots only.

### Restoring a Version

1. Open the Version History panel for a file
2. Find the version you want to restore
3. Click the **rotate** icon (**Restore**)
4. Confirm the restoration dialog

Restoring is itself undoable — the current live file is snapshotted
automatically before it's replaced, so no restore can destroy data.

### Managing Versions

- **View all versions**: Lists all snapshots with version number, size, and date
- **Download a version**: Click the **download** icon to grab a copy without restoring it
- **Delete old versions**: Click the **trash** icon on any version
- **Current version**: Always shown at the top, marked as "Latest"

### API Examples

```bash
# List versions for a file
curl http://localhost/api/v1/files/versions?root=<root_id>&path=<file_path> \
  -H "Cookie: session=<session_token>"

# Create a snapshot
curl -X POST http://localhost/api/v1/files/versions \
  -H "Content-Type: application/json" \
  -H "Cookie: session=<session_token>" \
  -d '{"root":"<root_id>","path":"<file_path>","note":"Before edit"}'

# Download a specific version's bytes
curl -OJ http://localhost/api/v1/files/versions/<version_id>/download \
  -H "Cookie: session=<session_token>"

# Restore a version
curl -X POST http://localhost/api/v1/files/versions/<version_id>/restore \
  -H "Cookie: session=<session_token>"
```

---

## Storage Analytics

Visual insights into your storage usage, file distribution, and duplicates.

### Accessing Analytics

1. Click **Analytics** in the sidebar
2. Select a storage root from the dropdown

### Analytics Dashboard

| Section | Description |
|---------|-------------|
| **Overview Cards** | Total file count and total storage size |
| **Category Distribution** | Breakdown by type: Images, Videos, Audio, Documents, Archives, Code, Other |
| **Category Details** | Expand any category to see exact count and size |
| **Largest Files** | Top 10 largest files across the root |
| **Duplicate Files** | Files with identical content (same SHA-256 hash) |

### Using Analytics

- **Category bars**: Visual representation of storage usage by category with percentage
- **Largest files**: Click any file to navigate directly to it
- **Duplicates**: Click the **Duplicate Files** section to expand → see all duplicate groups with file sizes
- **Root switcher**: Use the dropdown at the top to switch between storage roots

---

## Bulk Operations

### Bulk Rename

Rename multiple files at once using patterns.

1. Select multiple files in the file browser (use checkboxes or `Cmd/Ctrl+click`)
2. In the selection bar, use the **Rename** button (coming soon to UI)
3. Choose rename mode:

| Mode | Example | Result |
|------|---------|--------|
| **Replace** | Find "IMG" → Replace with "Photo" | `IMG_001.jpg` → `Photo_001.jpg` |
| **Prefix** | Add "2024_" | `vacation.jpg` → `2024_vacation.jpg` |
| **Suffix** | Add "_backup" | `report.pdf` → `report_backup.pdf` |
| **Regex** | Pattern `^(.+)$` → Replace `$1_processed` | Advanced renaming with regex |

4. Preview the changes before applying
5. Click **Apply** to rename all selected files

### Multi-Select Actions

When files are selected, use the **Selection Bar** at the bottom:

| Action | Shortcut | Description |
|--------|----------|-------------|
| Download | `Cmd+D` | Download all selected |
| Move | `Cmd+Shift+M` | Move to another folder |
| Copy | `Cmd+Shift+C` | Copy to another folder |
| Archive | `Cmd+Shift+A` | Create ZIP of selection |
| Share | `Cmd+Shift+S` | Share selected files |
| Favorite | `Cmd+Shift+F` | Toggle favorites |
| Delete | `Delete` | Move to trash |

---

## PostgreSQL Migration

Scale Nexora from single-node SQLite to multi-node PostgreSQL.

### When to Use PostgreSQL

- **Multi-user deployments** with concurrent writes
- **High availability** requirements (replication, failover)
- **Large storage** (100GB+ metadata)
- **Existing PostgreSQL infrastructure**

### Enabling PostgreSQL

**Option 1: Docker Compose**

```bash
# Start with PostgreSQL
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d

# Configuration is automatic - PostgreSQL runs on port 5432
```

**Option 2: Manual Configuration**

```bash
# 1. Set up PostgreSQL database
createdb nexora

# 2. Configure environment
export NEXORA_DATABASE_TYPE=postgres
export NEXORA_DATABASE_URL="postgres://user:password@host:5432/nexora?sslmode=disable"

# 3. Build and run (Go build includes postgres tag)
go build -tags postgres ./cmd/nexora
./nexora
```

### Migration from SQLite

Nexora auto-migrates schema on startup. To migrate data:

```bash
# 1. Export SQLite data (use sqlite3 CLI)
sqlite3 data/nexora.db .dump > backup.sql

# 2. Start Nexora with PostgreSQL (creates schema)
# 3. Import data manually as needed
psql -d nexora -f backup.sql
```

### Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXORA_DATABASE_TYPE` | `sqlite` | `sqlite` or `postgres` |
| `NEXORA_DATABASE_PATH` | `./data/nexora.db` | SQLite file path |
| `NEXORA_DATABASE_URL` | - | PostgreSQL connection URL |

---

## S3 Cloud Storage

Add AWS S3, Cloudflare R2, or MinIO as storage roots.

### Architecture

```
Nexora Server
  ├── Local Filesystem Provider  (default)
  ├── S3 Provider                (AWS S3, R2, MinIO)
  └── (future: SFTP, Azure, GCS)
```

### S3 Provider (Developer Reference)

The S3 provider implements the `StorageProvider` interface using the S3 REST API. To add an S3 root programmatically:

```go
import "github.com/nexora/nexora/internal/storage"

cfg := storage.S3Config{
    Endpoint:     "https://s3.amazonaws.com",        // AWS S3
    // Endpoint:  "https://<account>.r2.cloudflarestorage.com", // R2
    // Endpoint:  "http://localhost:9000",           // MinIO
    Region:       "us-east-1",
    Bucket:       "my-nexora-files",
    AccessKeyID:  "AKIA...",
    SecretAccessKey: "secret...",
    UsePathStyle: false,   // true for MinIO
    Prefix:       "",       // optional prefix within bucket
}

provider := storage.NewS3Provider(cfg)
```

### Supported S3 Operations

| Operation | Supported |
|-----------|-----------|
| List files/directories | ✅ |
| Upload (Put) | ✅ |
| Download (Get) | ✅ |
| Delete | ✅ |
| Move (Copy+Delete) | ✅ |
| Copy | ✅ |
| Range requests (streaming) | ✅ |
| Create directory | ✅ |

---

## WebDAV Network Drive

Mount Nexora as a network drive in your operating system.

### Supported Platforms

| OS | Method |
|----|--------|
| **Windows** | Map Network Drive → `http://<server>/webdav/<root>` |
| **macOS** | Finder → Go → Connect to Server → `http://<server>/webdav/<root>` |
| **Linux** | `mount -t davfs http://<server>/webdav/<root> /mnt/nexora` |

### Supported WebDAV Methods

| Method | Description |
|--------|-------------|
| `OPTIONS` | Discover supported methods |
| `PROPFIND` | List directory contents |
| `GET` / `HEAD` | Download files |
| `PUT` | Upload/create files |
| `DELETE` | Remove files/directories |
| `MKCOL` | Create directories |
| `MOVE` | Move/rename files |
| `COPY` | Copy files |
| `LOCK` / `UNLOCK` | File locking |

### WebDAV Implementation

```go
import "github.com/nexora/nexora/internal/webdav"

handler := webdav.NewHandler(provider, rootName, rootID)
// Mount handler at /webdav/<root> in the router
```

---

## Webhooks & Events

Receive real-time notifications when file operations occur.

### Available Events

| Event Type | Trigger |
|------------|---------|
| `file.created` | File uploaded or created |
| `file.updated` | File modified |
| `file.deleted` | File moved to trash |
| `file.moved` | File moved to new location |
| `file.copied` | File duplicated |
| `file.renamed` | File renamed |
| `directory.created` | New folder created |
| `share.created` | Share link created |
| `share.revoked` | Share link revoked |
| `version.created` | File snapshot created |
| `version.restored` | File version restored |

### Registering a Webhook (API)

```bash
curl -X POST http://localhost/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -H "Cookie: session=<admin_session>" \
  -d '{
    "url": "https://my-service.com/webhook",
    "secret": "my-webhook-secret",
    "events": ["file.created", "file.deleted"]
  }'
```

### Webhook Payload Format

```json
{
  "id": "evt_1234567890",
  "type": "file.created",
  "user_id": "user_abc123",
  "root_id": "root_files",
  "path": "documents/report.pdf",
  "size": 1048576,
  "timestamp": "2026-07-26T08:35:16Z",
  "metadata": {}
}
```

### Webhook Headers

| Header | Description |
|--------|-------------|
| `X-Nexora-Event` | Event type (e.g., `file.created`) |
| `X-Nexora-Event-ID` | Unique event identifier |
| `X-Nexora-Signature` | HMAC signature (when secret is set) |

---

## Administration Console

The **Administration** panel (sidebar → Admin, admins only) is now a sidebar-led
console with six sections:

| Section | What you can do |
|---------|-----------------|
| **Overview** | Stat cards (users, roots, files indexed, bytes stored), animated storage-usage bars per root, quick actions (reindex, add root, add user, back up), recent audit feed, system info |
| **Users** | Create/edit users, switch roles (admin/user/viewer), enable/disable, reset passwords, manage per-root permissions |
| **Storage Roots** | Add / edit / delete roots (local paths or S3) — a dedicated section of its own |
| **Audit Log** | Browse recent security & admin events with color-coded action badges |
| **Backups** | One-click manual database backup (`VACUUM INTO` for SQLite; PostgreSQL deployments should use pg_dump), per-snapshot list with size/date, delete individual snapshots, and the daily schedule summary (`NEXORA_BACKUP_DIR` / `KEEP` / `HOUR`) |
| **Settings** | Default view mode, accent theme, version/runtime info |

## Keyboard Shortcuts

### Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` / `Ctrl+K` | Open command palette |
| `?` or `Cmd+/` / `Ctrl+/` | Show keyboard shortcuts overlay |
| `Esc` | Close modal / clear selection |

### File Operations

| Shortcut | Action |
|----------|--------|
| `Cmd+N` / `Ctrl+N` | New folder |
| `Cmd+Shift+N` / `Ctrl+Shift+N` | New text file |
| `Cmd+U` / `Ctrl+U` | Upload files |
| `F5` | Refresh view |
| `Cmd+D` / `Ctrl+D` | Download selected |
| `Cmd+Shift+S` / `Ctrl+Shift+S` | Share selected |
| `Cmd+Shift+F` / `Ctrl+Shift+F` | Toggle favorite |
| `F2` | Rename selected item |
| `Cmd+Shift+M` / `Ctrl+Shift+M` | Move selection |
| `Cmd+Shift+C` / `Ctrl+Shift+C` | Copy selection |
| `Cmd+Shift+A` / `Ctrl+Shift+A` | Archive selection |
| `Delete` | Delete selection |
| `Cmd+A` / `Ctrl+A` | Select all files |

### Navigation

| Shortcut | Action |
|----------|--------|
| `G` then `H` | Go to Home |
| `G` then `F` | Go to Files |
| `G` then `T` | Go to Trash |
| `G` then `S` | Go to Favorites |
| `G` then `R` | Go to Recent |
| `G` then `W` | Go to Shared |
| `G` then `P` | Go to Playlists |
| `G` then `/` | Go to Search |
| `/` | Quick search |

### View

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+V` / `Ctrl+Shift+V` | Toggle list/grid view |
| `Cmd+Shift+X` / `Ctrl+Shift+X` | Toggle selection mode |

---

## Configuration Reference

### Complete Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| **Server** | | |
| `NEXORA_LISTEN_ADDR` | `:8080` | HTTP listen address |
| `NEXORA_BASE_URL` | `http://localhost:8080` | Public URL for share links |
| **Database** | | |
| `NEXORA_DATABASE_TYPE` | `sqlite` | `sqlite` or `postgres` |
| `NEXORA_DATABASE_PATH` | `./data/nexora.db` | SQLite file path |
| `NEXORA_DATABASE_URL` | - | PostgreSQL connection URL |
| `NEXORA_DATA_DIR` | `./data` | Data directory |
| **Security** | | |
| `NEXORA_SESSION_SECRET` | auto-generated | Session signing secret |
| `NEXORA_SESSION_LIFETIME` | `168h` | Session duration (Go duration) |
| `NEXORA_SECURE_COOKIES` | `false` | Require HTTPS for cookies |
| `NEXORA_MAX_UPLOAD_SIZE` | `512GB` | Maximum upload size (effectively unlimited by default) |
| `NEXORA_ALLOWED_MIME` | (all) | Comma-separated MIME allowlist |
| `NEXORA_RATE_LIMIT_PER_MIN` | `60` | Login rate limit |
| `NEXORA_LOCKOUT_ATTEMPTS` | `5` | Failed attempts before lockout |
| `NEXORA_LOCKOUT_WINDOW` | `15m` | Lockout duration |
| **Networking** | | |
| `NEXORA_TRUSTED_PROXIES` | - | Proxy CIDRs for X-Forwarded-For |
| `NEXORA_CORS_ORIGINS` | - | CORS allowed origins |
| **Storage Roots** | | |
| `NEXORA_DEFAULT_ROOTS` | `Files:/mnt/files:false,...` | Auto-created roots |
| **Media** | | |
| `NEXORA_THUMBNAIL_CACHE_DIR` | `./data/cache/thumbnails` | Thumbnail cache |
| `NEXORA_THUMBNAIL_MAX_SIZE` | `20MB` | Max source size for thumbnails |
| `NEXORA_THUMBNAIL_TTL` | `168h` | Thumbnail cache lifetime |
| `NEXORA_ENABLE_FFMPEG_THUMBS` | `false` | Video thumbnails (needs ffmpeg) |
| **Editor** | | |
| `NEXORA_MAX_EDITABLE_SIZE` | `5MB` | Max file size for editor |
| **Monitoring** | | |
| `NEXORA_ENABLE_PROMETHEUS` | `false` | Enable `/metrics` endpoint |
| `NEXORA_LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |
| `NEXORA_LOG_FORMAT` | `json` | Log format (json/text) |

---

## Troubleshooting

### Docker Build Fails

```bash
# Clean rebuild
docker compose down
docker system prune -f
docker compose build --no-cache
docker compose up -d
```

### Database Issues

```bash
# Reset SQLite database (WARNING: deletes all data)
docker compose down
rm -rf data/
docker compose up -d

# Check PostgreSQL connection
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d
docker compose logs postgres
```

### Storage Permission Issues

```bash
# Fix folder permissions
docker compose down
sudo chown -R $USER:$USER data/
docker compose up -d
```

### Health Check Fails

```bash
# Check logs
docker compose logs nexora

# Test manually
curl -v http://localhost/healthz

# Restart
docker compose restart nexora
```

### PostgreSQL Build (with lib/pq)

```bash
# Install Go dependency for PostgreSQL support
go get github.com/lib/pq@v1.10.9
go mod tidy

# Build with PostgreSQL support
go build -tags postgres ./cmd/nexora
```

---

## Tags & Labels

Color-coded, per-user tags you can attach to any file or folder you can read. Tags are
personal annotations — they live in the database, never mutate your files, and work even
on read-only roots.

### Tagging a file

1. Right-click any file → **Tags…**
2. Click a tag to apply it (✓), or type a name + pick a color to **Create new tag**
3. Tag chips appear on the file's row / tile so you can see everything at a glance

Apply a tag to a whole selection (right-click with multiple files selected) in one shot.

### Filtering by tag

Click a tag in the **filter bar** above the file grid to show only files carrying it.
Multiple tags combine with AND (a file must have all of them). **Clear filters** resets.
The bar only appears once you have at least one tag.

### Managing tags

Right-click any file → **Manage tags…** opens the tag manager:

- **Rename / recolor** — pencil icon, pick from the palette, save
- **Delete** — removes the tag from every file that used it (files are untouched)
- Every row shows its current usage count

### API

```bash
# List tags (with per-tag usage counts)
GET /api/v1/tags

# Create a tag
POST /api/v1/tags            { "name": "Docs", "color": "#3B82F6" }

# Rename / recolor
PATCH /api/v1/tags/{id}      { "name": "Documents" }

# Delete a tag (removes it from all files, cascades)
DELETE /api/v1/tags/{id}

# Tag files
POST /api/v1/files/tag       { "tag_id": "…", "root_id": "…", "paths": ["a.pdf"] }

# Untag files
DELETE /api/v1/files/tag?tag_id=…&root_id=…&paths=a.pdf
```

## S3-Compatible Endpoint

Nexora speaks the S3 API, so any S3 client can read and write your workspace with
zero Nexora-specific code — no custom sync daemon, no plugins.

**Mapping:**

| S3 concept | Nexora |
|------------|--------|
| Bucket | Storage root (by name: `Files`, `Media`, …) |
| Object key | File path inside the root (`docs/report.pdf`) |
| Credentials | Personal API token (`nxr_…`) used as **both** access key and secret |
| ListObjectsV2 | `?prefix`, `?delimiter=/`, `?max-keys`, `?continuation-token` |
| Multipart upload | Full lifecycle (create / part / list-parts / complete / abort) |
| Range reads | `GET` with `Range:` header (streaming) |

### rclone setup

```ini
[nexora]
type = s3
provider = Other
endpoint = http://localhost:8080/s3
access_key_id = nxr_your_token_here
secret_access_key = nxr_your_token_here
force_path_style = true
```

```bash
rclone ls nexora:Media/Movies/
rclone copy ./backup.tar.gz nexora:Backups/
rclone sync ~/Photos nexora:Photos/ --backup-dir nexora:Photos/.trash/
```

### Creating a token

Settings → Security → **API tokens** → create one (or `POST /api/v1/auth/tokens`).
The raw token is shown once; paste it into both S3 credential fields of your client.

### Notes

- **Permissions follow the user**: buckets (roots) you can read are listable;
  writes require write access to the root. Read-only roots reject PUT.
- **Every write behaves like a UI upload**: search index updated, recents
  populated, audit logged — and overwriting an existing file creates an
  automatic **version snapshot** (see File Versioning), so a bad `rclone sync`
  is undoable from the UI.
- **mtime preservation**: rclone's `x-amz-meta-mtime` header is honoured on
  write and reported on read/list, so sync round-trips keep timestamps.
- **Deletes are immediate** (S3 semantics — trash is bypassed).
- `ETag` is a stable opaque tag derived from size + mtime (Nexora does not
  store content hashes); rclone change-detection still works via size + mtime.
- Endpoint base: `https://your-host/s3`. Multipart parts are staged inside the
  root's own provider under a hidden `.nexora-mpu/` namespace and cleaned up
  on complete/abort.

## Feature Quick Reference

| Feature | Where to Find | Shortcut |
|---------|--------------|----------|
| Density Control | Toolbar → 3 stacked icons | - |
| Column Picker | Toolbar → Columns icon | - |
| Command Palette | Press Cmd+K | `Cmd+K` |
| Keyboard Shortcuts | Press ? | `?` |
| Smart Folders | Sidebar → Smart Folders | - |
| Storage Analytics | Sidebar → Analytics | - |
| Bulk Rename | Selection Bar → Rename | - |
| File Versioning | Details Drawer → Version History | - |
| Tags & Labels | Right-click → Tags… / Manage tags… | - |
| PostgreSQL | Environment config | - |
| S3 Storage | Code integration | - |
| WebDAV | Network drive mount | - |
| Webhooks | API / Admin Panel | - |
| **Administration Console** | Sidebar → Admin (Overview / Users / Roots / Audit / Backups / Settings) | - |
| S3 Endpoint | `https://host/s3` (any S3 client) | - |

---

*Document version: 2.1 — Last updated: 2026-07-26*

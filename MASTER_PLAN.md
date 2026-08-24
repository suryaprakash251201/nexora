# Nexora Web + Desktop — Master Plan

> Scope: `web/` (React 19 + Vite 8 + Tailwind 4 + React Query + Zustand) and `desktop/` (Tauri 2 shell).
> Every finding below was verified against the source on disk (2026-08-24). Line numbers refer to current HEAD.
> Backend (`internal/`, `migrations/`) is out of scope except where a frontend fix requires matching server behavior.

---

## ✅ Execution ledger (updated as work lands)

**Verification state after this round:** `web` typecheck ✓ · `vite build` ✓ · web unit tests 13/13 ✓ · `nexora-audio` cargo tests 11/11 ✓ · desktop `cargo check` ✓ · Go backend builds ✓ (untouched)

### Phase 0 — Security hardening: **DONE**
- [x] **S1** Media token lifetime 365→30 days (`nativeAudio.ts`), `clearMediaToken()` wired into logout (`Workspace.tsx`)
- [x] **B12** Token validation now targets `getBaseUrl()` instead of `window.location.origin`
- [x] **S3** `noopener,noreferrer` on all `window.open` sites; SharePage blob URL revoked + popup-blocked message
- [x] **S8** Private tailnet hostname/IP removed from `client.ts` (`DISCOVERY_HOSTS` = localhost only)
- [x] **S4** Protocol-relative `//host` URLs rejected in markdown links/images
- [x] **D** Unused VLC `shell:allow-execute` capability deleted; `shell:allow-open` scoped to explicit allowlist; `withGlobalTauri` off
- [x] **CSP** `frame-src` tightened to OSM embed only; added `object-src 'none'`, `base-uri`, `form-action`
- [x] **D-A** `desktop/package.json` + `Cargo.toml` version synced to 1.9.0; placeholder authors fixed

### Phase 1 — Critical bugs: **DONE**
- [x] **B4** Safe localStorage parse + defaults merge for columns (app no longer bricks on corrupt value)
- [x] **B2** Chunked-upload `chunks_missing` retry no longer double-releases the concurrency slot
- [x] **B22** NaN worker-count guarded when server omits `totalChunks`
- [x] **B1** `<audio>` re-binds via callback ref; `engine.bind` idempotent per element; `detach()` on unmount
- [x] **B3** Native handoff serialized via `nativeSeq` — stale track-open can't kill current playback

### Phase 2 — Player correctness: **DONE**
- [x] **B9/B10** `prev()` restart works in native mode; shuffle can't repeat current track
- [x] **B20** MEDIA_ERR_NETWORK / MEDIA_ERR_DECODE surfaced instead of silent failure (PlayerBar + AudioPlayer)
- [x] **B21** Fullscreen key handler reads live store state (no more 4 Hz listener churn); contentEditable guard
- [x] **B19** Uncontrolled `ended` listener uses latest-ref for `step`
- [x] **B8** VideoPlayer keyboard seeks use live refs (correct after transcode fallback)
- [x] **B31** Subtitle read guarded; controls auto-hide timer cleared on unmount
- [x] **D-G** Rust seek rebase divides by channels; prebuffer target scales with channel count

### Phase 3 — Transfers & file ops: **DONE**
- [x] **B6** Clear-finished keeps queued/retrying/processing rows
- [x] **B16** Transfers panel opens once per batch, never fights a user dismissal
- [x] **Retry feature** new `retryTransfer()` + button on failed uploads (resumes from last acked chunk)
- [x] **B13** Bulk delete reports real counts + per-item failures (max 3 shown)
- [x] **B14/B15** Clipboard cleared only after fully successful paste; per-item failures reported; `_timers` out of store state
- [x] **B5** Drag onto folder moves directly to that folder
- [x] **B7** Chunk retries reset in-flight byte counters (no progress inflation)
- [x] **B17** Archive SSE/download URLs resolve against configured API base
- [x] **B18** Extraction refreshes on backoff schedule (1.5s/4s/8s)

### Phase 5 — Desktop fixes: **DONE**
- [x] **D-E** Reveal-in-file-manager now permitted by scoped `shell:allow-open` patterns
- [x] **D-F** Drag-drop permission denials surface a toast with guidance
- [x] **D-H** `audio_native_open` runs on a blocking thread pool (UI can't stall on slow servers)
- [x] **D-B** Updater offers download-hint instead of failing install on deb/rpm Linux
- [x] Crash/error logs get per-PID temp names (anti-symlink/info-leak hardening)

### Code health (partial P4): **DONE**
- [x] Deleted dead code: `lib/subtitles.ts`, `App.tsx handleLogout`, `player.ts currentAudioUrl()`, unused `onEvent`, `{!videoItem && null}`, TextEditor discarded `parts`, Login constant-effect, clipboard `moveSelectionTo`
- [x] Consolidated 12 divergent `isTauri()` implementations onto `lib/desktop.ts`
- [x] **B34** Magic 50 ms preview delay removed
- [x] **B11** JSON tree `Node` hoisted to module level (collapse state survives re-renders)

### Session 2 — P2 leftovers, P4 code health, UX quick wins: **DONE**
- [x] **B24** Browser downloads stream straight to disk via File System Access API (save-as dialog, no tab-memory buffering); graceful fallback to blob path; user-cancel respected
- [x] **B36** Queue persistence debounced 400 ms (no full-queue localStorage write per action)
- [x] **B32** SharePage download revoke moved off the click tick (browser-safe)
- [x] **Toast unification (R2)** single `lib/toast.ts` shim backed by the themed custom Toaster; sonner consumers ported (UpdaterCheck, VersionHistoryPanel, pdf/ShareSheet, SavedSearchesPanel); sonner mount + dependency removed; toast stack capped at 4
- [x] **Core consolidation** canonical extension sets exported from `@nexora/core` and adopted in FileBrowser/PreviewModal/Workspace/FileThumb/CoverPickerModal; hand-rolled formatters in VideoView/TextWorkspace replaced by core imports
- [x] **Search ↔ URL sync (R1)** active search lives in `?q=` — reloads, back/forward, shareable links
- [x] **Workspace decomposition (R3 start)** extracted GridView/ViewSkeleton/LibraryViews/DropRootPicker/ActionModals into `components/views/*` — Workspace.tsx 1274 → 962 lines
- [x] **Media Session API (§5.10)** OS now-playing metadata + hardware-key prev/next/seek on web
- [x] **F5 hijack removed** browser refresh restored; shortcut docs updated
- [x] **R6** aria-labels on player transport controls
- [x] **D-J** `Cargo.lock` unignored for reproducible desktop builds; unused `sonner` dep dropped

### Session 3 — Player decomposition, undo, empty states: **DONE**
- [x] **AudioPlayer decomposition (R3)** extracted `MediaPlayer/QueuePanel.tsx` (147 ln) and `MediaPlayer/MiniPlayer.tsx` (189 ln) as dumb prop-driven components → AudioPlayer.tsx **1224 → 1036 lines**; fullscreen overlay + shared `<audio>` ownership stays in one place
- [x] **Undo for trash (§5.6)** single-item delete toasts now offer Undo — restores via freshest matching trash entry (`root_id` + `original_path`, sorted by `deleted_at`)
- [x] **R4 empty states** GridView/TrashView/Favourites/Recents now use branded `EmptyState` variants (favorites/recents/trash illustrations) instead of plain text
- [x] Verified: tsc ✓ build ✓ 13/13 tests ✓

### Session 4 — Flat header redesign (user request): **DONE**
- [x] **ViewHeader flattened** removed the `rounded-2xl glass` card bar; views now open with plain typography directly on the page background: bare accent icon, bold tracking-tight title, muted subtitle, right-aligned actions. Sticky views get an invisible soft veil (`bg-background/85 backdrop-blur-md`) so content scrolls beneath without a visible bar
- [x] Applies automatically to Favourites, Recents, Shared, Playlists, Trash, Search, Photos, Admin, Storage Analytics (all ViewHeader consumers)
- [x] **HomePanel hero simplified** gradient banner band + rounded icon-chip card + bg-clip name gradient removed → clean typographic greeting (icon inline, solid accent name), lighter search field (h-12), no banner chrome
- [x] Verified: tsc ✓ build ✓ 13/13 tests ✓

### Session 5 — Blended workspace chrome (user master prompt): **DONE**
- [x] **`WorkspaceHeader` component** (`components/layout/`) replaces both heavy rounded cards (Home + all other views) — one reusable instance: glowing dot active indicator, view icon + label from `VIEW_HEADER_META` (matches sidebar labels/icons), right-aligned user control slot
- [x] **Ambient lighting** `.ws-header::before` dual radial glow (accent blue 9% / accent purple 6%, 40px blur) via `color-mix` on theme tokens; static, GPU-cheap, `isolation:isolate` guard
- [x] **Blended surface** `.ws-surface`: 56px / 16px radius / hairline glass border / backdrop-blur 20px; hover = subtle border lift; **scrolled state** (`data-scrolled`, capture-phase passive listener covering every internal scroller incl. Home) strengthens glass to blur 26px + deeper shadow over ~220ms ease-out
- [x] **Thick vertical bar removed** → two-layer tiny glowing dot (blurred halo + crisp gradient core)
- [x] **Breadcrumb primitive** built into the header (`Files › Music › …`, muted, hoverable, `aria-current`), rendered only when provided
- [x] **User control** avatar bumped to 36px with soft accent glow halo on hover, focus-visible ring kept; dropdown menu untouched
- [x] Home hero now flows directly under the shared header (no duplicate second card)
- [x] Verified per §22: tsc ✓ build ✓ 13/13 tests ✓ · no horizontal overflow (truncation + shrink-0) · no layout shift (same 56px footprint) · reduced-motion collapses transitions via global rule

### Session 6 — Advanced drag-to-move system (user master prompt): **DONE**
- [x] **`lib/dragMove.ts` engine** module store describing the active drag (paths/names/count/kind); `application/x-nexora-move` dataTransfer MIME replaces fragile text/plain heuristics; `canDropInto()` self/descendant guard; imperative premium drag-image builder (glass chip + icon + name + "+N more" badge + stacked-card hint) — zero JS mouse tracking, native cursor-follow
- [x] **FileBrowser** grid tiles AND list rows are now truly draggable (`selectMode` requirement removed — works any time, desktop-FM style): dragging a selected item carries the whole selection, unselected item drags alone; sources dim (`opacity-40 saturate-50`)
- [x] **Drop targets**: folder tiles/rows highlight with accent ring + outer glow halo + `scale-[1.04]` elevation + **"Move here"** pill; invalid destinations never preventDefault → native forbidden cursor; drop = real `POST /files/move` via existing `transferPaths` (per-item failures reported honestly, success clears selection)
- [x] **Breadcrumbs**: internal drags detected via MIME, self/descendant rejected, glow-ring highlight + move glyph, payload forwarded (`path, paths[]`)
- [x] **Sidebar storage entry** (active root only) accepts drops → moves into that storage's base directory, with "Move here" pill; cross-root stays forbidden (API limitation, honest cursor)
- [x] **OS-file upload parity**: dropping system files onto any folder row/card uploads there ("Upload here" chip) — previously only crumbs supported this
- [x] Fixed two ordering bugs found in self-review (store cleared before payload read in breadcrumbs + sidebar flows)
- [x] Verified: tsc ✓ build ✓ 13/13 tests ✓

### Session 7 — Mobile redesign pass (user request): **DONE**
- [x] **Brand alignment with web** (`theme.ts`): accent #4F46E5 indigo → **#5B8CFF electric blue** family matching web tokens; added `accentSecondary` (#7A5CFF violet) / `accentTertiary` (#35D3FF cyan); refreshed `brand`/`brandDeep`/`hero`/`player` gradients for both themes; light-mode accent deepened to #3F6BE0 for AA contrast
- [x] **PremiumTabBar v2**: real frosted glass via expo-blur (`dimezisBlurView` on Android — v54 renamed API caught per AGENTS.md), brand-tinted veil gradient inside the bar, sliding capsule now a blue→violet gradient with soft outer glow, bolder focused labels, haptic tick on tab change (respects prefs)
- [x] **HomeScreen**: quick-category gradients re-mapped to the new palette (Photos=brand blue/violet, Audio=cyan/teal); pull-to-refresh now fires a light haptic
- [x] **MiniPlayer** play/pause glow shadow recolored to new accent; **PreviewScreen** seek-bar fill gradient moved off old indigo
- [x] Login/Splash inherit new palette automatically (fully token-driven)
- [x] Verified: `tsc --noEmit` ✓ (Expo 54 API drift caught & fixed: `experimentalBlurMethod="dimezisBlurView"`)

### Session 8 — Cover-art bug fix + glass pass (user request): **DONE**
- [x] **Cover-art fix (MiniPlayer)**: thumbnails are generated server-side on demand; the first request after a track change could fail while ffmpeg was busy → blank artwork until the player was reopened. Now: brand-gradient placeholder ALWAYS renders beneath the art (never a void box), load errors trigger **bounded auto-retry with backoff** (`&_r=N` cache-buster, max 4 attempts ≈6s), success stops the chain, opening the player resets the cycle. Applied to fullscreen artwork, blurred background, and mini-bar thumb (+ `recyclingKey` for correct expo-image recycling)
- [x] **Glass pass**: mini bar converted from opaque surface to frosted BlurView underlay + translucent veil (content scrolls visibly behind); BottomSheet surface frosted (queue/more sheets inherit); Home root-cards + stats card now translucent so the hero glow bleeds through — zero extra blur layers inside scrolling lists (perf guard)
- [x] Verified: `tsc --noEmit` ✓

### Session 9 — Video player redesign (user request): **DONE**
- [x] **Custom Nexora control layer** replaces raw `nativeControls`: tap-to-toggle chrome with 3s auto-hide while playing, YouTube-style **double-tap left/right thirds = ∓10s** (uses expo-video `seekBy`), center glass cluster (−10s · play/pause · +10s) with gradient play button
- [x] **Bottom glass panel**: tabular time row, brand-gradient seek bar with glowing thumb (scrub preview commits on release via `player.currentTime`), playback-speed pill (1/1.25/1.5/2/0.75 — real `playbackRate` set), mute toggle, options sheet relocated into the control row (floating orphan button removed)
- [x] Top/bottom legibility fades; haptic ticks on all transport actions; every native call guarded so unsupported capabilities degrade silently
- [x] Preserved: transcode-fallback chain, error state with download/open-with, Android `collapsable={false}` black-screen guard
- [x] Verified: `tsc --noEmit` ✓ (caught & fixed against installed types: `playingChange` payload is `{isPlaying}`, not `{playing}`)

### Session 10 — "Rendered more hooks" crash investigation (user report): **DONE**
- [x] Built a zero-dependency **AST Rules-of-Hooks checker** (`scripts/check-hooks.cjs`, TypeScript compiler API) detecting hooks-after-early-return and hooks-inside-conditionals/loops
- [x] Ran it over **both trees**: `web/src` and `mobile/src` → **NO VIOLATIONS**; manual per-function audits of MiniPlayer / VideoPlayer / PlaylistScreen / PremiumTabBar / Sidebar confirmed correct ordering (MiniPlayer's cover-art hooks sit above its early return, guarded by an in-code comment)
- [x] **Root cause conclusion:** current code cannot produce this error → stale Metro/transform cache or an intermediate mid-edit bundle on the device. Recovery: `npx expo start -c` (+ reinstall dev client if needed)
- [x] **Permanent guard:** new `lint:hooks` script in web + mobile package.json, wired as CI gates ("Rules of Hooks (AST check)") in the Frontend and mobile Patches jobs so any future violation fails the build before it reaches a device
- [x] Verified: AST checker clean ×2 · yaml valid · both tsc ✓

### Remaining (next sessions)
- [ ] **P4 remainder**: AudioPlayer is now 1036 ln — the fullscreen vinyl/controls JSX could split further (NowPlaying vs transport bar), diminishing returns; nested `<Route>` conversion stays optional (URL state already correct via `navigate()` + parsing)
- [ ] **UX remainder**: R6 full accessibility audit (labels done for player; forms/menus remain), motion polish
- [ ] **Feature backlog**: upload-queue persistence across reload is constrained by browser File-handle lifetime — needs server-side re-pick flow or File System Access handles; documented as deferred

---

## 0. Executive summary

| Area | Verdict |
|---|---|
| Architecture | Sound foundations (Query + Zustand + lazy PDF workspace), but `Workspace.tsx` (1250 ln) is a god-component with fake routing; player stack has 3 real correctness bugs around the shared `<audio>` element / native engine handoff |
| Bugs | 37 catalogued (7 critical, 11 high, rest medium/low) — worst are in the upload concurrency pool, player binding, and transfer progress accounting |
| Security | No XSS sink found (markdown renderer escapes correctly), but **a 365-day bearer token is silently minted into localStorage** on desktop, tokens ride in URLs, private tailnet hostnames are hardcoded in the repo, and Tauri capabilities grant unused arbitrary-exec VLC permissions |
| Desktop | Solid Rust (no injection, minimal unsafe), but: seek-position math bug in native audio, broken reveal-in-file-manager, drag-drop from most folders silently fails, version drift (1.8.0 vs 1.9.0) breaks updater semantics |
| UI/UX | Design system exists and is good (`index.css` tokens + glassmorphism); redesign focuses on consistency (two toast systems, two icon systems for same things), navigation (real routes), feedback (false success toasts, silent failures) |

Execution is split into 6 phases (§6). Each phase ends green: `tsc --noEmit`, `vite build`, existing tests.

---

## 1. Critical security findings (fix first)

### S1 — Silent 365-day token minted into localStorage (desktop) — CRITICAL
- **Where:** `web/src/lib/nativeAudio.ts:110–131`
- **What:** On first native audio playback the app POSTs `/auth/tokens`, creates a personal API token named `desktop-native-audio` valid **365 days**, stores it under `nexora.media-token`. Any XSS = year-long account takeover. Users are never informed.
- **Fix:** Shorten lifetime to ≤30 days; show a one-time settings disclosure ("Desktop media token"); **delete the token on logout** (today only `nexora-token` is cleared in `Workspace.tsx:507–511` and `App.tsx:235–239`); prefer session cookie when available.

### S2 — Auth token appended to every media URL (desktop) — HIGH
- **Where:** `web/src/api/client.ts:106–109`
- **What:** In Tauri mode `getMediaUrl()` appends `?token=…` to thumbnails, artwork, lyrics and streams → leaks into proxy logs, browser history when opened externally, Referer headers.
- **Fix:** Keep query-param transport only where technically unavoidable (native audio bridge already uses headers via IPC); route `<img>`/fetch through cookie-authenticated fetch→blob or keep param but document + shorten token life (S1).

### S3 — `window.open(..., "_blank")` without noopener — HIGH
- `web/src/hooks/useFileOperations.ts:86` (archive download)
- `web/src/components/CommandPalette.tsx:146` (also points at wrong repo URL vs `Sidebar.tsx:269`)
- `web/src/components/SharePage.tsx:149` (blob URL leak — never revoked)
- **Fix:** add `"noopener,noreferrer"` features arg; revoke blob URLs after download; unify repo URL into a constant.

### S8 — Private infrastructure hardcoded in public source — HIGH
- **Where:** `web/src/api/client.ts:7–13` — real tailnet hostname `pms2.tail58d7ea.ts.net` + tailnet IP `100.67.251.1` auto-probed by `discoverServerUrl()`.
- **Fix:** remove hardcoded values; move quick-connect candidates to user-configurable settings (persisted locally per install), defaulting to `localhost:8080` / LAN mDNS-style input only.

### S4 — Markdown renderer soft spots — MEDIUM
- `web/src/lib/markdown.ts:17,26`: protocol-relative `//evil.com/x.png` allowed as link/img target → external tracking beacons inside private docs.
- **Fix:** require href/src to start with `/` but not `//`.

### D — Tauri capabilities overly broad — MEDIUM
- `desktop/src-tauri/capabilities/default.json:39–64`: `shell:allow-execute` grants 4 VLC binaries with `"args": true` (**arbitrary args**) — frontend never uses it. Remove entirely.
- Line 16: unscoped `shell:allow-open` also rejects absolute paths → breaks reveal-in-file-manager (see F-E). Scope it or migrate to `tauri-plugin-opener`.
- `tauri.conf.json:12` `withGlobalTauri: true` — unused by frontend; disable to shrink XSS blast radius.

### C — CSP too loose (desktop) — MEDIUM
- `tauri.conf.json:29–31`: `connect-src http: https:`, `img-src http: https:`, `media-src http: https:`, `frame-src 'self' http: https: blob:` — any origin.
- **Fix:** tighten to documented needs (server URL is dynamic, so keep scheme-wide media/connect but drop `frame-src` remote hosts unless something embeds them; OSM map in PhotoViewer is the only known frame use → allowlist `https://openstreetmap.org`). Add explicit `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.

### I — Misc hardening
- `audio_bridge` accepts arbitrary URL + bearer over IPC (SSRF probe surface) → restrict to configured server origins.
- Bearer forwarded across HTTP redirects (`nexora-audio/http_source.rs:292–302`) → strip Authorization on cross-origin redirect.
- Crash logs to predictable world-readable temp names (`lib.rs:196–205,296–305`) → use random suffix + `0600`.

---

## 2. Bug catalogue (web)

Severity: 🔴 critical · 🟠 high · 🟡 medium · ⚪ low

### Player / media
- 🔴 **B1** `PlayerBar.tsx:97–102` — `engine.bind()` runs once ever (`bound.current`) but the `<audio>` element unmounts/remounts around native playback (`:269–271`) and on StrictMode remounts → after native-fallback, controls/time-sync dead (bound to detached node).
- 🟠 **B3** `PlayerBar.tsx:118–154` — race: track A's late `tryUseNative` resolution calls `stopNative()` while track B already plays (shared singleton mode).
- 🟡 **B9** `store/player.ts:289–292` — `prev()` restart-if->3s checks `engine.audio` which is null in native mode → always skips to previous track.
- 🟡 **B10** `player.ts:278` — shuffle can pick the current index (no exclusion).
- 🟠 **B20** `AudioPlayer.tsx:1145–1163`, `PlayerBar.tsx:243–261` — only `MediaError.code===4` handled; NETWORK(2)/DECODE(3) fail silently.
- 🟡 **B21** `AudioPlayer.tsx:397–448` — subscribes whole store incl. `currentTime`; re-renders ~4×/s and re-subscribes keydown listeners each render. Use `useShallow` like `PlayerBar.tsx:43–59`.
- 🟡 **B19** `AudioPlayer.tsx:191–224` — uncontrolled-mode listeners capture stale `step`/`qIndex` when duplicate URLs appear consecutively.
- ⚪ **B26** `LosslessPlayer/hooks/useAudioContext.ts:31–33` — analyser never re-attaches when element swaps (depends on B1).
- ⚪ **B31** `VideoPlayer.tsx:304–312` — subtitle `f.text()` unguarded; `controlsTimeout` not cleared on unmount (`:61`).

### Transfers / files
- 🔴 **B2** `lib/transfer.ts:561–567 + finally :592–595` — `chunks_missing` path calls `finish(id)` then falls through to `finally` which calls it again → `activeCount` double-decrement → concurrency pool corrupt (unbounded parallel uploads or negative count). Same path also deletes `activeChunked` twice.
- 🟠 **B22** `transfer.ts:553` — `Math.min(MAX_PARALLEL_CHUNKS, totalChunks - next)` is NaN if server omits `totalChunks` → `Array.from({length:NaN})=[]` → completes with zero chunks uploaded.
- 🟡 **B7** `transfer.ts:188–190,529–533` — chunk retry resets `last=0` but prior attempt's bytes remain in `inflight[index]` → progress over-counts.
- ⚪ **B23** `transfer.ts:148–153` — backoff `sleep()` ignores already-aborted signal.
- 🟠 **B24** `transfer.ts:424–457` — browser download buffers entire file in memory (multi-GB → tab OOM). Stream to disk via File System Access API when available, fallback blob.
- 🟠 **B6** `store/transfers.ts:52–53` — "Clear finished" also drops queued/retrying rows that are still alive in the queue; their later updates no-op.
- 🟠 **B16** `TransfersPanel.tsx:177–186` — panel force-reopens on every length change; user cannot keep it closed during multi-file uploads.
- 🟡 **B17** `hooks/useFileOperations.ts:78` — archive SSE uses relative URL (breaks remote-API desktop); result via popup-sensitive `window.open` (S3).
- 🟡 **B18** `useFileOperations.ts:105` — zip extraction refreshes on fixed 1.5 s timer instead of job polling.

### Files / workspace behavior
- 🟠 **B5** `Workspace.tsx:659` — drag onto folder discards the folder argument; generic picker opens instead of moving directly.
- 🟠 **B13** `hooks/useFileOperations.ts:35–43` — bulk delete always toasts success even when items failed; no confirmation; bound to bare Delete key (`useKeyboardShortcuts.ts:79–82`).
- 🟡 **B14/B15** `hooks/useClipboard.ts:59–70,111–112` — cut clipboard cleared even when paste failed; sequential per-file moves leave half-moved state with single toast.
- 🟡 **B34** `Workspace.tsx:537,541` — magic-delay `setTimeout(setPreview(info),50)` races fast clicks.

### App shell / auth
- 🔴 **B4** `src/store.ts:55` — `JSON.parse(localStorage…)` at module load without try/catch → corrupted `nexora.columns` bricks app before React mounts; parsed value not merged with defaults (missing keys → hidden columns).
- 🟠 **B27** `api/client.ts:128–181` + `App.tsx:172–217` — expired session shows "Connection Error/WifiOff" screen instead of returning to Login; no global 401 interception.
- 🟠 **B12** `lib/nativeAudio.ts:133–142` — `validateToken` checks wrong origin in remote-server setups → mints a new 365-day token nearly every track open.
- 🟡 **B11** `text/TextPreview.tsx:188–189` — `Node` component defined inside render → collapse state resets on every parent re-render (O(n²) remounts on big JSON).
- ⚪ **B28** `store.ts:96–100` — toast timers not cancellable, no cap on toast count.
- ⚪ **B29–B37** misc: empty `src=""` on invalid media URL (`client.ts:95–126`), SharePage object-URL revoke race (`SharePage.tsx:121–126`), PreviewModal backdrop closes mid-text-selection (`PreviewModal.tsx:145`), zoom bounds inconsistent (`:163–165` vs `:316`), F5 hijack defeats cached reload (`useKeyboardShortcuts.ts:122–125`), deprecated `navigator.platform` (`:50`), photos infinite-scroll failures swallowed (`PhotosView/hooks.ts:131–132`), placeholder Tamil lyrics shipped (`LyricsPanel.tsx:150`), queue persisted wholesale on every action (`player.ts:264–268`).

---

## 3. Bug catalogue (desktop)

- 🟠 **D-G** `crates/nexora-audio/src/player.rs:245–249` — seek rebase omits `/channels` division → position jumps backward after seek on stereo/multichannel. Related: `TARGET_BUFFERED_FRAMES=44_100` counts samples not frames → stereo prebuffer = 0.5 s not 1 s (`:206`).
- 🟠 **D-E** `web/src/lib/desktop.ts:38–46` — `revealInFileManager` passes absolute paths to shell `open()`; validator rejects non-http/mailto/tel → "Open in folder" silently no-ops.
- 🟠 **D-F** `DesktopDragDrop.tsx:96` — fs scopes limited to Downloads/temp/appdata; drops from Documents/external drives denied and error swallowed with zero feedback.
- 🟡 **D-H** `audio_bridge.rs:22–27,57–59` — sync command does network open + 256 KiB prefetch on main thread → UI stall on slow networks. Make async + spawn_blocking.
- 🟡 **D-A** Version drift: `desktop/package.json:3` and `Cargo.toml:3` = **1.8.0**, but root `VERSION`/`tauri.conf.json`/`web/package.json` = **1.9.0** → tray banner reports old version; updater semantics confused.
- 🟡 **D-B** Updater: Linux auto-install works for AppImage only; deb/rpm users get prompts that cannot install. Detect format, adjust message.
- ⚪ **D-J/K** `Cargo.lock` gitignored (non-reproducible builds); `authors=["you"]`; thiserror v1+v2 dup; reqwest 0.12+0.13 dup; ureq v2 maintenance branch; duplicate JS bindings in both package.jsons.

---

## 4. Code health

**Dead code to delete:** `web/src/lib/subtitles.ts` (unused; duplicate lives in VideoPlayer), `App.tsx:234–239 handleLogout`, `nativeAudio.ts:101–106 onEvent`, `Workspace.tsx:776` `{!videoItem && null}`, `TextEditor.tsx:201–213` computed-then-discarded `parts`, `Login.tsx:18–22` constant-set effect, `player.ts:363–366 currentAudioUrl()`.

**Duplication to consolidate:**
- `isTauri()` implemented ≥5 divergent ways (`desktop.ts:6`, `preview.ts:102`, `client.ts:20/96/148`, `transfer.ts:224/335/622`, inline consts in Audio/VideoPlayer) → single helper in `lib/desktop.ts`.
- Extension lists re-hardcoded in 10+ places despite canonical sets in `packages/core/src/preview.ts:11–17` → import from core.
- Hand-rolled `formatBytes/formatDate` in `VideoView.tsx:29–91`, `TextWorkspace.tsx:537–548` despite clean re-export in `lib/format.ts` → import.
- Two simultaneous toast systems (custom Toaster + sonner) mounted in `App.tsx:24` and `Workspace.tsx:895` → pick one visual system (custom, matches design language) and port stragglers.
- `srtToVtt` duplicated (`subtitles.ts` + `VideoPlayer.tsx:26–38`) → keep one in lib.
- GitHub help links disagree (`CommandPalette.tsx:146` vs `Sidebar.tsx:269`) → single constant.

**Oversized components to decompose:** `Workspace.tsx` (1250), `MediaPlayer/AudioPlayer.tsx` (1199), `PlaylistsPanel.tsx` (793), `FileBrowser.tsx` (772), `AdminPanel.tsx` (687), `lib/transfer.ts` (623).

---

## 5. Feature roadmap (new capabilities, ranked by value/effort)

1. **Retry button for failed uploads** — session is deliberately kept ("so Retry can resume", `transfer.ts:590`) but the UI never offered retry. Wire `TransfersPanel` error rows → resume from last acked chunk. *(small)*
2. **Real routes for views** (`/files/:path`, `/photos`, `/search?q=`, `/playlists/:id`, `/trash`, `/favorites`, `/recents`, `/admin`) replacing `pathname.startsWith` parsing in Workspace — deep-linkable views, browser back/forward correctness, shareable searches. *(medium, enables many UX wins)*
3. **Global 401 → Login redirect + session expiry warning** (fixes B27 properly). *(small)*
4. **Upload queue persistence across reload** — chunked sessions already persist; simple uploads don't. *(medium)*
5. **Streaming downloads with save-as** (File System Access API) + progress (fixes B24). *(medium)*
6. **Undo for trash/delete/rename/move** — server already has restore-from-trash; add client undo toast with 5 s window. *(medium)*
7. **Keyboard-shortcut cheat-sheet polish + contentEditable guard** (fixes known gap). *(small)*
8. **Desktop: drag-drop from anywhere** — widen fs read scope with an "allow full-disk reads?" opt-in prompt, or use Tauri raw-drop + dialog fallback with visible errors (fixes D-F). *(small)*
9. **Desktop tray mini-player controls** (next/prev/play/pause already half-wired via tray events). *(small)*
10. **Media session API integration** (lock-screen metadata/artwork on web) — complements existing global media keys on desktop. *(small)*

---

## 6. UI/UX redesign plan

Design language stays glassmorphism (tokens in `web/src/index.css` are good and stay the source of truth). The redesign is about **consistency, navigation, and feedback**, not a new skin:

### R1 — Navigation & information architecture
- Replace fake routing with real nested routes (§5.2): persistent left rail (Sidebar) + routed content pane; browser back/forward works everywhere; deep links to folders/searches/playlists.
- Unify header pattern: one `ViewHeader` usage per view (already exists) with consistent title/actions/breadcrumb slot.

### R2 — Feedback & trust
- One toast system (custom, themed) with cap (max 4 stacked) and action buttons (Undo/Retry).
- Fix all false-success paths (B13/B14) — destructive ops get ConfirmDialog (exists) or Undo toast.
- TransfersPanel: stop force-reopening (B16); add Retry; clear-finished keeps live rows (B6).

### R3 — Player experience
- Split AudioPlayer overlay into subcomponents (NowPlaying vinyl, Queue, Lyrics) behind a small controller hook; memoize store subscriptions (B21) → eliminates 4 Hz re-render jank.
- Consistent seek/volume slider component (ZoomSlider pattern) reused in PlayerBar/AudioPlayer/VideoPlayer.
- Visible error states for decode/network failures (B20) with automatic transcode fallback messaging.

### R4 — Empty/loading/error states
- Standardize on `EmptyState` + `Skeleton` + `QueryError` primitives everywhere (some views hand-roll); consistent illustration tone.

### R5 — Motion & polish
- Centralize transitions in `lib/animations.ts` (exists) — apply to drawer/modal/view swaps; respect `prefers-reduced-motion` (audit needed).
- MouseGlow stays desktop-only (pointer:fine media query).

### R6 — Accessibility pass
- Focus trap audit (`useFocusTrap` exists) on all modals; roving tabindex already in FileBrowser — extend to grid view actions; aria-labels on icon-only buttons; contrast check of `--content-muted` on glass surfaces.

---

## 7. Execution phases

| Phase | Contents | Risk | Est. size |
|---|---|---|---|
| **P0 Security hardening** | S1 (token lifetime+logout cleanup), S3 (noopener+blob revoke), S8 (de-hardcode tailnet), S4 (`//` proto-relative), D (remove VLC exec capability, disable withGlobalTauri), D-A (version sync 1.8.0→1.9.0) | Low | ~10 files |
| **P1 Critical bugs** | B4 (safe localStorage parse+defaults), B2+B22 (transfer finish/workers), B1 (re-bind audio on element swap), B3 (serialize native handoff), B27 (401→login) | Medium | ~8 files |
| **P2 Player correctness** | B20, B21, B9, B10, B19, B26, B31, D-G (Rust seek math + buffered target) | Medium | player cluster |
| **P3 Transfer/file ops** | B6, B16, B13, B14/B15, B5, B7, B17, B18, B23, B24, Retry feature (§5.1) | Medium | transfer cluster |
| **P4 Routing + code health** | Real routes (§5.2), delete dead code, consolidate isTauri/extensions/formatters/toasts, decompose Workspace.tsx into per-view modules | Higher (large refactor, mechanical) | big |
| **P5 Desktop fixes** | D-E (reveal-in-file-manager), D-F (drag-drop errors+scope), D-H (async open), D-B (updater messaging), CSP tightening, crash-log perms | Low-medium | desktop cluster |
| **P6 UX redesign rollout** | R1–R6 above, feature flags not required (single-user deploy), screenshots before/after | Low per-step | ongoing |

**Verification gate after every phase:** `cd web && npm run lint && npm run build`; `cd desktop && cargo check` (+ `cargo test -p nexora-audio` for P2); backend untouched so `make test` once at end.

---

## 8. Explicitly NOT doing (out of scope / rejected)

- Rewriting the markdown renderer (escape-first model is sound; just patch `//` case).
- Replacing Zustand/React Query stacks.
- Touching `internal/webdav` (dead code per AGENTS.md).
- Mobile app (`mobile/`) — separate effort, own AGENTS.md constraints.
- Changing DB schema / migrations (no backend need surfaced).

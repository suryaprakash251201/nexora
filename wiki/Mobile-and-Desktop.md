# Mobile & Desktop

Nexora's web build (`web/dist`) is the core artifact; desktop wraps it, mobile re-implements against the same `/api`.

| App | Stack | Location | Version |
|-----|-------|----------|---------|
| **Web** | React 19 + Vite + Tailwind 4 + Zustand + React Query | `web/` | `1.8.0` (synced to root `VERSION`) |
| **Desktop** | Tauri 2 + `web/dist` | `desktop/` | `1.8.0` (synced) |
| **Mobile** | Expo 54 / RN 0.81 + TrackPlayer | `mobile/` | `1.0.0` independent (store version) |
| **Shared** | `@nexora/core` pure helpers | `packages/core/` | — |

## Desktop — Tauri 2

### Concept

Tauri 2 hosts the built web UI inside a system webview (WebKit on Linux/macOS, WebView2 on Windows). The Rust backend provides native affordances; the JS layer detects Tauri via `__TAURI_INTERNALS__ in window`.

### Config (`desktop/src-tauri/tauri.conf.json`)

```json
{
  "build": {
    "beforeDevCommand": "npm run dev --prefix ../web",
    "beforeBuildCommand": "npm run build --prefix ../web",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../../web/dist"
  },
  "productName": "Nexora",
  "identifier": "com.nexora.desktop",
  "app": {
    "withGlobalTauri": true,
    "windows": [{ "title":"Nexora","width":1280,"height":860,"minWidth":800,"minHeight":600 }],
    "security": { "csp": "default-src 'self'; img-src ...; media-src ...; connect-src 'self' http: https: tauri:;" }
  },
  "bundle": {
    "targets": ["deb","rpm","appimage","nsis","msi"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.*"]
  },
  "plugins": {
    "updater": {
      "endpoints": ["https://github.com/suryaprakash251201/nexora/releases/latest/download/updater.json"],
      "pubkey": "dW50cnVzdGVkIG..."
    }
  }
}
```

`security.csp` allows `http(s):` media/images plus `blob:` and `tauri:` for connect.

### Rust Backend (`desktop/src-tauri/src/lib.rs`, 270 LOC)

- **Tray:** `Setup` tries `TrayIconBuilder id:"nexora-tray"` (menu `Show Nexora | Play / Pause | Quit`). Left-click → `show_main_window` (show+unminimize+focus). If tray unavailable (e.g. Wayland), logs and close quits instead.
- **Single instance:** `tauri_plugin_single_instance` → second launch shows existing window.
- **Sleep inhibition:** `invoke("set_sleep_inhibition", {inhibit:true})` during active transfers:
  - Linux: `systemd-inhibit --what=idle:sleep … sleep infinity` (stored PID, killed on release via `kill <pid>`)
  - macOS: `caffeinate -dims`
  - Windows: `SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED|ES_DISPLAY_REQUIRED)` / `ES_CONTINUOUS` to release
- **Other:** global media keys (`MediaPlay/Pause/Stop` → `nexora:media`), tray play/pause `emit("nexora:tray-play-pause")`, hide-to-notification via `@tauri-apps/plugin-notification`, `window-state` restore (excluding `VISIBLE`), `get_platform()` (`std::env::consts`), panic hook → `temp/nexora-crash.log`.

Capabilities (`desktop/src-tauri/capabilities/default.json`) scoped to `$APPDATA/$APPCACHE/$RESOURCE/$TEMP/$DOWNLOAD/$HOME/Downloads` for `fs:allow-*` + `shell:allow-open` + `allow-execute` for VLC with `args:true` (VLC invocations are currently unused — `shell.open` is used instead).

### JS Integration (`web/src/lib/desktop.ts` + `web/src/components/TauriShell.tsx`)

`TauriShell.tsx` (headless): restores window-state, `win.show/unminimize/setFocus`, registers global shortcuts, listens for `nexora:tray-play-pause → usePlayer.toggle()`, `nexora:hidden-to-tray → notification`, and `invoke("set_sleep_inhibition", transfers.some(s==='active'))`.

Router: `web/src/router.tsx` picks `createHashRouter` if Tauri (no server fallback for `file://`) else `createBrowserRouter`.

### Develop & Build

```bash
cd desktop && npm run dev     # tauri dev — runs web dev server + launches desktop shell
cd desktop && npm run build   # builds web/dist, then cargo → src-tauri/target/release/bundle
```

Linux build deps: `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libappindicator3-1`, `librsvg2-2`, `libnotify4`, `openssl`. CI builds Linux + Windows.

## Mobile — Expo 54

### Concept

Native React Native app (JS + Expo modules) talking to the same Go `/api`. Bearer token auth (not cookies — `Authorization: Bearer <token>`), media URLs via `Api` wrapper with `http(s):` validation.

### Config (`mobile/app.json`)

```json
{
  "expo": {
    "name":"Nexora","slug":"nexora-mobile","version":"1.0.0","scheme":"nexora",
    "userInterfaceStyle":"automatic",
    "icon":"./assets/icon.png",
    "splash":{"image":"./assets/splash-icon.png","resizeMode":"cover","backgroundColor":"#8B5CF6"},
    "plugins":[
      ["expo-splash-screen", {"image":"...","backgroundColor":"#8B5CF6"}],
      ["expo-video", {"supportsBackgroundPlayback":true}],
      ["expo-build-properties", {"android":{"usesCleartextTraffic":true}}],
      "expo-secure-store"
    ],
    "ios":{"bundleIdentifier":"dev.suryaprakash.nexora","infoPlist":{"NSAppTransportSecurity":{"NSAllowsArbitraryLoads":true}}},
    "android":{"package":"dev.suryaprakash.nexora","predictiveBackGestureEnabled":false}
  }
}
```

`usesCleartextTraffic` + `NSAllowsArbitraryLoads` are required for self-hosted `http://` (LAN/Tailscale self-signed). Scheme `nexora://` for deep links.

### Stack (`mobile/package.json`)

`expo ~54.0.0`, `react 19.1.0`, `react-native 0.81.5`, navigation (`@react-navigation/native 7`, `bottom-tabs`, `native-stack`), media (`expo-video 3`, `expo-image 3`, `react-native-track-player 4.1.2` patched, `expo-linear-gradient/blur/font/haptics`, `react-native-markdown-display`), storage (`@react-native-async-storage/async-storage`, `expo-secure-store 15`), lock `xcode uuid 11.1`, `markdown-it 14.3`.

### Patches — Critical

`mobile/patches/` applied on `postinstall` via `patch-package`:

- `react-native-track-player+4.1.2.patch` — rewrites `= scope.launch {` → `() { scope.launch {` (Kotlin coroutine signature fix for RN 0.81 / Kotlin 2.x). Pinned to `4.1.2`; refresh after any upgrade.
- `image-size+1.2.1.patch` — CVE guard.

CI verifies `npx patch-package --error-on-fail`. See `mobile/AGENTS.md`.

### Shared Core

`mobile/metro.config.js` + `tsconfig.json` alias `@nexora/core` → `../packages/core/src`. Import `formatBytes`, `previewKind`, `cleanTrackTitle`, codec table from there — never duplicate (enforced by review check).

### Navigation (`mobile/App.tsx` — ~250 LOC)

Providers: `SafeAreaProvider > ThemeProvider > SettingsProvider > SessionProvider > AudioProvider > AppErrorBoundary > RootNavigation`.

`RootNavigation`:

- `SessionContext{user, booting, api}` → if `booting` → Splash (`LinearGradient gradients.brandDeep`, 96 px icon); if `!user||!api` → `LoginScreen` **without** `NavigationContainer`.
- If authed: `NavigationContainer` (theme `bg/surface/text/border/accent`) + `StatusBar` (`isDark? light:dark`), `Stack.Navigator` (`headerStyle surface`): `Main(tab)`, `Browser(rootName)`, `Preview(name)`, `Playlist`, `Playlists`, `Category`, `Liked`, `Admin`, `Favorites`, `Trash`.
- `TAB_ROUTES = Set(Home,Search,Recents,Settings)`; `tabVisible` via `navRef.getCurrentRoute()` + `addListener("state")` with `setTimeout 0` after auth flip (fixes mini-player overlap before container mounts).
- `MiniPlayer` above tab bar on tabs, bottom on pushed screens. `AppErrorBoundary` catches uncaught render errors.

`SessionContext` stores `nexora.serverUrl`/`nexora.user` in `AsyncStorage`, **token** in `SecureStore` (or `AsyncStorage` fallback on `web`/Expo Go), migrating legacy tokens on launch.

### Develop

```bash
cd mobile && npm install     # applies patches
npx expo start               # --android / --ios / --web
```

Read versioned docs at `https://docs.expo.dev/versions/v54.0.0/` before writing code — `expo-video` vs legacy `expo-av`, `expo-audio` rename, filesystem changes, etc.

### Build & Distribution

- EAS Build or `npx expo prebuild` (produces native projects).
- `mobile/README.md` + `SIDELOAD.md` cover sideloading (7-day expiry on self-signed), and OTA (`expo-updates` not yet configured).
- Version `1.0.0` independent of `1.8.0` — app-store versioning.

## Website (for completeness)

Static `website/` (no build) — `index.html` (hero + stats + features 9 + gallery 12 + stack 8 + architecture 3 + downloads 6 + deploy tabs + security 6 + FAQ), `docs.html`, `404.html`, `assets/`. Deployed to Cloudflare Pages — see [website/DEPLOY.md](../website/DEPLOY.md).

# Nexora Mobile

React Native (Expo) client for [Nexora](https://github.com/suryaprakash251201/nexora) — a
self-hosted file workspace. Runs on **Android and iOS**.

## Features

- **Connect to any Nexora server** — enter the server URL (LAN IP, Tailscale host, domain) and sign in
- **Session auth** — Bearer token from the login response, persisted securely in the OS keychain via `expo-secure-store` (Keychain on iOS, EncryptedSharedPreferences on Android); TOTP 2FA supported
- **Storage roots** — browse every root you have access to
- **File browser** — folder navigation with breadcrumbs, item counts, pull-to-refresh, infinite scroll
- **Upload** — multi-file upload via the system document picker, with progress bar
- **File operations** — create folders, rename, delete (moves to trash), long-press for quick actions
- **Preview** — images (`expo-image`), video (`expo-video`), audio player, text/code/markdown inline; PDFs and other formats open in your system viewer after a quick download
- **Notification-center audio player** — songs show a native media card in the iOS/Android notification center, lock screen and control center with play · pause · next/previous · seek, artwork from embedded album art, and background playback (continues when the app is backgrounded or the screen is locked)
- **Save to device** — any file can be saved into a real device folder (Android Storage Access Framework, e.g. Downloads — no storage permission needed) or via the iOS share sheet ("Save to Files")
- **Recents & search** — recent files plus full-text search across your library

## Prerequisites

- Node.js 20+
- A running Nexora server (see the repo root `README.md`); the web UI must be set up at least once (initial admin)

## Run it

This app requires a **development build** (`expo-dev-client`) — Expo Go is not supported because
core features depend on native modules (`react-native-track-player`, `expo-secure-store`,
background audio). Expo Go support has been removed.

```bash
cd mobile
npm install
npx expo run:android   # build + install on an Android device/emulator (needs Android Studio)
npx expo run:ios       # build + install on an iOS device/simulator (needs Xcode, macOS)
```

After the first native build, iterate with:

```bash
npm start              # expo start --dev-client; the dev-client app connects to Metro
```

If you change native config (`app.json` plugins/permissions) regenerate the native projects with
`npm run prebuild` (runs `expo prebuild --clean`), then `expo run:*` again.

| Target | How |
|---|---|
| **Android emulator/device** | `npm run android` |
| **iOS simulator/device** | `npm run ios` |
| **JS-only iteration** | `npm start`, then open the installed development build |
| **Release builds** | EAS (`npx eas build`) or `npx expo run:android --variant release` |

## Production builds

```bash
# Android APK/AAB (needs EAS or Android SDK)
npx eas build --platform android --profile preview
npx eas build --platform android --profile production

# iOS (needs Apple Developer account)
npx eas build --platform ios --profile production
```

See [docs.expo.dev/build](https://docs.expo.dev/build) for EAS setup. The app id is
`dev.suryaprakash.nexora` on both platforms.

## Notification-center audio player

Audio playback uses [react-native-track-player](https://rntp.dev) (Apache-2.0) so that every
song you play shows up as a native media card:

- **iOS** — the lock screen / notification center / Control Center now-playing card
  (`MPNowPlayingInfoCenter`), artwork from the file's embedded album art, and the background
  audio mode (`UIBackgroundModes: audio`, already configured via the `expo-video` plugin).
- **Android** — a media notification with the song title, artwork, a draggable seek bar, and
  play/pause/next/previous buttons. Playback runs in a foreground media service and keeps
  playing even if the app is swiped away (`ContinuePlayback`).
- **Controls** — play · pause · **next/previous track buttons** in the notification (following
  the in-app queue and shuffle) · drag-to-seek, plus wired/Bluetooth headset media buttons.
  The whole playlist is loaded into the native media queue, so the next/previous buttons
  appear on both iOS (lock screen / control center) and Android (media notification).
  Repeat-one uses the native track repeat.
- **Where it works** — the mini player, the full-screen player, and the vinyl audio preview all
  share one global player, so any song you play shows the notification card and keeps playing
  in the background. Leaving a preview no longer stops the music.

### Native modules used

`react-native-track-player` and friends are native modules compiled into the app binary. The
development build (`expo-dev-client`) includes them all — that's why audio, background playback,
media notifications and secure token storage work in every installed build.

## Connecting to your server

1. On the login screen, enter your server address — e.g. `http://192.168.1.50:8080`,
   `https://pms2.tailxxxx.ts.net`, or a reverse-proxied domain.
2. The app verifies the server, then prompts for your username and password.
3. If your account has two-factor auth enabled, enter the code from your authenticator app.

**Note:** cleartext HTTP is enabled in the app config (`usesCleartextTraffic` on Android,
`NSAllowsArbitraryLoads` on iOS) because self-hosted LAN servers usually don't have TLS.
Use HTTPS when exposing Nexora beyond your network.

## API surface used

The mobile client talks to the same `/api/v1` endpoints as the web app:

| Endpoint | Purpose |
|---|---|
| `POST /auth/login`, `POST /auth/totp/verify-login` | Session token |
| `GET /auth/needs-setup`, `GET /auth/session` | Setup / session checks |
| `GET /roots`, `GET /files`, `GET /recents`, `GET /search` | Browsing |
| `GET /files/raw`, `GET /files/thumbnail` | Media bytes (token query param) |
| `GET /files/content` | Text/code previews |
| `POST /files/upload` | Multipart upload |
| `POST /files/directory`, `POST /files/rename`, `DELETE /files` | File operations |

Auth is `Authorization: Bearer <token>`; media URLs carry `?token=`, matching the
backend's auth middleware (`internal/auth/middleware.go`).

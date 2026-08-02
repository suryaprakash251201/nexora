# Nexora Mobile

React Native (Expo) client for [Nexora](https://github.com/suryaprakash251201/nexora) — a
self-hosted file workspace. Runs on **Android and iOS**.

## Features

- **Connect to any Nexora server** — enter the server URL (LAN IP, Tailscale host, domain) and sign in
- **Session auth** — Bearer token from the login response, persisted securely with AsyncStorage; TOTP 2FA supported
- **Storage roots** — browse every root you have access to
- **File browser** — folder navigation with breadcrumbs, item counts, pull-to-refresh, infinite scroll
- **Upload** — multi-file upload via the system document picker, with progress bar
- **File operations** — create folders, rename, delete (moves to trash), long-press for quick actions
- **Preview** — images (`expo-image`), video (`expo-video`), audio player, text/code/markdown inline; PDFs and other formats open in your system viewer after a quick download
- **Download & share** — any file downloads to the app cache and opens in the system share sheet
- **Recents & search** — recent files plus full-text search across your library

## Prerequisites

- Node.js 20+
- A running Nexora server (see the repo root `README.md`); the web UI must be set up at least once (initial admin)

## Run it

```bash
cd mobile
npm install
npx expo start
```

Then:

| Target | How |
|---|---|
| **Quick test** | Scan the QR code with **Expo Go** (App Store / Play Store) — works for both Android and iOS |
| **Android emulator** | `npx expo start --android` (needs Android Studio) |
| **iOS simulator** | `npx expo start --ios` (needs Xcode, macOS only) |
| **Device via USB** | `npx expo start --tunnel` and scan from Expo Go |

> Expo Go includes the native modules used here (expo-image, expo-video, expo-sharing,
> expo-document-picker, expo-file-system), so no development build is required for testing.

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

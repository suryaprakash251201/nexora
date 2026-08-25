# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

## Dev builds only — no Expo Go

The app requires a **development build** (`expo-dev-client`); Expo Go is not supported. Core
features (react-native-track-player audio + media notifications, background playback, secure
token storage) need native modules compiled into the binary. `npm start` runs `expo start
--dev-client`; `npm run android` / `npm run ios` build and install the dev client; regenerate
native projects after config changes with `npm run prebuild`.

## Patches

`patch-package` runs on `postinstall` and applies `mobile/patches/`:

- **`react-native-track-player+4.1.2.patch`** — rewrites Kotlin coroutine signatures (`= scope.launch {` → `() { scope.launch {`) to fix compilation against RN 0.81 / Kotlin 2.x. Pinned to `4.1.2`; any upgrade must be verified with `npx patch-package --error-on-fail` and the patch refreshed from upstream. Track https://github.com/doublesymmetry/react-native-track-player/issues for an upstream fix so the patch can be dropped.
- **`image-size+1.2.1.patch`** — CVE guard for `image-size`.

CI verifies patches apply (`npx patch-package --error-on-fail` in `patches` job).

## Shared code

Pure helpers (`formatBytes`, `previewKind`, `cleanTrackTitle`, transcode codec table) live in `packages/core` (`@nexora/core`). Import from there instead of duplicating in `mobile/` — `mobile/metro.config.js` and `tsconfig.json` already alias `@nexora/core` to `../packages/core/src`.

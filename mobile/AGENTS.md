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
- **`image-size+1.2.1.patch`** — CVE guards for `image-size`, which reaches us transitively through `metro` (the RN bundler reads the dimensions of bundled assets). Two parsers loop forever on a crafted box with a zero size field: ICNS (`imageOffset += imageHeader[1]`, CVE-2025-71330 / GHSA-w3rx-r6r6-pgpr) and JXL (`offset = jxlpBox.offset + jxlpBox.size` in `extractPartialStreams`, GHSA-5p2g-fcmc-qvqq). Both are DoS-only and build-time, but they still wedge a bundler/CI run, so they are patched in place. **Do not bump `image-size` to 2.x**: `metro` calls its default export with the asset *source string* for SVGs and 2.0.3+ rejects non-buffer input (`The "list" argument must be an instance of ...`), which breaks `expo export` outright. Upstream has no 1.x fix, so keep the patch and regenerate it with `node scripts/gen-image-size-patch.cjs <extracted-image-size-1.2.1>` if the vendored files ever change. `npm run check:cve` feeds crafted ICNS/JXL/HEIF buffers through the parsers with a hard timeout and fails if any of them can still hang.

CI verifies patches apply (`npx patch-package --error-on-fail` in `patches` job) and that the CVE guards still hold (`npm run check:cve`).

## Shared code

Pure helpers (`formatBytes`, `previewKind`, `cleanTrackTitle`, transcode codec table) live in `packages/core` (`@nexora/core`). Import from there instead of duplicating in `mobile/` — `mobile/metro.config.js` and `tsconfig.json` already alias `@nexora/core` to `../packages/core/src`.

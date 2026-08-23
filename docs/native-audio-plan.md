# Native Audio Engine — Tauri Desktop (Windows first)

Status tracker for the Rust-native playback engine (plan approved; executing
milestone-by-milestone on `main`).

## Goal
`.m4a` (AAC + ALAC) and other audio in the desktop app plays with native feel:
instant start/seek, zero server CPU, no transcode buffering.

## Architecture
WebView UI → player-store EngineRouter → `web/src/lib/nativeAudio.ts`
(Tauri IPC) → `nexora-audio` Rust crate:
`HttpRangeReader` (HTTP-Range Read+Seek, chunk LRU) → symphonia
(mp4/alac/aac/flac/pcm/mp3) → rodio/cpal/WASAPI.
Events: `audio://event` {ready|playing|paused|ended|error}; position polled.

## Milestones
| # | Scope | Exit criteria | Status |
|---|---|---|---|
| M1 | HttpRangeReader + mock-server tests | 11 tests green | ✅ done |
| M2 | symphonia decode_all/TrackDecoder + fixtures (AAC/ALAC faststart+moov-end/FLAC/MP3) via Cursor **and** HTTP-Range streaming; wav_dump harness | 5 tests green | ✅ done |
| M3 | PlayerHandle state machine (NullSink-testable) + Tauri commands/events bridge (`native-audio` feature) + frontend probe module | cargo tests green; headless check passes; Windows build enables feature | ✅ code complete — Windows soak pending |
| M4 | Player-store engine router + selection/fallback + settings kill-switch | A/B live switch; fallback parity | ✅ code complete — Windows soak pending |
| M5 | Perf tuning, seek latency, docs, default-on | gates: open<300ms seek<200ms CPU<5% | ⬜ |

## Notes / constraints
- rodio/cpal requires ALSA headers on Linux dev boxes
  (`libasound2-dev`, `pkg-config`); Windows needs nothing extra. The
  `output` feature is therefore opt-in.
- Auth bridging uses bearer tokens (`nxr_` API tokens) passed to
  `audio_native_open`; session-cookie jar is not shared with reqwest/ureq.
- Fallback rule: any unsupported codec/engine error falls back to the
  existing HTML5/transcode path — never worse than v1.9 behavior.

import { NativeModules, Platform } from "react-native";

type TrackPlayerBundle = typeof import("react-native-track-player");

/**
 * Safe access point for react-native-track-player.
 *
 * The library's JS entry reads `NativeModules.TrackPlayerModule` at import
 * time, and on runtimes without the native module (web) that read throws the
 * infamous "Your JavaScript code tried to access a native module that doesn't
 * exist" invariant — killing the whole bundle before React mounts. Consumers
 * therefore never import the package statically: they call `getTrackPlayer()`
 * (lazy require, cached) and treat null as "audio disabled".
 *
 * Native builds always have the module compiled in — this guard exists only
 * so the same bundle keeps working if it is ever loaded outside the app.
 */

let cached: TrackPlayerBundle | null | undefined;

/**
 * Lazily requires react-native-track-player. Returns null instead of
 * crashing when the native module is absent (web). The require is only
 * attempted after a guarded probe of `NativeModules`, and any throw is
 * swallowed — worst case, audio playback is disabled.
 */
export function getTrackPlayer(): TrackPlayerBundle | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS === "web") return cached;
  try {
    if (!(NativeModules as Record<string, unknown>).TrackPlayerModule) {
      return cached;
    }
    cached = require("react-native-track-player") as TrackPlayerBundle;
  } catch {
    cached = null;
  }
  return cached;
}

/** True when the native media-session module exists (native builds). */
export function trackPlayerNativeAvailable(): boolean {
  return getTrackPlayer() != null;
}

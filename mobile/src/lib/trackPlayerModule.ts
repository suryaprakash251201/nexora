import { NativeModules, Platform } from "react-native";

type TrackPlayerBundle = typeof import("react-native-track-player");

/**
 * Safe access point for react-native-track-player.
 *
 * The library's JS entry reads `NativeModules.TrackPlayerModule` at import
 * time, and in runtimes where the native module isn't compiled in (Expo Go)
 * that read throws the infamous
 * "Your JavaScript code tried to access a native module that doesn't exist"
 * invariant — killing the whole bundle before React mounts. Consumers
 * therefore never import the package statically: they call `getTrackPlayer()`
 * (lazy require, cached) and treat null as "audio disabled".
 */

let cached: TrackPlayerBundle | null | undefined;

/**
 * Lazily requires react-native-track-player. Returns null instead of
 * crashing when the native module is absent (web, Expo Go). The require is
 * only attempted after a guarded probe of `NativeModules`, and any throw is
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

/** True when the native media-session module exists (dev/prod builds only). */
export function trackPlayerNativeAvailable(): boolean {
  return getTrackPlayer() != null;
}

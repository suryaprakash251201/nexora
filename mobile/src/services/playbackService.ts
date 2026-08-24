import {
  getTrackPlayer,
  trackPlayerNativeAvailable,
} from "../lib/trackPlayerModule";
import { trackPlayerController } from "../lib/trackPlayerController";

/**
 * react-native-track-player playback service.
 *
 * Registered once at app startup (`index.ts` → `setupPlaybackService`, which
 * skips registration entirely when the native module is absent — Expo Go /
 * web). While the app is running this runs in the same JS context; if the
 * user swipes the app away the service keeps running as a headless task so
 * the notification card keeps working.
 *
 * Remote events come from the native media session — the notification center /
 * lock screen / control center / wired & bluetooth headset buttons:
 *
 *   • play / pause / stop / seek / ±15s jump  → applied straight to TrackPlayer
 *   • next / previous                        → routed through the controller to
 *     the app's own queue + shuffle logic (registered by AudioContext), so the
 *     notification buttons behave exactly like the in-app buttons.
 */

/** Registers the headless playback service — native builds only. */
export function setupPlaybackService() {
  if (!trackPlayerNativeAvailable()) return;
  getTrackPlayer()?.default.registerPlaybackService(() => PlaybackService);
}

export const PlaybackService = async function () {
  const rntp = getTrackPlayer();
  if (!rntp) return;
  const TrackPlayer = rntp.default;
  const { Event } = rntp;

  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    TrackPlayer.reset();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    trackPlayerController.remoteHandlers.next?.();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    trackPlayerController.remoteHandlers.previous?.();
  });

  TrackPlayer.addEventListener(
    Event.RemoteSeek,
    ({ position }: { position: number }) => {
      TrackPlayer.seekTo(position);
    }
  );

  TrackPlayer.addEventListener(
    Event.RemoteJumpForward,
    ({ interval }: { interval: number }) => {
      TrackPlayer.seekBy(interval);
    }
  );

  TrackPlayer.addEventListener(
    Event.RemoteJumpBackward,
    ({ interval }: { interval: number }) => {
      TrackPlayer.seekBy(-interval);
    }
  );

  // Audio focus interruptions (phone call etc.). autoHandleInterruptions in
  // setupPlayer already pauses/resumes for most cases; RemoteDuck covers the
  // Android "duck" case where the audio should pause until the interruption ends.
  TrackPlayer.addEventListener(
    Event.RemoteDuck,
    async ({ paused }: { paused: boolean }) => {
      if (paused) TrackPlayer.pause();
      else TrackPlayer.play();
    }
  );
};

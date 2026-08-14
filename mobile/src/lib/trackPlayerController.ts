import { NativeModules, Platform } from "react-native";
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode,
  State,
} from "react-native-track-player";

/**
 * TrackPlayer-backed media controller.
 *
 * The app UI (MiniPlayer, fullscreen player, vinyl preview, screens) talks to a
 * small synchronous "player" surface: `status`, `playing`, `currentTime`,
 * `duration`, `loop`, `play()`, `pause()`, `seekBy()`, `currentTime = …` and
 * `addListener(...)`. This class provides exactly that surface, but the actual
 * audio runs on react-native-track-player — which registers a native
 * **MediaSession (Android) / Now Playing (iOS)** so every song shows up in the
 * notification center / lock screen / control center with play, pause,
 * next/previous (forward/backward) and seek controls, and keeps playing in
 * the background. The whole playlist is loaded into the native queue so the
 * media session exposes the next/previous buttons on both platforms.
 *
 * The class keeps synchronous mirrors of the native state (updated by events +
 * a 500ms progress poll) so the UI can keep reading plain properties without
 * awaiting promises on every frame.
 */

export type ControllerEvent =
  | "playingChange"
  | "statusChange"
  | "timeUpdate"
  | "ended"
  | "activeTrackChanged";

type ActiveTrackPayload = {
  track: { id: string } | null;
  index: number;
};

type Handler = (payload?: any) => void;

const EXPOV_LOADING = "loading";
const EXPOV_READY = "readyToPlay";
const EXPOV_ERROR = "error";
const EXPOV_IDLE = "idle";

export class TrackPlayerController {
  // ── Synchronous mirrors of the native player state ─────────────────
  /** expo-video vocabulary so existing UI code keeps working: idle | loading | readyToPlay | error */
  status: string = EXPOV_IDLE;
  playing: boolean = false;
  private _currentTime: number = 0;
  duration: number = 0;
  buffered: number = 0;
  /** Index of the currently active track in the native queue (-1 = none). */
  currentIndex: number = -1;

  /** Repeat-one (loop). UI writes `player.loop = true/false`. */
  private _loop = false;

  /**
   * Registered by AudioContext so the notification's next/previous buttons
   * follow the app's own queue + shuffle logic instead of TrackPlayer's queue.
   */
  remoteHandlers: { next?: () => void; previous?: () => void } = {};

  private initialized = false;
  private listeners = new Set<{ event: ControllerEvent; handler: Handler }>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private trackId: string | null = null;
  private disposed: Array<() => void> = [];

  /** Web has no native media session — all calls become no-ops. */
  private get isWeb() {
    return Platform.OS === "web";
  }

  /**
   * react-native-track-player ships native code, so it only exists inside a
   * development/production build. Inside Expo Go the native module is absent
   * (there is no media notification there either) — degrade to no-ops instead
   * of crashing on `setupPlayer`.
   */
  private get nativeAvailable() {
    if (this.isWeb) return false;
    return !!(NativeModules as any).TrackPlayerModule;
  }

  private warnedMissingNative = false;
  private warnMissingNative() {
    if (this.warnedMissingNative) return;
    this.warnedMissingNative = true;
    console.warn(
      "[trackPlayerController] react-native-track-player native module not found — " +
        "notification-center playback requires a development build (Expo Go is not supported). " +
        "Audio playback is disabled."
    );
  }

  private emit(event: ControllerEvent, payload?: any) {
    this.listeners.forEach((l) => {
      if (l.event === event) {
        try {
          l.handler(payload);
        } catch (e) {
          console.warn("[trackPlayerController] listener error", e);
        }
      }
    });
  }

  /** Subscribes to controller events; returns the same { remove() } shape expo-video subscriptions use. */
  addListener(event: ControllerEvent, handler: Handler) {
    const l = { event, handler };
    this.listeners.add(l);
    return { remove: () => this.listeners.delete(l) };
  }

  async ensureInit() {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.nativeAvailable) {
      this.warnMissingNative();
      return;
    }

    await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
    await TrackPlayer.updateOptions({
      // The notification / lock-screen control set. Next/previous are the
      // forward/backward buttons; seek shows the draggable progress bar in the
      // Android notification and the iOS control-center scrubber. The ±15s
      // jump capabilities are intentionally NOT enabled — they would replace
      // the next/previous buttons in the iOS lock screen.
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      // Collapsed notification (iOS lock screen / Android collapsed card).
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      android: {
        // Keep the notification + playback alive even if the user swipes the
        // app away — a proper music-player notification card.
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
      },
    });

    const subState = TrackPlayer.addEventListener(
      Event.PlaybackState,
      ({ state }: { state: State }) => {
        const status = this.stateToStatus(state);
        this.status = status;
        this.emit("statusChange", { status });
        const isPlaying =
          state === State.Playing || state === State.Buffering;
        if (isPlaying !== this.playing) {
          this.playing = isPlaying;
          this.emit("playingChange", { isPlaying });
        }
      }
    );

    const subTrack = TrackPlayer.addEventListener(
      Event.PlaybackActiveTrackChanged,
      ({
        track,
        index,
      }: {
        track?: { id?: string; duration?: number } | null;
        index?: number;
      }) => {
        if (track && track.id) this.trackId = track.id;
        this.currentIndex = typeof index === "number" ? index : -1;
        this._currentTime = 0;
        this.duration = typeof track?.duration === "number" ? track.duration : 0;
        this.emit("activeTrackChanged", {
          track: track && track.id ? { id: track.id } : null,
          index: this.currentIndex,
        } as ActiveTrackPayload);
        this.emit("timeUpdate", { currentTime: this._currentTime });
      }
    );

    // Natural end of the (single-track) queue — the app advances to the next
    // song via its own queue/shuffle logic.
    const subEnded = TrackPlayer.addEventListener(
      Event.PlaybackQueueEnded,
      () => {
        this.emit("ended");
      }
    );

    this.disposed.push(() => subState.remove());
    this.disposed.push(() => subTrack.remove());
    this.disposed.push(() => subEnded.remove());

    // Keep the sync mirrors fresh (also drives consumers that poll).
    this.pollTimer = setInterval(() => this.poll(), 500);
  }

  private stateToStatus(state: State): string {
    switch (state) {
      case State.Loading:
      case State.Buffering:
        return EXPOV_LOADING;
      case State.Ready:
      case State.Playing:
      case State.Paused:
      case State.Ended:
        return EXPOV_READY;
      case State.Error:
        return EXPOV_ERROR;
      case State.None:
      case State.Stopped:
      default:
        return EXPOV_IDLE;
    }
  }

  private async poll() {
    if (this.isWeb) return;
    try {
      const p = await TrackPlayer.getProgress();
      if (
        p.position !== this._currentTime ||
        p.duration !== this.duration ||
        p.buffered !== this.buffered
      ) {
        // Write the mirror directly — NEVER via the `currentTime` setter
        // (the setter seeks the native player; using it here would make the
        // player chase its own position every poll).
        this._currentTime = p.position;
        this.duration = p.duration;
        this.buffered = p.buffered;
        this.emit("timeUpdate", { currentTime: this._currentTime });
      }
    } catch {
      /* player not ready yet */
    }
  }

  // ── Playback API (same surface the UI already uses) ────────────────
  play() {
    if (!this.nativeAvailable) return;
    TrackPlayer.play().catch(() => {});
  }

  pause() {
    if (!this.nativeAvailable) return;
    TrackPlayer.pause().catch(() => {});
  }

  seekBy(seconds: number) {
    if (!this.nativeAvailable) return;
    TrackPlayer.seekBy(seconds).catch(() => {});
    this.currentTime = Math.max(0, this.currentTime + seconds);
  }

  get loop() {
    return this._loop;
  }

  set loop(value: boolean) {
    this._loop = value;
    if (!this.nativeAvailable) return;
    TrackPlayer.setRepeatMode(value ? RepeatMode.Track : RepeatMode.Off).catch(
      () => {}
    );
  }

  get currentTime() {
    return this._currentTime;
  }

  /** Seeking (write) — mirrors to the native player. */
  set currentTime(value: number) {
    const t = Math.max(0, value);
    this._currentTime = t;
    if (!this.nativeAvailable) return;
    TrackPlayer.seekTo(t).catch(() => {});
  }

  /** Stops playback and clears the queue + notification card. */
  reset() {
    if (!this.nativeAvailable) return;
    TrackPlayer.reset().catch(() => {});
    this._currentTime = 0;
    this.duration = 0;
    this.currentIndex = -1;
    this.trackId = null;
    if (this.playing) {
      this.playing = false;
      this.emit("playingChange", { isPlaying: false });
    }
    if (this.status !== EXPOV_IDLE) {
      this.status = EXPOV_IDLE;
      this.emit("statusChange", { status: EXPOV_IDLE });
    }
    this.emit("timeUpdate", { currentTime: 0 });
  }

  /**
   * Replaces the whole native queue with `tracks` (in order). The app keeps
   * its own queue/shuffle logic, but the native session needs the full queue
   * so the notification shows the next/previous buttons (Android derives them
   * from the queue, iOS from the enabled capabilities).
   */
  async replaceQueue(
    tracks: Array<{
      id: string;
      url: string;
      title: string;
      artist?: string;
      artwork?: string;
    }>
  ) {
    if (!this.nativeAvailable) {
      this.warnMissingNative();
      return;
    }
    await this.ensureInit();
    try {
      await TrackPlayer.reset();
      await TrackPlayer.add(tracks);
      this.currentIndex = -1;
      this.trackId = null;
      this._currentTime = 0;
      this.duration = 0;
      this.status = EXPOV_LOADING;
      this.emit("statusChange", { status: EXPOV_LOADING });
      this.emit("timeUpdate", { currentTime: 0 });
    } catch (e) {
      console.error("[trackPlayerController] replaceQueue failed", e);
      this.status = EXPOV_ERROR;
      this.emit("statusChange", { status: EXPOV_ERROR });
    }
  }

  /**
   * Jumps the native queue to `index` and optionally starts playback. Also
   * resets the timeline mirrors so the UI immediately reflects the new track.
   */
  async skipToIndex(index: number, autoplay: boolean) {
    if (!this.nativeAvailable) return;
    try {
      await TrackPlayer.skip(index);
      this.currentIndex = index;
      this._currentTime = 0;
      this.duration = 0;
      this.status = EXPOV_LOADING;
      this.emit("statusChange", { status: EXPOV_LOADING });
      this.emit("timeUpdate", { currentTime: 0 });
      if (autoplay) await TrackPlayer.play();
    } catch (e) {
      console.error("[trackPlayerController] skipToIndex failed", e);
    }
  }

  /** Marks the controller as closed (logout etc.) — releases native resources. */
  teardown() {
    if (!this.nativeAvailable) return;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.disposed.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
    this.disposed = [];
  }
}

// Module-level singleton: the playback service (a separate JS context when the
// app is killed) and the app UI share this same instance while the app runs.
export const trackPlayerController = new TrackPlayerController();

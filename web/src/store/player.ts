import { create } from "zustand";
import type { FileItem } from "../api/types";
import { isTauriRuntime, rawUrl } from "../lib/preview";
import {
  nativeAudio,
  nativeAudioAvailable,
  openTrack as nativeOpenTrack,
  stopTrack as nativeStopTrack,
} from "../lib/nativeAudio";

/** Extensions symphonia decodes natively in our build configuration. */
const NATIVE_EXTS = new Set(["m4a", "m4b", "aac", "mp3", "flac", "wav", "aiff", "alac"]);

export type Repeat = "off" | "all" | "one";

interface PlayerState {
  queue: FileItem[];
  index: number;
  isPlaying: boolean;
  /** True while the engine is waiting for more data (network stall / ffmpeg start). */
  buffering: boolean;
  shuffle: boolean;
  repeat: Repeat;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  muted: boolean;
  primaryOpen: boolean;
  /** User-facing message when the current track failed to play in every
   *  available format (codec + transcode fallbacks exhausted). */
  audioError: string;
  play: (queue: FileItem[], index?: number) => void;
  toggle: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  setIndex: (i: number) => void;
  removeFromQueue: (i: number) => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  setPlaybackRate: (r: number) => void;
  toggleMute: () => void;
  setPrimaryOpen: (b: boolean) => void;
  setAudioError: (msg: string) => void;
  setShuffle: (s: boolean) => void;
  cycleRepeat: () => void;
  current: () => FileItem | null;
  _syncTime: (c: number, d: number) => void;
}

const LS_KEY = "nexora.player";

interface Persist {
  queue: FileItem[];
  index: number;
  volume: number;
  shuffle: boolean;
  repeat: Repeat;
  playbackRate: number;
}

function loadPersist(): Persist {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Persist;
  } catch { /* ignore */ }
  return { queue: [], index: -1, volume: 1, shuffle: false, repeat: "off", playbackRate: 1 };
}

function savePersist(p: Persist) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

// Debounced persistence: rapid actions (volume drags, rate changes) would
// otherwise serialize the entire queue on every step. 400ms coalesces them;
// the last state still lands because the timer flushes after activity stops.
let persistTimer: number | null = null;
function persist(immediate = false) {
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  const write = () => {
    persistTimer = null;
    const s = usePlayer.getState();
    savePersist({ queue: s.queue, index: s.index, volume: s.volume, shuffle: s.shuffle, repeat: s.repeat, playbackRate: s.playbackRate });
  };
  if (immediate) write();
  else persistTimer = window.setTimeout(write, 400);
}

// PlayerEngine owns the single <audio> element so playback survives navigation.

/** Grace period (ms) after which an unconfirmed seek is considered stalled:
 *  fast LAN seeks confirm in <100 ms, so a stale position after this long
 *  means the decode thread is parked in a blocking symphonia seek or dead. */
export const SEEK_STALL_GRACE_MS = 800;

/** True when the backend hasn't confirmed a seek and the grace period
 *  elapsed → the UI should re-open the track at the target so playback can
 *  never stay frozen on a silent tail. */
export function nativeSeekStalled(
  pos: number,
  target: number,
  elapsedMs: number,
): boolean {
  return pos + 0.75 < target && elapsedMs > SEEK_STALL_GRACE_MS;
}

class PlayerEngine {
  audio: HTMLAudioElement | null = null;
  /** Active backend. 'native' routes transport to the Tauri audio engine;
   *  'html5' is the classic <audio> (+transcode) pipeline. */
  mode: "html5" | "native" = "html5";
  /** Displayed-time offset for transcoded streams: the server fast-seeks via
   *  ?start= (which resets stream timestamps to 0), so we add the seek target
   *  back on top of the element's currentTime for correct UI time. */
  timeOffset = 0;
  /** Registered by PlayerBar: called when a seek targets a transcoded stream
   *  so the URL can be rebuilt with a ?start= parameter. */
  onTranscodeSeek: ((t: number) => void) | null = null;
  private pollTimer: number | null = null;
  private nativeDuration = 0;
  /** Last native seek target + timestamp: polls that return a stale
   *  pre-seek position while the decode thread is still seeking (blocking
   *  HTTP range fetches) must not clobber the optimistic UI. */
  private lastSeekTarget: number | null = null;
  private lastSeekAt = 0;
  /** True while a seek-recovery reopen is in flight (one at a time). */
  private seekRecovering = false;

  bind(el: HTMLAudioElement) {
    // Idempotent per element: the <audio> node can be recreated around native
    // playback or StrictMode remounts, and re-binding must never stack
    // duplicate event listeners on the same node.
    if (this.audio === el) return;
    this.audio = el;
    el.volume = usePlayer.getState().volume;
    el.playbackRate = usePlayer.getState().playbackRate;
    el.addEventListener("play", () => usePlayer.setState({ isPlaying: true, buffering: false }));
    el.addEventListener("pause", () => usePlayer.setState({ isPlaying: false, buffering: false }));
    el.addEventListener("waiting", () => usePlayer.setState({ buffering: true }));
    el.addEventListener("stalled", () => usePlayer.setState({ buffering: true }));
    el.addEventListener("playing", () => usePlayer.setState({ buffering: false }));
    el.addEventListener("canplay", () => usePlayer.setState({ buffering: false }));
    const sync = () => usePlayer.getState()._syncTime(el.currentTime + this.timeOffset, el.duration);
    el.addEventListener("timeupdate", sync);
    el.addEventListener("loadedmetadata", sync);
    el.addEventListener("ended", () => usePlayer.getState().next(true));
  }

  /** Called when the bound <audio> element leaves the DOM. */
  detach(el: HTMLAudioElement | null) {
    if (el && this.audio === el) this.audio = null;
  }

  /** Monotonic token for native-handoff attempts so stale resolutions lose. */
  private nativeSeq = 0;

  /**
   * Attempts to hand the track to the native engine. Returns true when it
   * took ownership; false → caller uses the html5/transcode path.
   *
   * Serialized by sequence token: if a newer attempt started while this one
   * awaited, this result is discarded and any session it opened is stopped,
   * so a slow open can never kill the newer track's playback.
   */
  async tryUseNative(item: FileItem): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    if (localStorage.getItem("nexora.nativeAudio") === "0") return false;
    if (!(await nativeAudioAvailable())) return false;
    const ext = (item.extension || "").toLowerCase();
    if (!NATIVE_EXTS.has(ext)) return false;

    const seq = ++this.nativeSeq;

    // Stop any previous native session before deciding.
    await nativeStopTrack();
    this.stopPolling();

    const info = await nativeOpenTrack(rawUrl(item.root_id, item.path), {
      onEvent: (e) => this.onNativeEvent(e),
    });
    if (seq !== this.nativeSeq) {
      // A newer track-change attempt superseded this one mid-flight.
      if (info) void nativeStopTrack();
      return false;
    }
    if (!info) return false;

    this.mode = "native";
    this.nativeDuration = info.duration_sec ?? 0;
    this.lastSeekTarget = null;
    this.lastSeekAt = 0;
    this.seekRecovering = false;
    const s = usePlayer.getState();
    void nativeAudio.setVolume(s.muted ? 0 : s.volume);
    if (s.playbackRate !== 1) void nativeAudio.setSpeed(s.playbackRate);
    this.startPolling();
    usePlayer.setState({
      isPlaying: true,
      buffering: false,
      duration: info.duration_sec ?? 0,
      currentTime: 0,
    });
    return true;
  }

  /** Patches the native duration once ffprobe metadata arrives (MP3/VBR
   *  tracks report no n_frames, so symphonia yields duration null → the
   *  timeline would render max=0 and every seek would be degenerate). */
  setNativeDuration(d: number) {
    if (!Number.isFinite(d) || d <= 0) return;
    this.nativeDuration = d;
    if (this.mode === "native") {
      const s = usePlayer.getState();
      if (!s.duration || s.duration <= 0) usePlayer.setState({ duration: d });
    }
  }

  /**
   * Recovers a stalled seek by re-opening the track AT the target. A seek
   * that is never confirmed (blocking symphonia seek, hung HTTP range
   * fetch, dead decode thread) leaves the timeline frozen on silence — the
   * reopen replaces the engine with a fresh session positioned at the
   * target. The OLD session keeps playing until the new one is ready, so
   * audio never gaps during the recovery; on Windows this also sidesteps
   * WASAPI wedges by landing on a fresh Sink.
   */
  private async recoverNativeSeek(target: number): Promise<void> {
    const item = usePlayer.getState().current();
    if (!item) {
      this.seekRecovering = false;
      return;
    }
    const paused = !usePlayer.getState().isPlaying;
    const seq = ++this.nativeSeq;
    const info = await nativeOpenTrack(rawUrl(item.root_id, item.path), {
      onEvent: (e) => this.onNativeEvent(e),
    }, { startSec: Math.max(0, target) });
    // A newer seek may have landed while the reopen was in flight; capture
    // it BEFORE clearing so the fresh session can be re-aimed at it.
    const pendingTarget = this.lastSeekTarget;
    if (seq !== this.nativeSeq) {
      // A newer track-change superseded this recovery mid-flight.
      if (info) void nativeStopTrack();
      this.seekRecovering = false;
      return;
    }
    if (!info) {
      // Reopen failed → the html5 pipeline takes over (it seeks via the
      // <audio> element, which handles slow streams itself).
      this.seekRecovering = false;
      this.fallbackToHtml5("Native seek stalled and the track could not be reopened — switching to browser player");
      return;
    }
    this.seekRecovering = false;
    this.mode = "native";
    this.nativeDuration = info.duration_sec ?? 0;
    const st = usePlayer.getState();
    if (!st.duration || st.duration <= 0) {
      usePlayer.setState({ duration: this.nativeDuration || st.duration });
    }
    this.lastSeekTarget = null;
    this.lastSeekAt = 0;
    usePlayer.setState({ currentTime: target, buffering: false, isPlaying: !paused });
    void nativeAudio.setVolume(st.muted ? 0 : st.volume);
    if (st.playbackRate !== 1) void nativeAudio.setSpeed(st.playbackRate);
    if (paused) void nativeAudio.pause();
    if (pendingTarget !== null && pendingTarget !== target) {
      this.seek(pendingTarget);
    }
  }

  /** Native engine hit an unrecoverable error → drop back to html5. */
  fallbackToHtml5(msg?: string) {
    if (this.mode !== "native") return;
    this.mode = "html5";
    this.stopPolling();
    this.seekRecovering = false;
    void nativeStopTrack();
    if (msg) usePlayer.getState().setAudioError(msg);
    window.dispatchEvent(new CustomEvent("nexora:native-fallback"));
  }

  stopNative() {
    this.mode = "html5";
    this.stopPolling();
    this.seekRecovering = false;
    void nativeStopTrack();
  }

  private onNativeEvent(e: { kind: string; message?: string }) {
    switch (e.kind) {
      case "playing":
        usePlayer.setState({ isPlaying: true, buffering: false });
        break;
      case "paused":
        usePlayer.setState({ isPlaying: false, buffering: false });
        break;
      case "ended":
        usePlayer.setState({ isPlaying: false });
        usePlayer.getState().next(true);
        break;
      case "error":
        this.fallbackToHtml5(
          e.message
            ? `Native playback failed (${e.message}) — switching to browser player`
            : "Native playback failed — switching to browser player",
        );
        break;
      default:
        break;
    }
  }

  private startPolling() {
    if (this.pollTimer !== null) return;
    this.pollTimer = window.setInterval(async () => {
      if (this.mode !== "native") return;
      let pos: number;
      try {
        pos = await nativeAudio.position();
      } catch {
        return; // no session yet / track switching — keep current UI time
      }
      if (!Number.isFinite(pos) || pos < 0) return;
      const elapsed = Date.now() - this.lastSeekAt;
      if (this.lastSeekTarget !== null && pos + 0.75 < this.lastSeekTarget) {
        // A seek was issued and the backend hasn't caught up yet (decode
        // thread blocked in HTTP range fetches): keep the optimistic target
        // instead of snapping the thumb backwards. If it stays stale past
        // the grace period the seek is stalled — re-open the track AT the
        // target so playback can never stay frozen on a silent tail (the
        // old session keeps playing until the reopen is ready).
        if (
          !this.seekRecovering &&
          nativeSeekStalled(pos, this.lastSeekTarget, elapsed)
        ) {
          this.seekRecovering = true;
          const target = this.lastSeekTarget;
          void this.recoverNativeSeek(target);
        }
        return;
      }
      this.lastSeekTarget = null;
      const st = usePlayer.getState();
      usePlayer.setState({ buffering: false });
      st._syncTime(pos, this.nativeDuration || st.duration);
    }, 250);
  }
  private stopPolling() {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  play() {
    if (this.mode === "native") return void nativeAudio.play();
    this.audio?.play().catch(() => {});
  }
  pause() {
    if (this.mode === "native") return void nativeAudio.pause();
    this.audio?.pause();
  }
  toggle() {
    if (this.mode === "native") {
      usePlayer.getState().isPlaying ? this.pause() : this.play();
      return;
    }
    if (this.audio?.paused) this.play();
    else this.pause();
  }
  seek(t: number) {
    if (this.mode === "native") {
      if (!Number.isFinite(t)) return;
      const st = usePlayer.getState();
      const dur = this.nativeDuration || st.duration;
      let target = Math.max(0, t);
      // Clamp into the known track bounds: seeking past EOS lands the
      // container at end-of-stream, the decode thread reports Ended and the
      // UI freezes on a silent tail. Leave 200 ms headroom instead.
      if (dur > 0) target = Math.min(target, Math.max(0, dur - 0.2));
      // Optimistic UI: the next position poll is up to 250 ms away — paint
      // the target now so timeline clicks and +10 s fast-forward feel
      // instant instead of snapping back until the poll catches up.
      this.lastSeekTarget = target;
      this.lastSeekAt = Date.now();
      this.seekRecovering = false;
      usePlayer.setState({ currentTime: target, buffering: true });
      void nativeAudio.seek(target).catch((e) => console.debug("[player] native seek failed:", e));
      return;
    }
    const a = this.audio;
    if (!a) return;
    // The transcode endpoint does not honor HTTP Range; a plain currentTime
    // seek would restart the stream from 0. Rebuild the URL with ?start= so
    // ffmpeg fast-seeks to the target (server kills the old process via the
    // session id). Raw files support Range and seek natively.
    if (this.onTranscodeSeek && a.src && a.src.includes("/files/transcode")) {
      this.onTranscodeSeek(Math.max(0, t));
      return;
    }
    a.currentTime = t;
  }
  setVolume(v: number) {
    if (this.mode === "native") return void nativeAudio.setVolume(v);
    if (this.audio) { this.audio.volume = v; this.audio.muted = false; }
  }
  setMuted(m: boolean) {
    if (this.mode === "native") return void nativeAudio.setVolume(m ? 0 : usePlayer.getState().volume);
    if (this.audio) this.audio.muted = m;
  }
  setPlaybackRate(r: number) {
    if (this.mode === "native") return void nativeAudio.setSpeed(r);
    if (this.audio) this.audio.playbackRate = r;
  }
}

export const engine = new PlayerEngine();

const persisted = loadPersist();

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: persisted.queue,
  index: persisted.index,
  isPlaying: false,
  buffering: false,
  shuffle: persisted.shuffle,
  repeat: persisted.repeat,
  currentTime: 0,
  duration: 0,
  volume: persisted.volume,
  playbackRate: persisted.playbackRate || 1,
  muted: false,
  primaryOpen: false,
  audioError: "",

  current: () => {
    const { queue, index } = get();
    return index >= 0 && index < queue.length ? queue[index] : null;
  },

  play: (queue, index = 0) => {
    if (!queue.length) return;
    engine.timeOffset = 0;
    set({ queue, index: Math.max(0, Math.min(index, queue.length - 1)), isPlaying: true, currentTime: 0, duration: 0, audioError: "" });
    persist();
  },

  toggle: () => engine.toggle(),

  next: (auto = false) => {
    const { queue, index, shuffle, repeat } = get();
    if (queue.length === 0) return;
    if (auto && repeat === "one") { engine.seek(0); engine.play(); return; }
    let ni: number;
    if (shuffle) {
      // Pick any *other* track so shuffle can't "advance" to the same song
      // (single-track queues just restart).
      ni = queue.length > 1
        ? (index + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length
        : 0;
    } else ni = index + 1;
    if (ni >= queue.length) {
      if (repeat === "all" || !auto) ni = 0;
      else { set({ isPlaying: false }); return; }
    }
    engine.timeOffset = 0;
    set({ index: ni, currentTime: 0, isPlaying: true, audioError: "" });
    persist();
  },

  prev: () => {
    const { queue, index, currentTime } = get();
    if (queue.length === 0) return;
    // Restart the current track when it has played past 3s — works for both
    // backends (engine.audio is null while the native engine owns playback,
    // so consult the synced store time there too).
    if ((engine.mode === "native" || engine.audio) && currentTime > 3) { engine.seek(0); return; }
    let pi = index - 1;
    if (pi < 0) pi = queue.length - 1;
    engine.timeOffset = 0;
    set({ index: pi, currentTime: 0, isPlaying: true, audioError: "" });
    persist();
  },

  setIndex: (i) => { engine.timeOffset = 0; set({ index: i, currentTime: 0, isPlaying: true, audioError: "" }); persist(); },

  removeFromQueue: (i) => {
    const { queue, index } = get();
    if (i < 0 || i >= queue.length) return;
    const nextQ = queue.filter((_, idx) => idx !== i);
    if (nextQ.length === 0) {
      engine.pause();
      engine.timeOffset = 0;
      set({ queue: [], index: -1, currentTime: 0, duration: 0, isPlaying: false });
      persist();
      return;
    }
    // Keep the same track playing: shift the index so it still points at it.
    let ni = index;
    if (i < index) ni = index - 1;
    else if (i === index) ni = Math.min(index, nextQ.length - 1);
    set({ queue: nextQ, index: ni });
    persist();
  },

  seek: (t) => engine.seek(t),

  setVolume: (v) => {
    const vol = Math.max(0, Math.min(1, v));
    engine.setVolume(vol);
    set({ volume: vol, muted: vol === 0 });
    persist();
  },

  setPlaybackRate: (r) => {
    engine.setPlaybackRate(r);
    set({ playbackRate: r });
    persist();
  },

  toggleMute: () => {
    const m = !get().muted;
    engine.setMuted(m);
    set({ muted: m });
  },

  setPrimaryOpen: (b) => set({ primaryOpen: b }),

  setAudioError: (msg) => set({ audioError: msg }),

  setShuffle: (s) => { set({ shuffle: s }); persist(); },

  cycleRepeat: () => {
    const order: Repeat[] = ["off", "all", "one"];
    const nextR = order[(order.indexOf(get().repeat) + 1) % order.length];
    set({ repeat: nextR });
    persist();
  },

  _syncTime: (c, d) => set({ currentTime: c, duration: isFinite(d) ? d : 0 }),
}));

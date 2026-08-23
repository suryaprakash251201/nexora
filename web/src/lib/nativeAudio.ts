/**
 * Bridge to the Tauri-native audio engine (`nexora-audio` Rust module).
 *
 * Availability is probed at runtime: desktop builds compiled with the
 * `native-audio` feature register real commands; every other environment
 * (web browser, older desktop builds) fails the first invoke and this
 * module reports `available() === false`, letting the player store fall
 * back to the HTML5 audio pipeline unchanged.
 */

export interface NativeTrackInfo {
  codec: string;
  sample_rate: number;
  channels: number;
  bits_per_sample: number;
  duration_sec: number | null;
}

export type NativeAudioEventKind = "ready" | "playing" | "paused" | "ended" | "error";

export interface NativeAudioEvent {
  kind: NativeAudioEventKind;
  message?: string;
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type ListenFn = (channel: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;

let invokeFn: InvokeFn | null = null;
let listenFn: ListenFn | null = null;

async function tauri(): Promise<{ invoke: InvokeFn; listen: ListenFn } | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  if (!invokeFn || !listenFn) {
    try {
      const core = await import("@tauri-apps/api/core");
      const event = await import("@tauri-apps/api/event");
      invokeFn = core.invoke as InvokeFn;
      listenFn = event.listen as unknown as ListenFn;
    } catch {
      return null;
    }
  }
  return { invoke: invokeFn!, listen: listenFn! };
}

let availabilityCache: boolean | null = null;

/** True when this build ships the native engine AND we're inside Tauri. */
export async function nativeAudioAvailable(): Promise<boolean> {
  if (availabilityCache !== null) return availabilityCache;
  const t = await tauri();
  if (!t) {
    availabilityCache = false;
    return false;
  }
  try {
    availabilityCache = await t.invoke<boolean>("audio_native_available");
  } catch {
    availabilityCache = false; // command absent → build without the feature
  }
  return availabilityCache;
}

export const nativeAudio = {
  /** One-time codec support list for the native decoder. */
  codecs: (): Promise<string[]> =>
    (async () => {
      const t = await tauri();
      if (!t) return [];
      return t.invoke<string[]>("audio_native_codecs").catch(() => []);
    })(),

  open: (url: string, opts?: { bearer?: string | null; startSec?: number }): Promise<NativeTrackInfo> =>
    (async () => {
      const t = await tauri();
      if (!t) throw new Error("native audio unavailable");
      return t.invoke<NativeTrackInfo>("audio_native_open", {
        url,
        bearer: opts?.bearer ?? null,
        startSec: opts?.startSec ?? null,
      });
    })(),

  play: async (): Promise<void> => void (await (await tauri())?.invoke("audio_native_play")),
  pause: async (): Promise<void> => void (await (await tauri())?.invoke("audio_native_pause")),
  stop: async (): Promise<void> => void (await (await tauri())?.invoke("audio_native_stop")),
  seek: async (sec: number): Promise<void> =>
    void (await (await tauri())?.invoke("audio_native_seek", { sec })),
  setVolume: async (volume: number): Promise<void> =>
    void (await (await tauri())?.invoke("audio_native_set_volume", { volume })),

  position: async (): Promise<number> =>
    (await (await tauri())?.invoke<number>("audio_native_position")) ?? 0,

  /** Subscribe to engine events; returns an unlisten function. */
  onEvent: async (cb: (e: NativeAudioEvent) => void): Promise<() => void> => {
    const t = await tauri();
    if (!t) return () => {};
    return t.listen("audio://event", (e) => cb(e.payload as NativeAudioEvent));
  },
};

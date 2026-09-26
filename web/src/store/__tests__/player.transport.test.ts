import { describe, expect, it, vi, beforeEach } from "vitest";

// The native adapter dereferences `window`, which does not exist under the
// Node-based test runner — stub it out like player.seek.test.ts does.
vi.mock("../../lib/nativeAudio", () => ({
  nativeAudio: {
    seek: async () => {},
    setVolume: async () => {},
    setSpeed: async () => {},
    play: async () => {},
    pause: async () => {},
    position: async () => 0,
  },
  nativeAudioAvailable: async () => true,
}));

const { engine, usePlayer } = await import("../player");

// The store persists the queue to localStorage on a window timer; neither
// exists under the Node-based runner. The transport actions under test all
// persist, so stub just enough of both.
const lsStore = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => void lsStore.set(k, v),
  removeItem: (k: string) => void lsStore.delete(k),
});
vi.stubGlobal("window", {
  setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
  clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
});

type Handler = () => void;

const track = (name: string) => ({
  name,
  path: name,
  extension: "wav",
  mime: "audio/wav",
  root_id: "root_1",
  size: 1,
  is_dir: false,
  modified: "2026-01-01T00:00:00Z",
});

/**
 * Stand-in for HTMLAudioElement that mimics the browser: play()/pause() flip
 * `paused` synchronously and queue the matching media event, and the media
 * load algorithm (`src` + `load()`) pauses the element and queues a `pause`
 * event of its own.
 */
function fakeAudio(paused = true) {
  const listeners = new Map<string, Handler[]>();
  const el = {
    paused,
    ended: false,
    preload: "metadata",
    currentTime: 0,
    duration: 5,
    volume: 1,
    muted: false,
    playbackRate: 1,
    src: "",
    play: vi.fn(function (this: { paused: boolean }) {
      this.paused = false;
      queueMicrotask(() => el.emit("play"));
      return Promise.resolve();
    }),
    pause: vi.fn(function (this: { paused: boolean }) {
      this.paused = true;
      queueMicrotask(() => el.emit("pause"));
    }),
    load: vi.fn(function () {
      el.paused = true;
      queueMicrotask(() => el.emit("pause"));
    }),
    addEventListener: (type: string, fn: Handler) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(fn);
    },
    removeEventListener: (type: string, fn: Handler) => {
      const arr = listeners.get(type);
      if (arr) listeners.set(type, arr.filter((f) => f !== fn));
    },
    emit: (type: string) => {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
  return el;
}

/** Lets queued media events (queueMicrotask + setTimeout 0) run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.useRealTimers();
  engine.mode = "html5";
  engine.audio = null;
  usePlayer.setState({
    queue: [],
    index: -1,
    isPlaying: false,
    buffering: false,
    currentTime: 0,
    duration: 0,
    repeat: "off",
    shuffle: false,
    audioError: "",
    transportIntent: { id: 0, playing: false },
  });
});

describe("PlayerEngine transport commands", () => {
  it("only touches an element that disagrees with the command", () => {
    const a = fakeAudio(true);
    engine.audio = a as unknown as HTMLAudioElement;

    engine.play();
    expect(a.play).toHaveBeenCalledTimes(1);
    engine.play();
    expect(a.play).toHaveBeenCalledTimes(1);

    engine.pause();
    expect(a.pause).toHaveBeenCalledTimes(1);
    engine.pause();
    expect(a.pause).toHaveBeenCalledTimes(1);
  });

  it("survives a missing element and ignores html5 commands in native mode", () => {
    expect(() => engine.play()).not.toThrow();
    expect(() => engine.pause()).not.toThrow();

    const a = fakeAudio(true);
    engine.audio = a as unknown as HTMLAudioElement;
    engine.mode = "native";
    try {
      engine.play();
      engine.pause();
      expect(a.play).not.toHaveBeenCalled();
      expect(a.pause).not.toHaveBeenCalled();
    } finally {
      engine.mode = "html5";
    }
  });
});

describe("PlayerEngine transport feedback", () => {
  // Regression: `isPlaying` mirrored the element's play/pause events AND drove
  // an effect that commanded the element, so the two sustained each other —
  // hundreds of media events per second, a flapping Play/Pause button, the
  // last track restarting forever, and a storm of failed /audio/info and
  // thumbnail requests from every effect that re-ran on each commit.
  it("settles after one command instead of oscillating", async () => {
    const a = fakeAudio(true);
    engine.bind(a as unknown as HTMLAudioElement);
    usePlayer.getState().play([track("a.wav")], 0);

    const intentId = usePlayer.getState().transportIntent.id;
    engine.play(); // what the intent effect does
    await flush();

    // Media events update the store, and nothing re-commands the element.
    for (let i = 0; i < 20; i++) {
      a.emit("play");
      a.emit("pause");
      a.emit("play");
      await flush();
    }

    expect(usePlayer.getState().transportIntent.id).toBe(intentId);
    expect(a.play).toHaveBeenCalledTimes(1);
    expect(a.pause).not.toHaveBeenCalled();
  });

  it("mutes the bookkeeping pause from a source swap and defers the restart", async () => {
    const a = fakeAudio(false);
    engine.bind(a as unknown as HTMLAudioElement);
    usePlayer.setState({ isPlaying: true });

    engine.loadSource("http://localhost/raw?path=b.wav");
    expect(a.src).toContain("b.wav");
    await flush();

    // The load algorithm paused the element, but that is a track switch, not a
    // user-visible stop — the UI must not flash "paused" on every change.
    expect(a.paused).toBe(true);
    expect(usePlayer.getState().isPlaying).toBe(true);

    // Once the swap settles, genuine element state is reported again.
    a.emit("canplay");
    a.emit("pause");
    expect(usePlayer.getState().isPlaying).toBe(false);
  });

  it("defers a play issued mid-load and replays it when the source is ready", async () => {
    const a = fakeAudio(true);
    engine.bind(a as unknown as HTMLAudioElement);
    usePlayer.getState().play([track("a.wav"), track("b.wav")], 1);

    engine.loadSource("http://localhost/raw?path=b.wav");
    engine.play(); // the intent effect fires while the new source is loading
    await flush();
    expect(a.play).not.toHaveBeenCalled();
    expect(usePlayer.getState().isPlaying).toBe(false);

    a.emit("canplay");
    await flush();
    expect(a.play).toHaveBeenCalledTimes(1);
    expect(usePlayer.getState().isPlaying).toBe(true);
  });

  it("cancels the deferred start when the user pauses mid-load", async () => {
    const a = fakeAudio(true);
    engine.bind(a as unknown as HTMLAudioElement);
    usePlayer.getState().play([track("a.wav")], 0);

    engine.loadSource("http://localhost/raw?path=a.wav");
    engine.play();
    engine.pause();
    a.emit("canplay");
    await flush();

    expect(a.play).not.toHaveBeenCalled();
    expect(usePlayer.getState().isPlaying).toBe(false);
  });

  it("stops at the end of a queue without replaying the last track", async () => {
    const a = fakeAudio(true);
    engine.bind(a as unknown as HTMLAudioElement);
    usePlayer.getState().play([track("a.wav"), track("b.wav")], 1);
    engine.play();
    await flush();
    expect(usePlayer.getState().isPlaying).toBe(true);

    a.ended = true;
    a.emit("ended");
    await flush();

    const st = usePlayer.getState();
    expect(st.index).toBe(1);
    expect(st.transportIntent.playing).toBe(false);
    expect(st.isPlaying).toBe(false);
    expect(a.play).toHaveBeenCalledTimes(1);
  });

  it("advances to the next track with a fresh play command", async () => {
    const a = fakeAudio(true);
    engine.bind(a as unknown as HTMLAudioElement);
    usePlayer.getState().play([track("a.wav"), track("b.wav")], 0);
    engine.play();
    await flush();

    a.ended = true;
    a.emit("ended");
    await flush();

    const st = usePlayer.getState();
    expect(st.index).toBe(1);
    expect(st.transportIntent.playing).toBe(true);
  });

  // Regression: `bind` keyed its idempotence off `this.audio`, which `detach`
  // clears — so a StrictMode remount (detach → re-attach the same node) stacked
  // a second `ended` listener. Every track end then advanced the queue twice:
  // the second call hit the end-of-queue branch, cancelled the pending start and
  // left the queue silently stalled on the new track.
  it("advances exactly once per track end after a detach/re-attach cycle", async () => {
    const a = fakeAudio(true);
    engine.bind(a as unknown as HTMLAudioElement);
    engine.detach(a as unknown as HTMLAudioElement);
    engine.bind(a as unknown as HTMLAudioElement); // StrictMode-style remount

    usePlayer.getState().play([track("a.wav"), track("b.wav")], 0);
    engine.play();
    await flush();
    expect(usePlayer.getState().isPlaying).toBe(true);

    a.ended = true;
    a.emit("ended");
    await flush();

    const st = usePlayer.getState();
    expect(st.index).toBe(1);
    expect(st.transportIntent.playing).toBe(true);

    // The new track must actually start, not be cancelled by a second advance.
    // Mirrors the player effect: swap the source, then honour the intent.
    engine.loadSource("http://localhost/raw?path=b.wav");
    engine.play();
    a.emit("canplay");
    await flush();
    expect(a.play).toHaveBeenCalledTimes(2);
    expect(usePlayer.getState().isPlaying).toBe(true);
  });
});

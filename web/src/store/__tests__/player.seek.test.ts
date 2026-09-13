import { describe, expect, it } from "vitest";
import { engine, usePlayer, nativeSeekStalled } from "../player";

describe("PlayerEngine native seek", () => {
  it("paints the target time optimistically (poll gap is 250ms)", () => {
    engine.mode = "native";
    try {
      usePlayer.setState({ currentTime: 5, duration: 0 });
      engine.seek(42);
      expect(usePlayer.getState().currentTime).toBe(42);
      // Negative targets clamp to zero.
      engine.seek(-10);
      expect(usePlayer.getState().currentTime).toBe(0);
    } finally {
      engine.mode = "html5";
      usePlayer.setState({ currentTime: 0, duration: 0, buffering: false });
    }
  });

  it("ignores non-finite seek targets", () => {
    engine.mode = "native";
    try {
      usePlayer.setState({ currentTime: 7, duration: 100 });
      engine.seek(NaN);
      expect(usePlayer.getState().currentTime).toBe(7);
      engine.seek(Infinity);
      expect(usePlayer.getState().currentTime).toBe(7);
    } finally {
      engine.mode = "html5";
      usePlayer.setState({ currentTime: 0, duration: 0, buffering: false });
    }
  });

  it("clamps seeks past EOS with headroom so the thread never parks at Ended", () => {
    engine.mode = "native";
    try {
      usePlayer.setState({ currentTime: 0, duration: 100 });
      engine.seek(500);
      // 100 - 0.2 headroom.
      expect(usePlayer.getState().currentTime).toBeCloseTo(99.8, 5);
      engine.seek(99.95);
      expect(usePlayer.getState().currentTime).toBeCloseTo(99.8, 5);
    } finally {
      engine.mode = "html5";
      usePlayer.setState({ currentTime: 0, duration: 0, buffering: false });
    }
  });

  it("patches unknown native duration from ffprobe metadata", () => {
    engine.mode = "native";
    try {
      usePlayer.setState({ duration: 0 });
      engine.setNativeDuration(187.5);
      expect(usePlayer.getState().duration).toBe(187.5);
      // Invalid values are ignored.
      engine.setNativeDuration(0);
      engine.setNativeDuration(NaN);
      expect(usePlayer.getState().duration).toBe(187.5);
    } finally {
      engine.mode = "html5";
      usePlayer.setState({ duration: 0 });
    }
  });
});

describe("nativeSeekStalled", () => {
  it("flags a seek unconfirmed past the grace period", () => {
    // Fresh seek (< grace) → not stalled yet.
    expect(nativeSeekStalled(5, 60, 400)).toBe(false);
    // Backend caught up (pos within 0.75 s of the target) → not stalled.
    expect(nativeSeekStalled(59.5, 60, 2000)).toBe(false);
    // Stale past the grace period → stalled.
    expect(nativeSeekStalled(5, 60, 900)).toBe(true);
    expect(nativeSeekStalled(5, 60, 10_000)).toBe(true);
  });
});

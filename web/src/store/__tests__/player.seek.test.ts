import { describe, expect, it } from "vitest";
import { engine, usePlayer } from "../player";

describe("PlayerEngine native seek", () => {
  it("paints the target time optimistically (poll gap is 250ms)", () => {
    engine.mode = "native";
    try {
      usePlayer.setState({ currentTime: 5 });
      engine.seek(42);
      expect(usePlayer.getState().currentTime).toBe(42);
      // Negative targets clamp to zero.
      engine.seek(-10);
      expect(usePlayer.getState().currentTime).toBe(0);
    } finally {
      engine.mode = "html5";
      usePlayer.setState({ currentTime: 0 });
    }
  });
});

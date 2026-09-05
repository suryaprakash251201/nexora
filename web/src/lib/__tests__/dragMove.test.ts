import { describe, expect, it } from "vitest";
import {
  MOVE_MIME,
  canDropInto,
  isInternalMoveDrag,
  isInternalMoveDragEvent,
  useDragMove,
} from "../dragMove";

const dt = (types: string[]) => ({ dataTransfer: { types } as unknown as DataTransfer });

describe("dragMove", () => {
  it("identifies internal move drags by MIME type", () => {
    expect(isInternalMoveDrag(dt([MOVE_MIME]))).toBe(true);
    expect(isInternalMoveDrag(dt(["Files"]))).toBe(false);
    expect(isInternalMoveDrag(dt([]))).toBe(false);
  });

  it("falls back to the in-page store when the engine hides dataTransfer types", () => {
    // Engines that hide custom types (older WebKitGTK on Linux desktop)
    // report an empty type list during dragover — the store set on
    // dragstart is the reliable signal there.
    useDragMove.getState().begin({
      paths: ["a/b"],
      names: ["b"],
      primaryIsDir: false,
      primaryName: "b",
    });
    expect(isInternalMoveDragEvent(dt([]))).toBe(true);
    useDragMove.getState().end();
    // An OS-file drag never activates the store.
    expect(isInternalMoveDragEvent(dt([]))).toBe(false);
    expect(isInternalMoveDragEvent(dt(["Files"]))).toBe(false);
  });

  it("rejects drops into self or descendants", () => {
    expect(canDropInto("a", ["a/b"])).toBe(true);
    expect(canDropInto("a/b", ["a/b"])).toBe(false); // self
    expect(canDropInto("a/b/c", ["a/b"])).toBe(false); // descendant
    expect(canDropInto("a/b2", ["a/b"])).toBe(true); // sibling prefix, not child
    expect(canDropInto("", ["a/b"])).toBe(true); // storage root
  });
});

import { describe, it, expect } from "vitest";
import { formatBytes, basename, cleanTrackTitle } from "@nexora/core";

describe("formatBytes", () => {
  it.each([
    [-1, "—"],
    [NaN, "—"],
    [Infinity, "—"],
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1048576, "1.0 MB"],
  ])("formatBytes(%s) → %s", (input, expected) => {
    expect(formatBytes(input as number)).toBe(expected);
  });
});

describe("basename", () => {
  it.each([
    ["a/b/c.txt", "c.txt"],
    ["folder/", "folder"],
    ["root.txt", "root.txt"],
  ])("basename(%s) → %s", (input, expected) => {
    expect(basename(input)).toBe(expected);
  });
});

describe("cleanTrackTitle", () => {
  it("strips extension and track numbers", () => {
    expect(cleanTrackTitle("01 - Song Name.mp3")).toContain("Song Name");
    expect(cleanTrackTitle("Song Name.flac")).toBe(cleanTrackTitle("Song Name.flac"));
  });
  it("handles empty input", () => {
    expect(cleanTrackTitle("")).toBe("");
  });
});

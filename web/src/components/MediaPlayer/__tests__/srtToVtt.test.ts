import { describe, expect, it } from "vitest";
import { srtToVtt } from "../VideoPlayer";

describe("srtToVtt", () => {
  it("converts both milliseconds commas in a timing line", () => {
    const srt = [
      "1",
      "00:00:01,000 --> 00:00:02,500",
      "Hello",
      "",
    ].join("\n");
    const vtt = srtToVtt(srt);
    expect(vtt).toContain("00:00:01.000 --> 00:00:02.500");
    expect(vtt).not.toContain(",");
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
  });

  it("keeps blocks without an index line", () => {
    const srt = ["00:00:03,250 --> 00:00:04,000", "No index"].join("\n");
    expect(srtToVtt(srt)).toContain("00:00:03.250 --> 00:00:04.000");
  });
});

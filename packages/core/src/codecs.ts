/**
 * Canonical transcode codec table — single source of truth for web + mobile.
 * Previously three divergent allowlists lived in web/src/lib/audioQuality.ts,
 * mobile/src/lib/audioQuality.ts, and mobile/src/api/client.ts. They are now
 * unified here with per-platform flags.
 */

export type Platform = "web" | "ios" | "android";

export interface CodecEntry {
  codec: string;
  native: Record<Platform, boolean>;
  /** Extra notes, e.g. "ALAC inside .m4a — needs ffprobe probe" */
  note?: string;
}

export const CODECS: CodecEntry[] = [
  { codec: "flac", native: { web: false, ios: true, android: true } },
  { codec: "alac", native: { web: false, ios: true, android: false }, note: "ALAC in .m4a/.m4b — probe via ffprobe on web" },
  { codec: "wav", native: { web: true, ios: true, android: true } },
  { codec: "aiff", native: { web: false, ios: true, android: false } },
  { codec: "ape", native: { web: false, ios: false, android: false } },
  { codec: "wavpack", native: { web: false, ios: false, android: false } },
  { codec: "tta", native: { web: false, ios: false, android: false } },
  { codec: "aac", native: { web: true, ios: true, android: true } },
  { codec: "mp3", native: { web: true, ios: true, android: true } },
  { codec: "opus", native: { web: true, ios: true, android: true } },
  { codec: "vorbis", native: { web: true, ios: true, android: true } },
  { codec: "wma", native: { web: false, ios: false, android: false } },
];

export function isNative(codec: string, platform: Platform): boolean {
  const e = CODECS.find(c => c.codec === codec.toLowerCase());
  return e ? !!e.native[platform] : false;
}

export function needsTranscode(codec: string, platform: Platform, ext?: string): boolean {
  const c = codec.toLowerCase();
  // .m4a/.m4b are ambiguous — caller should probe ffprobe for ALAC vs AAC.
  if ((ext === "m4a" || ext === "m4b") && (c === "alac" || c === "aac")) return c === "alac";
  return !isNative(c, platform);
}

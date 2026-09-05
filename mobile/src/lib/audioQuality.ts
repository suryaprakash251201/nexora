import { Platform } from "react-native";

/**
 * Nexora Audio Quality Detection Engine
 * ──────────────────────────────────────
 * Determines audio codec, quality tier, and technical specifications
 * from file metadata (extension, MIME, size). Single source of truth
 * for all quality badge UI across the app.
 */

/**
 * Android 10 and below (API < 30): the platform FLAC decoder (MediaCodec
 * "audio/flac") only ships with Android 11+, and expo-video does not bundle
 * Media3's FFmpeg extension. Used to pick the TRANSCODE OUTPUT codec: below
 * API 30, lossless sources are transcoded to high-quality AAC (320k) instead
 * of FLAC so every Android can decode the stream. Raw .flac files are still
 * served raw — many devices decode FLAC natively even below API 30.
 */
export function androidBelow11(): boolean {
  return (
    Platform.OS === "android" &&
    (typeof Platform.Version === "number" ? Platform.Version < 30 : true)
  );
}

// ─── Types ───────────────────────────────────────────────────────────

export type AudioCodec =
  | "MP3"
  | "AAC"
  | "ALAC"
  | "FLAC"
  | "WAV"
  | "AIFF"
  | "DSD"
  | "OGG"
  | "OPUS"
  | "WMA"
  | "M4A"
  | "APE"
  | "WV"
  | "TTA"
  | "UNKNOWN";

export type QualityTier =
  | "standard"
  | "high"
  | "lossless"
  | "hires"
  | "dsd"
  | "dolby"
  | "spatial";

export type BadgeVariant =
  | "mp3"
  | "aac"
  | "lossless"
  | "hires"
  | "dsd"
  | "dolby"
  | "spatial";

export interface AudioQualityInfo {
  codec: AudioCodec;
  tier: QualityTier;
  variant: BadgeVariant;
  /** Primary badge label (e.g. "LOSSLESS", "HI-RES") */
  label: string;
  /** Secondary detail line (e.g. "24-bit / 96 kHz") */
  detail: string | null;
  bitDepth: number | null;
  sampleRateKHz: number | null;
  bitrateKbps: number | null;
  isLossless: boolean;
  isHiRes: boolean;
  channels: number | null;
  container: string;
}

// ─── Color Palette ───────────────────────────────────────────────────

export interface BadgeColorSet {
  accent: string;
  accentSoft: string;
  darkBg: string;
  darkBorder: string;
  lightBg: string;
  lightBorder: string;
  lightAccent: string;
}

export const QUALITY_COLORS: Record<BadgeVariant, BadgeColorSet> = {
  mp3: {
    accent: "#8A8A8A",
    accentSoft: "rgba(138,138,138,0.15)",
    darkBg: "rgba(138,138,138,0.08)",
    darkBorder: "rgba(138,138,138,0.18)",
    lightBg: "rgba(138,138,138,0.10)",
    lightBorder: "rgba(138,138,138,0.22)",
    lightAccent: "#6B6B6B",
  },
  aac: {
    accent: "#4EA1FF",
    accentSoft: "rgba(78,161,255,0.15)",
    darkBg: "rgba(78,161,255,0.08)",
    darkBorder: "rgba(78,161,255,0.18)",
    lightBg: "rgba(78,161,255,0.10)",
    lightBorder: "rgba(78,161,255,0.22)",
    lightAccent: "#2B7FD9",
  },
  lossless: {
    accent: "#8B5CF6",
    accentSoft: "rgba(139,92,246,0.15)",
    darkBg: "rgba(139,92,246,0.08)",
    darkBorder: "rgba(139,92,246,0.18)",
    lightBg: "rgba(139,92,246,0.10)",
    lightBorder: "rgba(139,92,246,0.22)",
    lightAccent: "#7C3AED",
  },
  hires: {
    accent: "#F5C451",
    accentSoft: "rgba(245,196,81,0.15)",
    darkBg: "rgba(245,196,81,0.08)",
    darkBorder: "rgba(245,196,81,0.22)",
    lightBg: "rgba(200,155,40,0.10)",
    lightBorder: "rgba(200,155,40,0.22)",
    lightAccent: "#B8860B",
  },
  dsd: {
    accent: "#22C55E",
    accentSoft: "rgba(34,197,94,0.15)",
    darkBg: "rgba(34,197,94,0.08)",
    darkBorder: "rgba(34,197,94,0.18)",
    lightBg: "rgba(34,197,94,0.10)",
    lightBorder: "rgba(34,197,94,0.22)",
    lightAccent: "#16A34A",
  },
  dolby: {
    accent: "#38BDF8",
    accentSoft: "rgba(56,189,248,0.15)",
    darkBg: "rgba(56,189,248,0.08)",
    darkBorder: "rgba(56,189,248,0.18)",
    lightBg: "rgba(56,189,248,0.10)",
    lightBorder: "rgba(56,189,248,0.22)",
    lightAccent: "#0EA5E9",
  },
  spatial: {
    accent: "#06B6D4",
    accentSoft: "rgba(6,182,212,0.15)",
    darkBg: "rgba(6,182,212,0.08)",
    darkBorder: "rgba(6,182,212,0.18)",
    lightBg: "rgba(6,182,212,0.10)",
    lightBorder: "rgba(6,182,212,0.22)",
    lightAccent: "#0891B2",
  },
};

// ─── Lookup Tables ───────────────────────────────────────────────────

const EXT_TO_CODEC: Record<string, AudioCodec> = {
  ".mp3": "MP3",
  ".aac": "AAC",
  ".m4a": "M4A",
  ".m4b": "M4A",
  ".alac": "ALAC",
  ".flac": "FLAC",
  ".wav": "WAV",
  ".aiff": "AIFF",
  ".aif": "AIFF",
  ".dsd": "DSD",
  ".dsf": "DSD",
  ".dff": "DSD",
  ".ogg": "OGG",
  ".oga": "OGG",
  ".opus": "OPUS",
  ".wma": "WMA",
  ".ape": "APE",
  ".wv": "WV",
  ".tta": "TTA",
  ".mka": "M4A",
};

const MIME_TO_CODEC: Record<string, AudioCodec> = {
  "audio/mpeg": "MP3",
  "audio/mp3": "MP3",
  "audio/aac": "AAC",
  "audio/mp4": "M4A",
  "audio/x-m4a": "M4A",
  "audio/m4a": "M4A",
  "audio/alac": "ALAC",
  "audio/flac": "FLAC",
  "audio/x-flac": "FLAC",
  "audio/wav": "WAV",
  "audio/x-wav": "WAV",
  "audio/wave": "WAV",
  "audio/aiff": "AIFF",
  "audio/x-aiff": "AIFF",
  "audio/dsd": "DSD",
  "audio/x-dsd": "DSD",
  "audio/x-dsf": "DSD",
  "audio/x-dff": "DSD",
  "audio/ogg": "OGG",
  "audio/opus": "OPUS",
  "audio/x-ms-wma": "WMA",
  "audio/x-ape": "APE",
  "audio/x-wavpack": "WV",
  "audio/x-tta": "TTA",
  "audio/x-matroska": "M4A",
};

// ─── Heuristics ──────────────────────────────────────────────────────

function estimateBitrateKbps(bytes: number, durationSec?: number): number | null {
  if (!bytes || bytes <= 0) return null;
  if (durationSec && durationSec > 0) {
    return Math.round((bytes * 8) / (durationSec * 1000));
  }
  return null;
}

function likelyHiResFromSize(bytes: number): boolean {
  return bytes > 50 * 1024 * 1024;
}

// ─── Core Detection ──────────────────────────────────────────────────

export interface QualityOverrides {
  bitDepth?: number;
  sampleRateHz?: number;
  channels?: number;
  bitrateKbps?: number;
  isDolbyAtmos?: boolean;
  isSpatialAudio?: boolean;
}

export function detectAudioQuality(
  extension: string,
  mime?: string,
  fileSizeBytes?: number,
  durationSec?: number,
  overrides?: QualityOverrides
): AudioQualityInfo {
  const ext = (extension || "").toLowerCase().startsWith(".")
    ? extension.toLowerCase()
    : `.${(extension || "").toLowerCase()}`;

  // 1) Resolve codec
  let codec: AudioCodec = EXT_TO_CODEC[ext] || "UNKNOWN";
  if (codec === "UNKNOWN" && mime) {
    codec = MIME_TO_CODEC[mime.toLowerCase()] || "UNKNOWN";
  }

  // 2) Special overrides
  if (overrides?.isDolbyAtmos) return mkDolby(codec, ext, overrides);
  if (overrides?.isSpatialAudio) return mkSpatial(codec, ext, overrides);

  // 3) Codec-specific builders
  if (codec === "DSD") return mkDsd(ext, overrides);
  if (["FLAC", "ALAC", "WAV", "AIFF", "APE", "WV", "TTA"].includes(codec))
    return mkLossless(codec, ext, fileSizeBytes, durationSec, overrides);
  if (codec === "M4A") {
    const big = fileSizeBytes && fileSizeBytes > 30 * 1024 * 1024;
    return big
      ? mkLossless("ALAC", ext, fileSizeBytes, durationSec, overrides)
      : mkAac(fileSizeBytes, durationSec, overrides);
  }
  if (codec === "AAC") return mkAac(fileSizeBytes, durationSec, overrides);
  if (codec === "MP3") return mkMp3(fileSizeBytes, durationSec, overrides);
  if (codec === "OGG" || codec === "OPUS")
    return mkOgg(codec, fileSizeBytes, durationSec, overrides);
  if (codec === "WMA") return mkWma(fileSizeBytes, durationSec, overrides);

  // Fallback
  return {
    codec,
    tier: "standard",
    variant: "mp3",
    label: codec === "UNKNOWN" ? "AUDIO" : codec,
    detail: null,
    bitDepth: null,
    sampleRateKHz: null,
    bitrateKbps: null,
    isLossless: false,
    isHiRes: false,
    channels: overrides?.channels ?? null,
    container: ext.replace(".", "").toUpperCase() || "UNKNOWN",
  };
}

// ─── Builders ────────────────────────────────────────────────────────

function mkMp3(
  bytes?: number,
  dur?: number,
  ov?: QualityOverrides
): AudioQualityInfo {
  const br = ov?.bitrateKbps ?? estimateBitrateKbps(bytes || 0, dur) ?? 320;
  return {
    codec: "MP3",
    tier: br >= 256 ? "high" : "standard",
    variant: "mp3",
    label: "MP3",
    detail: `${br} kbps`,
    bitDepth: 16,
    sampleRateKHz: 44.1,
    bitrateKbps: br,
    isLossless: false,
    isHiRes: false,
    channels: ov?.channels ?? 2,
    container: "MP3",
  };
}

function mkAac(
  bytes?: number,
  dur?: number,
  ov?: QualityOverrides
): AudioQualityInfo {
  const br = ov?.bitrateKbps ?? estimateBitrateKbps(bytes || 0, dur) ?? 256;
  return {
    codec: "AAC",
    tier: "high",
    variant: "aac",
    label: "AAC",
    detail: `${br} kbps`,
    bitDepth: 16,
    sampleRateKHz: 44.1,
    bitrateKbps: br,
    isLossless: false,
    isHiRes: false,
    channels: ov?.channels ?? 2,
    container: "M4A",
  };
}

function mkLossless(
  codec: AudioCodec,
  ext: string,
  bytes?: number,
  dur?: number,
  ov?: QualityOverrides
): AudioQualityInfo {
  let bd = ov?.bitDepth ?? 16;
  let srHz = ov?.sampleRateHz ?? 44100;

  if (!ov?.bitDepth && !ov?.sampleRateHz && bytes && likelyHiResFromSize(bytes)) {
    bd = 24;
    srHz = 96000;
  }

  const srKHz = srHz / 1000;
  const hiRes = bd >= 24 || srHz >= 88200;
  const br =
    ov?.bitrateKbps ??
    estimateBitrateKbps(bytes || 0, dur) ??
    Math.round((bd * srHz * 2) / 1000);

  const srDisplay = Number.isInteger(srKHz) ? `${srKHz}` : `${srKHz}`;

  return {
    codec,
    tier: hiRes ? "hires" : "lossless",
    variant: hiRes ? "hires" : "lossless",
    label: hiRes ? "HI-RES" : "LOSSLESS",
    detail: `${bd}-bit / ${srDisplay} kHz`,
    bitDepth: bd,
    sampleRateKHz: srKHz,
    bitrateKbps: Math.round(br),
    isLossless: true,
    isHiRes: hiRes,
    channels: ov?.channels ?? 2,
    container: ext.replace(".", "").toUpperCase(),
  };
}

function mkDsd(ext: string, ov?: QualityOverrides): AudioQualityInfo {
  const srHz = ov?.sampleRateHz ?? 2822400;
  const mhz = srHz / 1_000_000;
  const mhzStr = mhz % 1 === 0 ? `${mhz}` : `${mhz.toFixed(1)}`;
  const ch = ov?.channels ?? 2;

  return {
    codec: "DSD",
    tier: "dsd",
    variant: "dsd",
    label: "DSD",
    detail: `${mhzStr} MHz`,
    bitDepth: 1,
    sampleRateKHz: srHz / 1000,
    bitrateKbps: Math.round((srHz * ch) / 1000),
    isLossless: true,
    isHiRes: true,
    channels: ch,
    container: ext.replace(".", "").toUpperCase(),
  };
}

function mkDolby(
  codec: AudioCodec,
  ext: string,
  ov?: QualityOverrides
): AudioQualityInfo {
  return {
    codec,
    tier: "dolby",
    variant: "dolby",
    label: "DOLBY ATMOS",
    detail: null,
    bitDepth: 24,
    sampleRateKHz: 48,
    bitrateKbps: ov?.bitrateKbps ?? null,
    isLossless: true,
    isHiRes: true,
    channels: ov?.channels ?? 8,
    container: ext.replace(".", "").toUpperCase(),
  };
}

function mkSpatial(
  codec: AudioCodec,
  ext: string,
  ov?: QualityOverrides
): AudioQualityInfo {
  return {
    codec,
    tier: "spatial",
    variant: "spatial",
    label: "SPATIAL AUDIO",
    detail: null,
    bitDepth: 24,
    sampleRateKHz: 48,
    bitrateKbps: ov?.bitrateKbps ?? null,
    isLossless: true,
    isHiRes: true,
    channels: ov?.channels ?? 8,
    container: ext.replace(".", "").toUpperCase(),
  };
}

function mkOgg(
  codec: AudioCodec,
  bytes?: number,
  dur?: number,
  ov?: QualityOverrides
): AudioQualityInfo {
  const br = ov?.bitrateKbps ?? estimateBitrateKbps(bytes || 0, dur) ?? 192;
  return {
    codec,
    tier: br >= 256 ? "high" : "standard",
    variant: "aac",
    label: codec,
    detail: `${br} kbps`,
    bitDepth: 16,
    sampleRateKHz: 48,
    bitrateKbps: br,
    isLossless: false,
    isHiRes: false,
    channels: ov?.channels ?? 2,
    container: codec,
  };
}

function mkWma(
  bytes?: number,
  dur?: number,
  ov?: QualityOverrides
): AudioQualityInfo {
  const br = ov?.bitrateKbps ?? estimateBitrateKbps(bytes || 0, dur) ?? 192;
  return {
    codec: "WMA",
    tier: "standard",
    variant: "mp3",
    label: "WMA",
    detail: `${br} kbps`,
    bitDepth: 16,
    sampleRateKHz: 44.1,
    bitrateKbps: br,
    isLossless: false,
    isHiRes: false,
    channels: ov?.channels ?? 2,
    container: "WMA",
  };
}

// ─── Display Utilities ───────────────────────────────────────────────

// Codecs the native players (iOS AVPlayer / Android ExoPlayer) cannot decode
// reliably. These must be routed through the server's ffmpeg transcode
// pipeline (AAC-in-MP4) to be playable on both platforms.
const NON_NATIVE_CODECS = new Set(["ALAC", "WMA", "DSD", "APE", "WV", "TTA", "OGG", "OPUS"]);

// Codecs decodable by BOTH iOS AVPlayer and Android ExoPlayer/Media3 — safe
// to stream raw. When the server reports one of these, never transcode.
const NATIVE_SAFE_CODECS = new Set([
  "aac", "mp3", "flac", "vorbis", "opus", "aiff", "mp2", "ac3", "eac3",
  "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_f64le",
  "pcm_u8", "pcm_s8", "pcm_alaw", "pcm_mulaw",
]);

/**
 * needsAudioTranscode reports whether this audio file must be streamed
 * through the server transcode endpoint instead of played raw.
 *
 * When the server supplies the real codec (ffprobe via /audio/info), it is
 * authoritative: ALAC/WMA/DSD/APE/… must transcode, while AAC/MP3/FLAC/
 * PCM/… decode natively on both platforms. Without it, the extension/MIME
 * heuristics apply: `.m4a` is ambiguous (AAC plays everywhere, ALAC
 * nowhere), so large M4A files (likely ALAC / hi-res) are pre-routed when
 * the file size is available — the same rule detectAudioQuality uses.
 *
 * NOTE: FLAC is intentionally served raw on every Android — the platform
 * (or OEM) FLAC decoder handles it below API 30 on many devices, and raw
 * FLAC is proven to work where a FLAC transcode stream may not.
 */
export function needsAudioTranscode(extension?: string, mime?: string, fileSizeBytes?: number, realCodec?: string): boolean {
  const rc = (realCodec || "").toLowerCase();
  if (rc) {
    // Server-provided codec is authoritative.
    if (NON_NATIVE_CODECS.has(rc.toUpperCase())) return true;
    if (NATIVE_SAFE_CODECS.has(rc)) return false;
    // Unknown codec — conservative: transcode rather than fail playback.
    return true;
  }
  const q = detectAudioQuality(extension || "", mime || "", fileSizeBytes);
  if (NON_NATIVE_CODECS.has(q.codec)) return true;
  return false;
}

export function formatBitrate(kbps: number | null): string {
  if (kbps === null) return "—";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${kbps} kbps`;
}

export function formatSampleRate(khz: number | null): string {
  if (khz === null) return "—";
  if (khz >= 1000) return `${(khz / 1000).toFixed(1)} MHz`;
  return `${khz} kHz`;
}

export function formatBitDepth(bits: number | null): string {
  if (bits === null) return "—";
  return `${bits}-bit`;
}

export function formatChannels(ch: number | null): string {
  if (ch === null) return "—";
  if (ch === 1) return "Mono";
  if (ch === 2) return "Stereo";
  if (ch === 6) return "5.1";
  if (ch === 8) return "7.1";
  return `${ch}ch`;
}

// ─── Enriched server metadata (/audio/info) ──────────────────────────────

/** Enriched track metadata returned by GET /audio/info.
 * Normalized music fields (title/artist/album/…) are extracted server-side
 * from the song container tags — render these instead of raw tags. */
export interface AudioInfo {
  codec: string;
  codec_long: string;
  sample_rate: number;
  bit_depth: number;
  channels: number;
  channel_layout: string;
  bit_rate: number;
  duration: number;
  format: string;
  tags: Record<string, string>;
  lossless: boolean;
  container: string;
  extension: string;
  title: string;
  artist: string;
  artists: string[];
  album: string;
  album_artist: string;
  genre: string;
  genres: string[];
  year: number;
  date: string;
  track_no: number;
  track_total: number;
  disc_no: number;
  disc_total: number;
  composer: string;
  performer: string;
  publisher: string;
  bpm: number;
  musical_key: string;
  comment: string;
  has_cover: boolean;
}

/** Player-ready display fields: prefers normalized server extraction,
 * falls back to the filename when tags are absent. */
export function getTrackDisplay(
  item: { name?: string; path?: string },
  info?: AudioInfo | null
): { title: string; artist: string; album: string } {
  const fallbackTitle = (item.name || item.path?.split("/").pop() || "Unknown track").replace(/\.[^.]+$/, "");
  return {
    title: info?.title || fallbackTitle,
    artist: info?.artist || "",
    album: info?.album || "",
  };
}

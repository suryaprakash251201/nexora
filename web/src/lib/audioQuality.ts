import { audioApi } from "../api/endpoints";

// ── Audio metadata & quality tiers ──────────────────────────────────────────

export type AudioTier = "lossless-hi-res" | "lossless" | "lossy-high" | "lossy" | "unknown";

/** Rich metadata returned by GET /audio/info (ffprobe-backed).
 * Normalized music fields (title/artist/album/…) are extracted server-side
 * from the song container tags — the player song container should render
 * these instead of reading raw tags (whose keys vary by container). */
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
  // ── Normalized song container / artist extraction (server-provided) ──
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

export interface AudioQualityInfo {
  tier: AudioTier;
  /** Human label, e.g. "FLAC · 24-bit · 96kHz" */
  label: string;
  /** Tailwind text color class */
  color: string;
  /** Short badge, e.g. "HI-RES" | "LOSSLESS" | "320 kbps" */
  badge: string;
  isLossless: boolean;
  /** True when the webview cannot decode the codec and needs transcoding */
  needsTranscode: boolean;
  /** Secondary detail line, e.g. "16-bit · 44.1kHz · stereo" */
  detail: string;
}

const TIER_STYLE: Record<AudioTier, { color: string; badge: string }> = {
  "lossless-hi-res": { color: "text-amber-300", badge: "HI-RES" },
  lossless: { color: "text-emerald-400", badge: "LOSSLESS" },
  "lossy-high": { color: "text-sky-400", badge: "HIGH" },
  lossy: { color: "text-zinc-400", badge: "COMPRESSED" },
  unknown: { color: "text-white/70", badge: "AUDIO" },
};

// Codecs the Chromium/WebKitGTK webviews cannot decode natively (no decoder
// compiled in), so playback must go through the server transcode pipeline.
const NON_NATIVE_CODECS = new Set([
  "alac", "wma", "wmav1", "wmav2", "wmapro", "ape", "wavpack", "tta",
  "dts", "dca", "ac3", "eac3", "truehd", "mlp", "amr_nb", "amr_wb", "gsm_ms",
]);

const LOSSLESS_EXT = new Set(["flac", "alac", "wav", "aiff", "aif", "ape", "wv", "tta"]);

const LOSSLESS_CODECS = new Set([
  "flac", "alac", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_f64le",
  "pcm_u8", "aiff", "ape", "wavpack", "tta",
]);

const LOSSLESS_MIME_PREFIX = ["audio/flac", "audio/wav", "audio/x-wav", "audio/aiff", "audio/x-aiff", "audio/alac"];

export function isLosslessExtension(ext: string): boolean {
  return LOSSLESS_EXT.has(ext.toLowerCase());
}

function isLosslessMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return LOSSLESS_MIME_PREFIX.some((p) => m.startsWith(p));
}

function fmtSampleRate(sr: number): string {
  if (sr <= 0) return "";
  return sr % 1000 === 0 ? `${sr / 1000}kHz` : `${(sr / 1000).toFixed(1)}kHz`;
}

/**
 * getAudioQuality returns a quality descriptor for an audio item.
 * When `info` (from /audio/info) is supplied, real bit depth / sample rate /
 * codec are used; otherwise a conservative extension-based estimate.
 */
export function getAudioQuality(
  item: { extension?: string; mime?: string },
  info?: AudioInfo | null
): AudioQualityInfo {
  const ext = (item.extension || "").toLowerCase();
  const mime = item.mime || "";

  // ── Real metadata path ──────────────────────────────────────────────────
  if (info) {
    const codec = (info.codec || "").toLowerCase();
    const isLossless = !!info.lossless || LOSSLESS_CODECS.has(codec);
    const hiRes = isLossless && (info.bit_depth >= 24 || info.sample_rate > 48000);
    const tier: AudioTier = !isLossless
      ? info.bit_rate >= 256000
        ? "lossy-high"
        : "lossy"
      : hiRes
        ? "lossless-hi-res"
        : "lossless";
    const bits = info.bit_depth > 0 ? `${info.bit_depth}-bit` : "";
    const sr = fmtSampleRate(info.sample_rate);
    const codecLabel = (info.codec_long || info.codec || "audio").split(" ")[0];
    return {
      tier,
      label: [codecLabel.toUpperCase(), bits, sr].filter(Boolean).join(" · "),
      color: TIER_STYLE[tier].color,
      badge: TIER_STYLE[tier].badge,
      isLossless,
      needsTranscode: NON_NATIVE_CODECS.has(codec),
      detail: [bits, sr, info.channel_layout || (info.channels > 0 ? `${info.channels}ch` : "")].filter(Boolean).join(" · "),
    };
  }

  // ── Extension/MIME fallback (no ffprobe round-trip) ─────────────────────
  const isLossless = LOSSLESS_EXT.has(ext) || isLosslessMime(mime);
  if (isLossless) {
    const tier: AudioTier = "lossless";
    const label =
      ext === "flac" ? "FLAC · Lossless"
      : ext === "alac" ? "ALAC · Lossless"
      : ext === "wav" ? "WAV · Lossless"
      : ext === "aiff" || ext === "aif" ? "AIFF · Lossless"
      : "Lossless";
    return {
      tier,
      label,
      color: TIER_STYLE[tier].color,
      badge: TIER_STYLE[tier].badge,
      isLossless: true,
      needsTranscode: NON_NATIVE_CODECS.has(ext) || ext === "alac",
      detail: ext.toUpperCase(),
    };
  }

  // Lossy codecs — estimate quality tier from extension.
  if (ext === "mp3" || ext === "m4a" || ext === "aac" || ext === "m4b") {
    const tier: AudioTier = "lossy-high";
    return {
      tier,
      label: ext.toUpperCase() + " · High Quality",
      color: TIER_STYLE[tier].color,
      badge: "HIGH",
      isLossless: false,
      needsTranscode: false, // AAC/MP3 play natively; fallback only if ALAC-in-m4a
      detail: ext.toUpperCase(),
    };
  }
  if (ext === "ogg" || ext === "oga" || ext === "opus") {
    const tier: AudioTier = "lossy-high";
    return {
      tier,
      label: (ext === "opus" ? "Opus" : "Ogg") + " · High Quality",
      color: TIER_STYLE[tier].color,
      badge: "HIGH",
      isLossless: false,
      needsTranscode: false,
      detail: ext.toUpperCase(),
    };
  }
  if (ext === "wma") {
    const tier: AudioTier = "lossy";
    return {
      tier,
      label: "WMA · Compressed",
      color: TIER_STYLE[tier].color,
      badge: "COMPRESSED",
      isLossless: false,
      needsTranscode: true,
      detail: "WMA",
    };
  }
  if (mime.startsWith("audio/")) {
    const tier: AudioTier = "unknown";
    return {
      tier,
      label: "Audio",
      color: TIER_STYLE[tier].color,
      badge: TIER_STYLE[tier].badge,
      isLossless: false,
      needsTranscode: false,
      detail: ext.toUpperCase() || mime,
    };
  }
  return {
    tier: "unknown",
    label: "",
    color: TIER_STYLE.unknown.color,
    badge: TIER_STYLE.unknown.badge,
    isLossless: false,
    needsTranscode: false,
    detail: "",
  };
}

// ── /audio/info fetching with per-file caching ──────────────────────────────

const infoCache = new Map<string, AudioInfo>();

export async function fetchAudioInfo(rootId: string, path: string): Promise<AudioInfo | null> {
  const key = `${rootId}|${path}`;
  const cached = infoCache.get(key);
  if (cached) return cached;
  try {
    const data = await audioApi.info(rootId, path);
    infoCache.set(key, data);
    // Bound the cache so browsing huge libraries doesn't leak memory.
    if (infoCache.size > 500) {
      const firstKey = infoCache.keys().next().value as string | undefined;
      if (firstKey) infoCache.delete(firstKey);
    }
    return data;
  } catch {
    return null;
  }
}

/** Batch-fetch enriched metadata for a song container (queue/playlist) in one
 * round-trip. Results populate the same per-file cache as fetchAudioInfo. */
export async function fetchAudioInfoBatch(
  items: Array<{ root_id: string; path: string }>
): Promise<Map<string, AudioInfo | null>> {
  const out = new Map<string, AudioInfo | null>();
  const missing = items.filter((it) => {
    const hit = infoCache.get(`${it.root_id}|${it.path}`);
    if (hit) {
      out.set(`${it.root_id}|${it.path}`, hit);
      return false;
    }
    return true;
  });
  if (!missing.length) return out;
  try {
    const res = await audioApi.infoBatch(
      missing.map((m) => ({ root: m.root_id, path: m.path }))
    );
    for (const row of res.items || []) {
      const key = `${row.root}|${row.path}`;
      if (row.ok && row.info) {
        infoCache.set(key, row.info as AudioInfo);
        out.set(key, row.info as AudioInfo);
      } else {
        out.set(key, null);
      }
    }
  } catch {
    for (const m of missing) out.set(`${m.root_id}|${m.path}`, null);
  }
  return out;
}

/** Player-ready display fields for a track: prefers normalized server
 * extraction, falls back to filename cleaning when tags are absent. */
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

export function clearAudioInfoCache(): void {
  infoCache.clear();
}

// ── Browser codec capability (cached) ───────────────────────────────────────

let alacNative: boolean | null = null;

/**
 * browserSupportsAlac reports whether this browser can decode ALAC-in-MP4
 * natively. Safari/WebKit: yes ("probably") — ALAC .m4a files then stream
 * directly with Range support, no ffprobe probe and no server transcode.
 * Chrome/Firefox: no — those keep the ffprobe pre-route for ALAC files.
 */
export function browserSupportsAlac(): boolean {
  if (alacNative === null) {
    try {
      alacNative = document.createElement("audio").canPlayType('audio/mp4; codecs="alac"') !== "";
    } catch {
      alacNative = false;
    }
  }
  return alacNative;
}
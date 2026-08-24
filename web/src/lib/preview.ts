import { isTauri } from "./desktop";
import type { FileItem } from "../api/types";
import { getMediaUrl } from "../api/client";
import { versionApi } from "../api/endpoints";
import { getAudioQuality, fetchAudioInfo, browserSupportsAlac } from "./audioQuality";
import {
  previewKind as corePreviewKind,
  isEditable as coreIsEditable,
  isAudio as coreIsAudio,
  cleanTrackTitle as coreCleanTrackTitle,
} from "@nexora/core";

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "markdown" | "text" | "none";
export function previewKind(item: { mime: string; extension: string; name?: string }): PreviewKind {
  const k = corePreviewKind(item as any);
  if (k === "code") return "text";
  if (k === "other") return "none";
  return k as PreviewKind;
}
export const isEditable = coreIsEditable;
export const isAudio = coreIsAudio;
export const cleanTrackTitle = coreCleanTrackTitle;

// codeLanguage returns a coarse language label for display purposes.
export { getAudioQuality, fetchAudioInfo, clearAudioInfoCache, isLosslessExtension, browserSupportsAlac } from "./audioQuality";
export type { AudioQualityInfo, AudioInfo, AudioTier } from "./audioQuality";

export function codeLanguage(ext: string): string {
  const map: Record<string, string> = {
    js: "JavaScript", jsx: "JavaScript", ts: "TypeScript", tsx: "TypeScript",
    py: "Python", go: "Go", rs: "Rust", java: "Java", c: "C", cpp: "C++",
    h: "C header", sh: "Shell", bash: "Shell", html: "HTML", css: "CSS",
    scss: "SCSS", json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML",
    sql: "SQL", xml: "XML", md: "Markdown", ini: "INI", csv: "CSV",
    lrc: "Synced lyrics",
  };
  return map[ext?.toLowerCase()] || (ext ? ext.toUpperCase() : "Text");
}

export function rawUrl(rootId: string, path: string, download = false): string {
  return getMediaUrl("/files/raw", { root: rootId, path, download: download ? 1 : undefined });
}

// lyricsUrl builds the synced-lyrics endpoint URL for an audio file.
export function lyricsUrl(rootId: string, path: string): string {
  return getMediaUrl("/audio/lyrics", { root: rootId, path });
}

export function thumbUrl(item: FileItem, size = 256): string {
  return getMediaUrl("/files/thumbnail", { root: item.root_id, path: item.path, size });
}

export function hasThumbnail(item: { extension: string }): boolean {
  return ["jpg", "jpeg", "png", "gif"].includes((item.extension || "").toLowerCase());
}

// TRANSCODE_EXT lists video containers that browsers cannot play natively and
// therefore need server-side transcoding to a streamable MP4.
const TRANSCODE_EXT = new Set([
  "avi", "wmv", "flv", "asf", "3gp", "vob", "mts", "m2ts", "ts", "rm", "divx", "mkv",
]);

export function needsTranscode(item: { extension: string }): boolean {
  const ext = (item.extension || "").toLowerCase();
  // MKV is in TRANSCODE_EXT so browsers always route to server-side transcoding.
  // In Tauri (WebView2), direct playback is attempted first as a fallback since
  // system codecs often handle H.264/AAC inside MKV natively.
  return TRANSCODE_EXT.has(ext);
}

// generateSessionId creates a UUID v4 for transcode session tracking.
// This lets the server explicitly kill old ffmpeg processes when seeking.
export function generateSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function transcodeUrl(rootId: string, path: string, opts?: { start?: number; session?: string; format?: string; quality?: string }): string {
  const params: Record<string, string | number> = { root: rootId, path };
  if (opts?.start !== undefined && opts.start > 0) {
    params.start = opts.start;
  }
  if (opts?.session) {
    params.session = opts.session;
  }
  if (opts?.format) {
    params.format = opts.format;
  }
  if (opts?.quality) {
    params.quality = opts.quality;
  }
  return getMediaUrl("/files/transcode", params);
}

// isTauriRuntime reports whether the frontend is running inside the Tauri
// desktop shell (as opposed to a plain web browser).
export function isTauriRuntime(): boolean {
  return isTauri();
}

// needsAudioTranscode reports whether the webview cannot decode this audio
// file natively and playback must be routed through the server transcode
// pipeline.
//
// The extension check is fast, but .m4a/.m4b are ambiguous: they may carry
// native AAC (plays everywhere) or ALAC (Apple Lossless — unsupported by
// Chrome/Firefox). For those we probe real ffprobe metadata via /audio/info so
// ALAC files are pre-routed to transcoding instead of failing on the raw
// stream first (which cost a full error round-trip and a visible stutter on
// every ALAC track).
//
// Lightweight paths:
//  - Safari decodes ALAC in MP4 natively (canPlayType says so) → no probe,
//    no transcode, straight native streaming with Range support.
//  - Decisions are memoized per root|path and in-flight probes deduplicated —
//    AudioPlayer and PlayerBar both ask on track change; only one request flies.

const nativityMemo = new Map<string, Promise<boolean>>();

export function needsAudioTranscode(item: { extension?: string; root_id: string; path: string }): Promise<boolean> {
  const ext = (item.extension || "").toLowerCase();
  // Safari (and WebKit-based views) can decode ALAC-in-MP4 natively.
  if ((ext === "m4a" || ext === "m4b") && browserSupportsAlac()) {
    return Promise.resolve(false);
  }
  const q = getAudioQuality(item);
  if (q.needsTranscode) return Promise.resolve(true);
  if (ext !== "m4a" && ext !== "m4b") return Promise.resolve(false);

  const key = `${item.root_id}|${item.path}`;
  const memo = nativityMemo.get(key);
  if (memo) return memo;

  const p = fetchAudioInfo(item.root_id, item.path).then((info) => {
    if (!info) return false; // no ffprobe metadata — let onError fallback catch it
    return getAudioQuality(item, info).needsTranscode;
  });
  nativityMemo.set(key, p);
  // Bound the memo like infoCache; drop-oldest keeps memory flat.
  if (nativityMemo.size > 1000) {
    const firstKey = nativityMemo.keys().next().value as string | undefined;
    if (firstKey) nativityMemo.delete(firstKey);
  }
  // Memoized promises must never surface unhandled-rejection warnings when a
  // later caller also attaches .then without catch.
  p.catch(() => {});
  return p;
}

export function audioTranscodeUrl(rootId: string, path: string, opts?: { start?: number; session?: string; format?: AudioTranscodeFormat; quality?: AudioTranscodeQuality }): string {
  // Desktop (Tauri): lossless FLAC so ALAC/lossless m4a keeps original quality.
  // Browser: default AAC.
  const format = opts?.format ?? (isTauriRuntime() ? "flac" : "aac");
  return transcodeUrl(rootId, path, { start: opts?.start, session: opts?.session, format, quality: opts?.quality });
}

export type AudioTranscodeFormat = "flac" | "flac24" | "wav" | "aac";
export type AudioTranscodeQuality = "lossless" | "high" | "medium";

let transcodeSupported: boolean | null = null;

// serverSupportsTranscode reports whether the backend has ffmpeg available for
// on-the-fly transcoding. The result is cached for the session.
export function serverSupportsTranscode(): Promise<boolean> {
  if (transcodeSupported !== null) return Promise.resolve(transcodeSupported);
  return versionApi.get()
    .then((d) => {
      transcodeSupported = !!d.transcode;
      return transcodeSupported;
    })
    .catch(() => {
      transcodeSupported = false;
      return false;
    });
}
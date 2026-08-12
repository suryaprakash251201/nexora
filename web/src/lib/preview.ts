import type { FileItem } from "../api/types";
import { get, getMediaUrl } from "../api/client";
import { getAudioQuality, fetchAudioInfo } from "./audioQuality";

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "markdown" | "text" | "none";

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "yaml", "yml", "toml", "ini", "env", "conf",
  "js", "jsx", "ts", "tsx", "html", "htm", "css", "scss", "py", "go", "sh",
  "bash", "rs", "java", "c", "cpp", "h", "sql", "csv", "log", "xml",
]);

const EDITABLE_EXT = new Set([...TEXT_EXT]);
const EDITABLE_NAMES = new Set(["dockerfile", "docker-compose.yml", "docker-compose.yaml", "makefile", ".gitignore", ".env"]);

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mkv", "mov", "avi", "m4v"]);
const AUDIO_EXT = new Set(["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma", "alac", "m4b", "oga"]);

export function previewKind(item: { mime: string; extension: string; name?: string }): PreviewKind {
  const ext = item.extension?.toLowerCase() || "";
  if (IMAGE_EXT.has(ext) || (item.mime || "").startsWith("image/")) return "image";
  if (AUDIO_EXT.has(ext) || (item.mime || "").startsWith("audio/")) return "audio";
  if (VIDEO_EXT.has(ext) || (item.mime || "").startsWith("video/")) return "video";
  if (item.mime === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown") return "markdown";
  if ((item.mime || "").startsWith("text/") || TEXT_EXT.has(ext)) return "text";
  return "none";
}

export function isEditable(item: { extension: string; name: string }): boolean {
  const lower = item.name.toLowerCase();
  if (EDITABLE_NAMES.has(lower)) return true;
  return EDITABLE_EXT.has((item.extension || "").toLowerCase());
}

export function isAudio(item: { mime: string; extension?: string }): boolean {
  const ext = (item.extension || "").toLowerCase();
  if (AUDIO_EXT.has(ext)) return true;
  return (item.mime || "").startsWith("audio/");
}

// codeLanguage returns a coarse language label for display purposes.
export { getAudioQuality, fetchAudioInfo, clearAudioInfoCache, isLosslessExtension } from "./audioQuality";
export type { AudioQualityInfo, AudioInfo, AudioTier } from "./audioQuality";

export function codeLanguage(ext: string): string {
  const map: Record<string, string> = {
    js: "JavaScript", jsx: "JavaScript", ts: "TypeScript", tsx: "TypeScript",
    py: "Python", go: "Go", rs: "Rust", java: "Java", c: "C", cpp: "C++",
    h: "C header", sh: "Shell", bash: "Shell", html: "HTML", css: "CSS",
    scss: "SCSS", json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML",
    sql: "SQL", xml: "XML", md: "Markdown", ini: "INI", csv: "CSV",
  };
  return map[ext?.toLowerCase()] || (ext ? ext.toUpperCase() : "Text");
}

export function rawUrl(rootId: string, path: string, download = false): string {
  return getMediaUrl("/files/raw", { root: rootId, path, download: download ? 1 : undefined });
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
  return typeof window !== "undefined" && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);
}

// needsAudioTranscode reports whether the webview cannot decode this audio
// file natively and playback must be routed through the server transcode
// pipeline.
//
// The extension check is fast, but .m4a/.m4b are ambiguous: they may carry
// native AAC (plays everywhere) or ALAC (Apple Lossless — no browser decoder).
// For those we probe real ffprobe metadata via /audio/info so ALAC files are
// pre-routed to transcoding instead of failing on the raw stream first (which
// cost a full error round-trip and a visible stutter on every ALAC track).
export function needsAudioTranscode(item: { extension?: string; root_id: string; path: string }): Promise<boolean> {
  const q = getAudioQuality(item);
  if (q.needsTranscode) return Promise.resolve(true);
  const ext = (item.extension || "").toLowerCase();
  if (ext === "m4a" || ext === "m4b") {
    return fetchAudioInfo(item.root_id, item.path).then((info) => {
      if (!info) return false; // no ffprobe metadata — let onError fallback catch it
      return getAudioQuality(item, info).needsTranscode;
    });
  }
  return Promise.resolve(false);
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
  return get<{ transcode?: boolean }>("/version")
    .then((d) => {
      transcodeSupported = !!d.transcode;
      return transcodeSupported;
    })
    .catch(() => {
      transcodeSupported = false;
      return false;
    });
}

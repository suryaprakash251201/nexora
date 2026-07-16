import type { FileItem } from "../api/types";
import { get } from "../api/client";

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

export function previewKind(item: { mime: string; extension: string; name?: string }): PreviewKind {
  const ext = item.extension?.toLowerCase() || "";
  if (item.mime.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (item.mime.startsWith("video/") || VIDEO_EXT.has(ext)) return "video";
  if (item.mime.startsWith("audio/")) return "audio";
  if (item.mime === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (item.mime.startsWith("text/") || TEXT_EXT.has(ext)) return "text";
  return "none";
}

export function isEditable(item: { extension: string; name: string }): boolean {
  const lower = item.name.toLowerCase();
  if (EDITABLE_NAMES.has(lower)) return true;
  return EDITABLE_EXT.has((item.extension || "").toLowerCase());
}

export function isAudio(item: { mime: string }): boolean {
  return item.mime.startsWith("audio/");
}

// codeLanguage returns a coarse language label for display purposes.
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
  return `/api/v1/files/raw?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}

export function thumbUrl(item: FileItem, size = 256): string {
  return `/api/v1/files/thumbnail?root=${encodeURIComponent(item.root_id)}&path=${encodeURIComponent(item.path)}&size=${size}`;
}

export function hasThumbnail(item: { extension: string }): boolean {
  return ["jpg", "jpeg", "png", "gif"].includes((item.extension || "").toLowerCase());
}

// TRANSCODE_EXT lists video containers that browsers cannot play natively and
// therefore need server-side transcoding to a streamable MP4.
const TRANSCODE_EXT = new Set([
  "avi", "wmv", "flv", "asf", "3gp", "vob", "mts", "m2ts", "ts", "rm", "divx",
]);

export function needsTranscode(item: { extension: string }): boolean {
  return TRANSCODE_EXT.has((item.extension || "").toLowerCase());
}

export function transcodeUrl(rootId: string, path: string): string {
  return `/api/v1/files/transcode?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`;
}

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

/** Single canonical file-type → preview-kind mapping — single source of truth for web + mobile. */

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "yaml", "yml", "toml", "ini", "env", "conf",
  "js", "jsx", "ts", "tsx", "html", "htm", "css", "scss", "py", "go", "sh",
  "bash", "rs", "java", "c", "cpp", "h", "sql", "csv", "log", "xml", "lrc",
]);
const EDITABLE_EXT = new Set([...TEXT_EXT]);
const EDITABLE_NAMES = new Set(["dockerfile", "docker-compose.yml", "docker-compose.yaml", "makefile", ".gitignore", ".env"]);

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif", "heic", "heif"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mkv", "mov", "avi", "m4v", "3gp", "flv", "wmv"]);
const AUDIO_EXT = new Set(["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma", "alac", "m4b", "oga"]);
const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "rb", "php", "java", "kt", "swift",
  "c", "h", "cpp", "hpp", "cs", "sh", "bash", "sql", "html", "css", "scss", "vue", "svelte",
]);

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "markdown" | "text" | "code" | "none" | "other";

/** Rich previewKind that mirrors web/src/lib/preview.ts logic (mime + ext, markdown distinction). */
export function previewKind(item: { mime: string; extension: string; name?: string; is_dir?: boolean } | string): PreviewKind {
  if (typeof item === "string") {
    const e = item.toLowerCase();
    if (IMAGE_EXT.has(e)) return "image";
    if (VIDEO_EXT.has(e)) return "video";
    if (AUDIO_EXT.has(e)) return "audio";
    if (e === "pdf") return "pdf";
    if (e === "md" || e === "markdown") return "markdown";
    if (CODE_EXT.has(e)) return "code";
    if (TEXT_EXT.has(e)) return "text";
    return "other";
  }
  if ((item as any).is_dir) return "other";
  const ext = item.extension?.toLowerCase() || "";
  if (IMAGE_EXT.has(ext) || (item.mime || "").startsWith("image/")) return "image";
  if (AUDIO_EXT.has(ext) || (item.mime || "").startsWith("audio/")) return "audio";
  if (VIDEO_EXT.has(ext) || (item.mime || "").startsWith("video/")) return "video";
  if (item.mime === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (CODE_EXT.has(ext)) return "code";
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

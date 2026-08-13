import { previewKind } from "../api/client";
import type { FileItem } from "../api/types";

/**
 * cleanTrackTitle — removes noise from song titles for display:
 * - leading track numbers ("01. ", "01 - ", "1) ", "01.innum konja neram")
 * - trailing parenthetical/bracket tags ("(from maryaan)", "[Remastered]")
 * - file extensions (defensive)
 *
 * "01.innum konja neram(from maryaan)" → "innum konja neram"
 */
export function cleanTrackTitle(name: string): string {
  if (!name) return name;
  let t = name.replace(/\.[^.]+$/, "");
  // Leading track number followed by a separator (., -, –, —, ), _, space).
  t = t.replace(/^\s*\d{1,3}\s*[.\-–—)_]\s*/, "");
  // Trailing parenthetical / bracket groups (repeat to drop several).
  let prev: string;
  do {
    prev = t;
    t = t.replace(/\s*[\(（\[].*?[\)）\]]\s*$/, "");
  } while (t !== prev);
  return t.trim();
}

const KIND_ICON: Record<string, [string, string]> = {
  image: ["image-outline", "#5B8CFF"],
  video: ["play-circle-outline", "#A78BFA"],
  audio: ["music-circle-outline", "#2DD4BF"],
  pdf: ["file-pdf-box", "#EF4444"],
  markdown: ["language-markdown-outline", "#35D3FF"],
  text: ["file-document-outline", "#8892A8"],
  code: ["code-braces", "#FBBF24"],
  other: ["file-outline", "#8892A8"],
};

const EXT_COLORS: Record<string, string> = {
  zip: "#F59E0B", rar: "#F59E0B", "7z": "#F59E0B", tar: "#F59E0B", gz: "#F59E0B",
  xlsx: "#22C55E", xls: "#22C55E", csv: "#22C55E",
  docx: "#3B82F6", doc: "#3B82F6", rtf: "#3B82F6",
  pptx: "#F97316", ppt: "#F97316",
  json: "#FBBF24", yaml: "#FBBF24", yml: "#FBBF24", xml: "#FBBF24",
  go: "#35D3FF", py: "#35D3FF", js: "#FBBF24", ts: "#5B8CFF", rs: "#F97316",
  exe: "#A78BFA", app: "#A78BFA", dmg: "#A78BFA", iso: "#A78BFA",
};

/** Icon + accent color for a file or folder, keyed on preview kind. */
export function fileIconFor(item: FileItem, defaultAccent: string = "#5B8CFF"): { name: string; color: string } {
  if (item.is_dir) return { name: "folder", color: defaultAccent };
  const kind = previewKind(item);
  const [name, color] = KIND_ICON[kind] || KIND_ICON.other;
  const extColor = EXT_COLORS[(item.extension || "").toLowerCase()];
  return { name, color: extColor || color };
}

/** True for audio files (drives album-art covers in rows/grids). */
export function isAudioFile(item: FileItem): boolean {
  return !item.is_dir && previewKind(item) === "audio";
}

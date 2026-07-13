import {
  File,
  FileText,
  Folder,
  Image,
  Film,
  Music,
  Archive,
  FileCode,
  FileJson,
  Sheet,
  Presentation,
  File as FileIconBase,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function iconForFile(item: { is_dir: boolean; mime: string; extension: string }): LucideIcon {
  if (item.is_dir) return Folder;
  const m = item.mime;
  const ext = item.extension.toLowerCase();
  if (m.startsWith("image/")) return Image;
  if (m.startsWith("video/")) return Film;
  if (m.startsWith("audio/")) return Music;
  if (m === "application/pdf") return FileText;
  if (m.includes("zip") || m.includes("tar") || ["zip", "tar", "gz", "7z", "rar"].includes(ext)) return Archive;
  if (["json", "yaml", "yml", "toml", "ini", "xml"].includes(ext)) return FileJson;
  if (["js", "ts", "jsx", "tsx", "go", "py", "sh", "bash", "rs", "java", "c", "cpp", "h", "css", "html", "rb", "php"].includes(ext))
    return FileCode;
  if (["md", "markdown", "txt", "log"].includes(ext)) return FileText;
  if (["csv", "xls", "xlsx"].includes(ext)) return Sheet;
  if (["ppt", "pptx", "key", "odp"].includes(ext)) return Presentation;
  return FileIconBase;
}

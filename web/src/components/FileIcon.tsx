import {
  FileText,
  FileType,
  FileSpreadsheet,
  Folder,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  FileCode,
  FileJson,
  Presentation,
  File as FileIconBase,
  Database,
  Terminal,
  Settings,
  Cpu,
  Figma,
  Package,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type IconColor = "blue" | "red" | "green" | "yellow" | "purple" | "cyan" | "orange" | "gray" | "pink";

export function iconForFile(item: { is_dir: boolean; mime: string; extension: string }): { icon: LucideIcon; color: IconColor } {
  if (item.is_dir) return { icon: Folder, color: "blue" };
  const m = item.mime;
  const ext = item.extension.toLowerCase();
  
  if (m.startsWith("image/")) return { icon: ImageIcon, color: "purple" };
  if (m.startsWith("video/")) return { icon: Film, color: "pink" };
  if (m.startsWith("audio/")) return { icon: Music, color: "cyan" };
  
  if (m === "application/pdf" || ext === "pdf") return { icon: FileText, color: "red" };
  if (m.includes("zip") || m.includes("tar") || ["zip", "tar", "gz", "7z", "rar", "iso"].includes(ext)) return { icon: Archive, color: "orange" };
  if (["json", "yaml", "yml", "toml", "ini", "xml", "webmanifest"].includes(ext)) return { icon: FileJson, color: "yellow" };
  if (["js", "ts", "jsx", "tsx", "go", "py", "sh", "bash", "rs", "java", "c", "cpp", "h", "rb", "php"].includes(ext)) return { icon: FileCode, color: "blue" };
  if (["html", "css", "scss", "less"].includes(ext)) return { icon: FileCode, color: "orange" };
  if (["sql", "db", "sqlite", "mdb"].includes(ext)) return { icon: Database, color: "gray" };
  if (["exe", "app", "dmg", "deb", "rpm", "apk"].includes(ext)) return { icon: Package, color: "green" };
  if (["bat", "cmd", "ps1"].includes(ext)) return { icon: Terminal, color: "gray" };
  if (["env", "config", "cfg", "conf"].includes(ext)) return { icon: Settings, color: "gray" };
  if (["dll", "so", "sys", "bin"].includes(ext)) return { icon: Cpu, color: "gray" };
  if (["fig", "sketch", "ai", "psd"].includes(ext)) return { icon: Figma, color: "pink" };
  
  if (["md", "markdown", "txt", "log", "rtf"].includes(ext)) return { icon: FileText, color: "gray" };
  
  // Office documents
  if (["doc", "docx", "odt", "pages"].includes(ext)) return { icon: FileType, color: "blue" };
  if (["csv", "xls", "xlsx", "ods", "numbers"].includes(ext)) return { icon: FileSpreadsheet, color: "green" };
  if (["ppt", "pptx", "key", "odp", "pps", "ppsx"].includes(ext)) return { icon: Presentation, color: "red" };
  
  return { icon: FileIconBase, color: "gray" };
}

export const colorClasses: Record<IconColor, string> = {
  blue: "text-blue-500 bg-blue-500/10",
  red: "text-red-500 bg-red-500/10",
  green: "text-green-500 bg-green-500/10",
  yellow: "text-yellow-500 bg-yellow-500/10",
  purple: "text-purple-500 bg-purple-500/10",
  cyan: "text-cyan-500 bg-cyan-500/10",
  orange: "text-orange-500 bg-orange-500/10",
  gray: "text-gray-500 bg-gray-500/10",
  pink: "text-pink-500 bg-pink-500/10",
};

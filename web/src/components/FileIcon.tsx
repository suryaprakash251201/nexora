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

export type IconColor = "blue" | "red" | "green" | "yellow" | "purple" | "cyan" | "orange" | "gray" | "pink" | "emerald" | "amber";

export function iconForFile(item: { is_dir: boolean; mime: string; extension: string }): { icon: LucideIcon; color: IconColor } {
  if (item.is_dir) return { icon: Folder, color: "blue" };
  const m = item.mime || "";
  const ext = (item.extension || "").toLowerCase();
  
  if (m.startsWith("image/")) return { icon: ImageIcon, color: "emerald" };
  if (m.startsWith("video/")) return { icon: Film, color: "purple" };
  if (m.startsWith("audio/")) return { icon: Music, color: "pink" };
  
  if (m === "application/pdf" || ext === "pdf") return { icon: FileText, color: "red" };
  if (m.includes("zip") || m.includes("tar") || ["zip", "tar", "gz", "7z", "rar", "iso"].includes(ext)) return { icon: Archive, color: "amber" };
  if (["json", "yaml", "yml", "toml", "ini", "xml", "webmanifest", "env"].includes(ext)) return { icon: FileJson, color: "yellow" };
  if (["js", "ts", "jsx", "tsx", "go", "py", "sh", "bash", "rs", "java", "c", "cpp", "h", "rb", "php"].includes(ext)) return { icon: FileCode, color: "orange" };
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

export const colorClasses: Record<string, string> = {
  blue: "text-blue-400 bg-blue-500/15",
  red: "text-red-400 bg-red-500/15",
  green: "text-green-400 bg-green-500/15",
  emerald: "text-emerald-400 bg-emerald-500/15",
  yellow: "text-yellow-400 bg-yellow-500/15",
  amber: "text-amber-400 bg-amber-500/15",
  purple: "text-purple-400 bg-purple-500/15",
  cyan: "text-cyan-400 bg-cyan-500/15",
  orange: "text-orange-400 bg-orange-500/15",
  gray: "text-slate-400 bg-slate-500/10",
  pink: "text-pink-400 bg-pink-500/15",
};

export const iconGlowClasses: Record<string, string> = {
  blue: "shadow-[0_0_14px_rgba(59,130,246,0.12)] border-blue-500/20 hover:shadow-[0_0_20px_rgba(59,130,246,0.2)]",
  red: "shadow-[0_0_14px_rgba(239,68,68,0.12)] border-red-500/20 hover:shadow-[0_0_20px_rgba(239,68,68,0.2)]",
  green: "shadow-[0_0_14px_rgba(34,197,94,0.12)] border-green-500/20 hover:shadow-[0_0_20px_rgba(34,197,94,0.2)]",
  emerald: "shadow-[0_0_14px_rgba(16,185,129,0.12)] border-emerald-500/20 hover:shadow-[0_0_20px_rgba(16,185,129,0.2)]",
  yellow: "shadow-[0_0_14px_rgba(234,179,8,0.12)] border-yellow-500/20 hover:shadow-[0_0_20px_rgba(234,179,8,0.2)]",
  amber: "shadow-[0_0_14px_rgba(245,158,11,0.12)] border-amber-500/20 hover:shadow-[0_0_20px_rgba(245,158,11,0.2)]",
  purple: "shadow-[0_0_14px_rgba(168,85,247,0.12)] border-purple-500/20 hover:shadow-[0_0_20px_rgba(168,85,247,0.2)]",
  cyan: "shadow-[0_0_14px_rgba(6,182,212,0.12)] border-cyan-500/20 hover:shadow-[0_0_20px_rgba(6,182,212,0.2)]",
  orange: "shadow-[0_0_14px_rgba(249,115,22,0.12)] border-orange-500/20 hover:shadow-[0_0_20px_rgba(249,115,22,0.2)]",
  gray: "shadow-[0_0_14px_rgba(100,116,139,0.08)] border-slate-500/15 hover:shadow-[0_0_20px_rgba(100,116,139,0.15)]",
  pink: "shadow-[0_0_14px_rgba(236,72,153,0.12)] border-pink-500/20 hover:shadow-[0_0_20px_rgba(236,72,153,0.2)]",
};

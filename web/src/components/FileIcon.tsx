import { customIconMap } from "./icons/file-icons";
import type { FC, SVGProps } from "react";
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

export function iconForFile(item: { is_dir: boolean; mime: string; extension: string }): { icon: LucideIcon; color: IconColor; customIcon?: FC<SVGProps<SVGSVGElement> & { size?: number }> } {
  if (item.is_dir) return { icon: Folder, color: "blue" };
  const m = item.mime || "";
  const ext = (item.extension || "").toLowerCase();
  
  // Check for custom brand icon first
  const custom = customIconMap[ext];
  
  if (m.startsWith("image/")) return { icon: ImageIcon, color: "emerald", customIcon: custom };
  if (m.startsWith("video/")) return { icon: Film, color: "purple", customIcon: custom };
  if (m.startsWith("audio/")) return { icon: Music, color: "pink", customIcon: custom };
  
  if (m === "application/pdf" || ext === "pdf") return { icon: FileText, color: "red", customIcon: custom };
  if (m.includes("zip") || m.includes("tar") || ["zip", "tar", "gz", "7z", "rar", "iso"].includes(ext)) return { icon: Archive, color: "amber", customIcon: custom };
  if (["json", "yaml", "yml", "toml", "ini", "xml", "webmanifest", "env"].includes(ext)) return { icon: FileJson, color: "yellow", customIcon: custom };
  if (["js", "ts", "jsx", "tsx", "go", "py", "sh", "bash", "rs", "java", "c", "cpp", "h", "rb", "php"].includes(ext)) return { icon: FileCode, color: "orange", customIcon: custom };
  if (["html", "css", "scss", "less"].includes(ext)) return { icon: FileCode, color: "orange", customIcon: custom };
  if (["sql", "db", "sqlite", "mdb"].includes(ext)) return { icon: Database, color: "gray", customIcon: custom };
  if (["exe", "app", "dmg", "deb", "rpm", "apk"].includes(ext)) return { icon: Package, color: "green", customIcon: custom };
  if (["bat", "cmd", "ps1"].includes(ext)) return { icon: Terminal, color: "gray", customIcon: custom };
  if (["env", "config", "cfg", "conf"].includes(ext)) return { icon: Settings, color: "gray", customIcon: custom };
  if (["dll", "so", "sys", "bin"].includes(ext)) return { icon: Cpu, color: "gray", customIcon: custom };
  if (["fig", "sketch", "ai", "psd"].includes(ext)) return { icon: Figma, color: "pink", customIcon: custom };
  
  if (["md", "markdown", "txt", "log", "rtf"].includes(ext)) return { icon: FileText, color: "gray", customIcon: custom };
  
  // Office documents
  if (["doc", "docx", "odt", "pages"].includes(ext)) return { icon: FileType, color: "blue", customIcon: custom };
  if (["csv", "xls", "xlsx", "ods", "numbers"].includes(ext)) return { icon: FileSpreadsheet, color: "green", customIcon: custom };
  if (["ppt", "pptx", "key", "odp", "pps", "ppsx"].includes(ext)) return { icon: Presentation, color: "red", customIcon: custom };
  
  return { icon: FileIconBase, color: "gray", customIcon: custom };
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

export type IconSize = "sm" | "md" | "lg" | "xl";

export const iconSizeClasses: Record<IconSize, { container: string; icon: string; customIcon: number }> = {
  sm: { container: "h-9 w-9", icon: "h-5 w-5", customIcon: 20 },
  md: { container: "h-12 w-12", icon: "h-6 w-6", customIcon: 28 },
  lg: { container: "h-16 w-16", icon: "h-8 w-8", customIcon: 36 },
  xl: { container: "h-20 w-20", icon: "h-10 w-10", customIcon: 44 },
};

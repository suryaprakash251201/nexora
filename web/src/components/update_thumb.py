import sys
with open('/home/suryaprakash/Documents/Projects/nexora/web/src/components/FileThumb.tsx', 'r') as f:
    lines = f.readlines()

new_content = """import { useState } from "react";
import { FileItem } from "../api/types";
import { iconForFile, colorClasses } from "./FileIcon";
import { thumbUrl } from "../lib/preview";
import { Folder, Music, Video, FileCode, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];

export type FolderVariant = "default" | "music" | "video" | "image" | "archive" | "documents" | "code" | "design";

const folderIconColors: Record<FolderVariant, string> = {
  default: "text-white",
  music: "text-[rgba(236,72,153,0.95)]",
  video: "text-[rgba(168,85,247,0.95)]",
  image: "text-[rgba(52,211,153,0.95)]",
  archive: "text-[rgba(245,158,11,0.95)]",
  documents: "text-[rgba(251,191,36,0.95)]",
  code: "text-[rgba(53,211,255,0.95)]",
  design: "text-[rgba(251,113,133,0.95)]",
};

export function FolderTile({ large, item, variant = "default" }: { large?: boolean; item?: FileItem; variant?: FolderVariant }) {
  const dim = large ? "h-16 w-16" : "h-9 w-9";
  const iconColor = folderIconColors[variant] || folderIconColors.default;

  return (
    <div className={cn(`nexora-folder nexora-folder-${variant}`, dim)}>
      <Folder className={cn("nexora-folder-icon", large ? "h-8 w-8" : "h-5 w-5", iconColor, "drop-shadow-md")} />
    </div>
  );
}

function detectFolderVariant(name: string): FolderVariant {
  const lower = name.toLowerCase();
  if (/music|audio|songs?|playlists?|albums?|tracks?/i.test(lower)) return "music";
  if (/videos?|movies?|films?|clips?|recordings?/i.test(lower)) return "video";
  if (/images?|photos?|pictures?|gallery|screenshots?|wallpapers?/i.test(lower)) return "image";
  if (/archives?|backups?|compressed|zips?/i.test(lower)) return "archive";
  if (/docs?|documents?|papers?|notes?|reports?|invoices?/i.test(lower)) return "documents";
  if (/code|src|source|scripts?|projects?|dev|lib|packages?|node_modules|vendor|\.git/i.test(lower)) return "code";
  if (/design|assets?|ui|ux|mockups?|wireframes?|figma|sketch/i.test(lower)) return "design";
  return "default";
}

export function FileThumb({ it, large, fill }: { it: FileItem; large?: boolean; fill?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ext = it.extension.toLowerCase();

  const isImage = it.mime.startsWith("image/") || IMAGE_EXT.includes(ext);
  const isAudio = it.mime.startsWith("audio/") || ["mp3", "flac", "wav", "ogg", "m4a"].includes(ext);
  const isVideo = it.mime.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi"].includes(ext);
  const dim = fill ? "h-full w-full" : large ? "h-16 w-16" : "h-9 w-9";

  if (it.is_dir) {
    const variant = detectFolderVariant(it.name);
    return <FolderTile large={large} item={it} variant={variant} />;
  }

  if (isAudio && !isImage) {
    return (
      <div className={cn("nexora-folder nexora-folder-music", dim)}>
        <Music className={cn("nexora-folder-icon", large ? "h-8 w-8" : "h-5 w-5", "text-[rgba(236,72,153,0.95)]")} />
      </div>
    );
  }

  if (isVideo && !isImage) {
    return (
      <div className={cn("nexora-folder nexora-folder-video", dim)}>
        <Video className={cn("nexora-folder-icon", large ? "h-8 w-8" : "h-5 w-5", "text-[rgba(168,85,247,0.95)]")} />
      </div>
    );
  }

  if (!isImage || failed) {
    const { icon: Icon, color } = iconForFile(it);
    const colorClass = colorClasses[color];
    return (
      <div className={cn("grid place-items-center rounded-xl transition-all duration-300 group-hover:scale-105 shadow-sm border border-white/5", colorClass, dim)}>
        <Icon className={cn(fill ? "h-10 w-10" : large ? "h-8 w-8" : "h-5 w-5", "opacity-85 drop-shadow-sm")} />
      </div>
    );
  }

  return (
    <div className={cn(dim, "rounded-xl overflow-hidden relative shadow-sm group-hover:shadow-md transition-all duration-300")}>
      {!loaded && (
        <div className="absolute inset-0 skeleton" />
      )}
      <img
        src={thumbUrl(it)}
        alt=""
        className={cn(
          "w-full h-full object-cover transition-all duration-500 ease-out group-hover:scale-110",
          loaded ? "opacity-100" : "opacity-0"
        )}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
"""

with open('/home/suryaprakash/Documents/Projects/nexora/web/src/components/FileThumb.tsx', 'w') as f:
    f.write(new_content)

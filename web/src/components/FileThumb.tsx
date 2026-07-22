import { useState } from "react";
import { FileItem } from "../api/types";
import { iconForFile, colorClasses } from "./FileIcon";
import { thumbUrl } from "../lib/preview";
import { Folder, Music, Video } from "lucide-react";
import { cn } from "@/lib/utils";

export const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];

export function FolderTile({ large, item }: { large?: boolean; item?: FileItem }) {
  const dim = large ? "h-16 w-16" : "h-9 w-9";

  return (
    <div className={cn("nexora-folder nexora-folder-default", dim)}>
      <Folder className={cn("nexora-folder-icon", large ? "h-8 w-8" : "h-5 w-5", "text-white drop-shadow-md")} />
    </div>
  );
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
    return <FolderTile large={large} item={it} />;
  }

  if (isAudio && !isImage) {
    return (
      <div className={cn("nexora-folder nexora-folder-music", dim)}>
        <Music className={cn("nexora-folder-icon", large ? "h-8 w-8" : "h-5 w-5", "text-[rgba(236,72,153,0.9)]")} />
      </div>
    );
  }

  if (isVideo && !isImage) {
    return (
      <div className={cn("nexora-folder nexora-folder-video", dim)}>
        <Video className={cn("nexora-folder-icon", large ? "h-8 w-8" : "h-5 w-5", "text-[rgba(168,85,247,0.9)]")} />
      </div>
    );
  }

  if (!isImage || failed) {
    const { icon: Icon, color } = iconForFile(it);
    const colorClass = colorClasses[color];
    return (
      <div className={cn("grid place-items-center rounded-xl transition-transform duration-300 group-hover:scale-105 shadow-sm", colorClass, dim)}>
        <Icon className={cn(fill ? "h-10 w-10" : large ? "h-8 w-8" : "h-5 w-5", "opacity-80")} />
      </div>
    );
  }

  return (
    <div className={cn(dim, "rounded-xl overflow-hidden relative shadow-sm group-hover:shadow-md transition-shadow duration-300")}>
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

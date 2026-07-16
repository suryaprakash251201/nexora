import { useState } from "react";
import { Folder } from "lucide-react";
import { FileItem } from "../api/types";
import { iconForFile } from "./FileIcon";
import { thumbUrl } from "../lib/preview";

export const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];

export function FolderTile({ large }: { large?: boolean }) {
  return (
    <div className={`grid place-items-center rounded-xl bg-gradient-to-br from-accent/30 to-accent/10 text-accent ${large ? "h-16 w-16" : "h-9 w-9"}`}>
      <Folder className={large ? "h-8 w-8" : "h-5 w-5"} />
    </div>
  );
}

// FileThumb renders an embedded cover (audio) or image thumbnail, falling back
// to a type icon when no preview is available.
export function FileThumb({ it, large, fill }: { it: FileItem; large?: boolean; fill?: boolean }) {
  const [failed, setFailed] = useState(false);
  const ext = it.extension.toLowerCase();
  const isImage = it.mime.startsWith("image/") || IMAGE_EXT.includes(ext);
  const isAudioCover = it.mime.startsWith("audio/") || ext === "mp3" || ext === "flac";
  const dim = fill ? "h-full w-full" : large ? "h-16 w-16" : "h-9 w-9";
  if ((!isImage && !isAudioCover) || failed) {
    const Icon = iconForFile(it);
    return (
      <div className={`grid place-items-center rounded-xl bg-surface-muted ${dim}`}>
        <Icon className={`${fill ? "h-10 w-10" : large ? "h-8 w-8" : "h-5 w-5"} text-content-muted`} />
      </div>
    );
  }
  return (
    <img
      src={thumbUrl(it)}
      alt=""
      className={`${dim} object-cover rounded-xl ring-1 ring-border`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

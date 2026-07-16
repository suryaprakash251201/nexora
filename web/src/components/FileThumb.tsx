import { useState } from "react";
import { FileItem } from "../api/types";
import { iconForFile, colorClasses } from "./FileIcon";
import { thumbUrl } from "../lib/preview";

export const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];

export function FolderTile({ large }: { large?: boolean }) {
  const { icon: Icon, color } = iconForFile({ is_dir: true, mime: "", extension: "" });
  const colorClass = colorClasses[color];

  return (
    <div className={`grid place-items-center rounded-xl transition-transform duration-300 group-hover:scale-105 shadow-sm ${colorClass} ${large ? "h-16 w-16" : "h-9 w-9"}`}>
      <Icon className={large ? "h-8 w-8" : "h-5 w-5"} />
    </div>
  );
}

// FileThumb renders an embedded cover (audio) or image thumbnail, falling back
// to a type icon when no preview is available.
export function FileThumb({ it, large, fill }: { it: FileItem; large?: boolean; fill?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ext = it.extension.toLowerCase();
  
  const isImage = it.mime.startsWith("image/") || IMAGE_EXT.includes(ext);
  const isAudioCover = it.mime.startsWith("audio/") || ext === "mp3" || ext === "flac";
  const dim = fill ? "h-full w-full" : large ? "h-16 w-16" : "h-9 w-9";
  
  if ((!isImage && !isAudioCover) || failed) {
    const { icon: Icon, color } = iconForFile(it);
    const colorClass = colorClasses[color];
    return (
      <div className={`grid place-items-center rounded-xl transition-transform duration-300 group-hover:scale-105 shadow-sm ${colorClass} ${dim}`}>
        <Icon className={`${fill ? "h-10 w-10" : large ? "h-8 w-8" : "h-5 w-5"} opacity-80`} />
      </div>
    );
  }
  
  return (
    <div className={`${dim} rounded-xl overflow-hidden relative shadow-sm group-hover:shadow-md transition-shadow duration-300`}>
      {!loaded && (
        <div className="absolute inset-0 skeleton" />
      )}
      <img
        src={thumbUrl(it)}
        alt=""
        className={`w-full h-full object-cover transition-all duration-500 ease-out group-hover:scale-110 ${loaded ? "opacity-100" : "opacity-0"}`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

import { useState } from "react";
import { FileItem } from "../api/types";
import { iconForFile, colorClasses } from "./FileIcon";
import { thumbUrl } from "../lib/preview";
import { Music, Video } from "lucide-react";

export const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];

export function FolderTile({ large }: { large?: boolean }) {
  const { icon: Icon } = iconForFile({ is_dir: true, mime: "", extension: "" });

  return (
    <div className={`relative grid place-items-center rounded-xl transition-transform duration-300 group-hover:scale-105 shadow-sm overflow-hidden ${large ? "h-16 w-16" : "h-9 w-9"}`}>
      <div className="absolute inset-0 bg-gradient-to-br from-blue-400/20 to-indigo-500/30 backdrop-blur-sm border border-blue-400/20 rounded-xl"></div>
      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent"></div>
      <Icon className={`relative z-10 text-indigo-400 drop-shadow-md ${large ? "h-8 w-8" : "h-5 w-5"}`} />
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
  const isAudio = it.mime.startsWith("audio/") || ["mp3", "flac", "wav", "ogg", "m4a"].includes(ext);
  const isVideo = it.mime.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi"].includes(ext);
  const dim = fill ? "h-full w-full" : large ? "h-16 w-16" : "h-9 w-9";
  
  // For audio files without cover art, show music icon directly
  if (isAudio && !isImage) {
    return (
      <div className={`grid place-items-center rounded-xl transition-transform duration-300 group-hover:scale-105 shadow-sm bg-gradient-to-br from-emerald-400/20 to-teal-500/30 border border-emerald-400/20 ${dim}`}>
        <Music className={`text-emerald-400 drop-shadow-md ${large ? "h-8 w-8" : "h-5 w-5"}`} />
      </div>
    );
  }
  
  // For video files without thumbnail, show video icon
  if (isVideo && !isImage) {
    return (
      <div className={`grid place-items-center rounded-xl transition-transform duration-300 group-hover:scale-105 shadow-sm bg-gradient-to-br from-purple-400/20 to-pink-500/30 border border-purple-400/20 ${dim}`}>
        <Video className={`text-purple-400 drop-shadow-md ${large ? "h-8 w-8" : "h-5 w-5"}`} />
      </div>
    );
  }
  
  if ((!isImage) || failed) {
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

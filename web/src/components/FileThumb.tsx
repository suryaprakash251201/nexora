import { useState } from "react";
import { FileItem } from "../api/types";
import { iconForFile, colorClasses, iconGlowClasses, type IconSize } from "./FileIcon";
import { thumbUrl } from "../lib/preview";
import { Music, Video } from "lucide-react";
import { cn } from "@/lib/utils";

export const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];

export type FolderVariant = "default" | "music" | "video" | "image" | "archive" | "documents" | "code" | "design";

export function FolderTile({ large, item, iconSize }: { large?: boolean; item?: FileItem; iconSize?: IconSize }) {
  const dim = iconSize ? ({ sm: "h-16 w-16", md: "h-20 w-20", lg: "h-24 w-24", xl: "h-28 w-28" }[iconSize]) : large ? "" : "h-16 w-16";
  const iconDim = iconSize ? ({ sm: "h-12 w-12", md: "h-14 w-14", lg: "h-16 w-16", xl: "h-20 w-20" }[iconSize]) : large ? "" : "h-12 w-12";

  const sizeMap: Record<string, number> = { "h-12": 48, "h-14": 56, "h-16": 64, "h-20": 80 };
  const numericSize = sizeMap[iconDim.split(' ')[0]] || 64;

  // Grid view (large): use exact pixel sizes
  if (large) {
    return (
      <div className="nexora-folder" style={{ width: 140, height: 140, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src="/folder.png" alt="folder" width={100} height={100} />
      </div>
    );
  }

  return (
    <div className={cn(`nexora-folder`, dim)}>
      <img
        src="/folder.png"
        alt="folder"
        width={numericSize}
        height={numericSize}
      />
    </div>
  );
}

export function detectFolderVariant(name: string): FolderVariant {
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
  const ext = (it.extension || "").toLowerCase();

  const isImage = it.mime.startsWith("image/") || IMAGE_EXT.includes(ext);
  const isAudio = it.mime.startsWith("audio/") || ["mp3", "flac", "wav", "ogg", "m4a"].includes(ext);
  const isVideo = it.mime.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi"].includes(ext);
  const dim = fill ? "h-full w-full" : large ? "h-16 w-16" : "h-9 w-9";

  if (it.is_dir) {
    return <FolderTile large={large} item={it} />;
  }

  if (isAudio && !isImage) {
    return <AudioThumb it={it} large={large} fill={fill} />;
  }

  if (isVideo && !isImage) {
    return (
      <div className={cn("nexora-folder nexora-folder-video", dim)}>
        <Video className={cn("nexora-folder-icon", large ? "h-8 w-8" : "h-5 w-5", "text-[rgba(168,85,247,0.95)]")} />
      </div>
    );
  }

  if (!isImage || failed) {
    const { icon: Icon, color, customIcon: CustomIcon } = iconForFile(it);
    const colorClass = colorClasses[color];
    const glowClass = iconGlowClasses[color];
    const iconDim = fill ? "h-10 w-10" : large ? "h-10 w-10" : "h-5 w-5";
    const customSize = fill ? 64 : large ? 72 : 20;
    return (
      <div className={cn("grid place-items-center rounded-xl transition-all duration-300 group-hover:scale-105 border", colorClass, glowClass, dim)}>
        {CustomIcon ? (
          <CustomIcon size={customSize} className="drop-shadow-sm" />
        ) : (
          <Icon className={cn(iconDim, "opacity-85 drop-shadow-sm")} />
        )}
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
          "w-full h-full object-cover transition-all duration-500 ease-out group-hover:scale-105",
          loaded ? "opacity-100 blur-0" : "opacity-0 blur-sm"
        )}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
      {/* Type badge overlay */}
      {loaded && !fill && (
        <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase bg-black/60 text-white/80 backdrop-blur-sm">
          {it.extension.toUpperCase()}
        </div>
      )}
    </div>
  );
}

// AudioThumb attempts to show embedded album art for audio files,
// falling back to a music icon if no cover is available.
function AudioThumb({ it, large, fill }: { it: FileItem; large?: boolean; fill?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dim = fill ? "h-full w-full" : large ? "h-16 w-16" : "h-9 w-9";

  return (
    <div className={cn(dim, "rounded-xl overflow-hidden relative shadow-sm group-hover:shadow-md transition-all duration-300")}>
      {!loaded && (
        <div className="absolute inset-0 skeleton" />
      )}
      {!failed ? (
        <>
          <img
            src={thumbUrl(it)}
            alt=""
            className={cn(
              "w-full h-full object-cover transition-all duration-500 ease-out group-hover:scale-105",
              loaded ? "opacity-100 blur-0" : "opacity-0 blur-sm"
            )}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
          {loaded && !fill && (
            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase bg-black/60 text-white/80 backdrop-blur-sm">
              {it.extension.toUpperCase()}
            </div>
          )}
        </>
      ) : (
        <div className={cn("nexora-folder nexora-folder-music grid place-items-center", dim)}>
          <Music className={cn("nexora-folder-icon", large ? "h-8 w-8" : "h-5 w-5", "text-[rgba(236,72,153,0.95)]")} />
        </div>
      )}
    </div>
  );
}

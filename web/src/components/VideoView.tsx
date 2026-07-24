import { useEffect } from "react";
import { ArrowLeft, Download, Share2 } from "lucide-react";
import type { FileItem } from "../api/types";
import { rawUrl } from "../lib/preview";
import MediaPlayer from "./MediaPlayer";

export default function VideoView({
  item,
  rootId,
  onClose,
  onShare,
}: {
  item: FileItem;
  rootId: string;
  onClose: () => void;
  onShare?: (item: FileItem) => void;
}) {
  const url = rawUrl(rootId, item.path);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sizeStr = item.size > 0
    ? item.size >= 1073741824
      ? `${(item.size / 1073741824).toFixed(1)} GB`
      : item.size >= 1048576
        ? `${(item.size / 1048576).toFixed(1)} MB`
        : item.size >= 1024
          ? `${(item.size / 1024).toFixed(1)} KB`
          : `${item.size} B`
    : "";

  return (
    <div className="fixed inset-0 z-[80] flex h-[100dvh] min-h-0 flex-col bg-black text-white">
      <div className="z-10 flex shrink-0 items-center justify-between border-b border-white/10 bg-black/80 px-3 py-2 backdrop-blur-md sm:px-4 sm:py-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            title="Back to files (Esc)"
            aria-label="Close video player"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="min-w-0 truncate font-semibold text-white">{item.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onShare && (
            <button
              onClick={() => onShare(item)}
              className="p-2 rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              title="Share"
              aria-label="Share video"
            >
              <Share2 className="h-5 w-5" />
            </button>
          )}
          <a
            href={rawUrl(rootId, item.path, true)}
            download
            className="p-2 rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            title="Download video"
            aria-label="Download video"
          >
            <Download className="h-5 w-5" />
          </a>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
        <MediaPlayer kind="video" url={url} item={item} autoPlay />
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-white/10 bg-black/80 px-3 py-2 text-xs text-white/60 backdrop-blur-md sm:px-4">
        {sizeStr && <span>{sizeStr}</span>}
        {item.modified && (
          <span className="hidden sm:inline">
            {new Date(item.modified).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
        <span className="ml-auto shrink-0 truncate font-medium text-white/80">{item.extension.toUpperCase()}</span>
      </div>
    </div>
  );
}

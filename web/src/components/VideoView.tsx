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
      if (e.key === "Escape") onClose();
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
    <div className="h-full flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 bg-surface/95 backdrop-blur-md border-b border-border/50 shrink-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-muted transition-colors text-content-muted hover:text-content"
            title="Back (Esc)"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="font-semibold truncate">{item.name}</span>
        </div>
        <div className="flex items-center gap-1">
          {onShare && (
            <button
              onClick={() => onShare(item)}
              className="p-2 rounded-lg hover:bg-surface-muted transition-colors text-content-muted hover:text-content"
              title="Share"
            >
              <Share2 className="h-5 w-5" />
            </button>
          )}
          <a
            href={rawUrl(rootId, item.path, true)}
            download
            className="p-2 rounded-lg hover:bg-surface-muted transition-colors text-content-muted hover:text-content"
            title="Download"
          >
            <Download className="h-5 w-5" />
          </a>
        </div>
      </div>

      <div className="flex-1 relative bg-black flex items-center justify-center min-h-0">
        <MediaPlayer kind="video" url={url} item={item} autoPlay />
      </div>

      <div className="flex items-center gap-4 px-4 py-2 bg-surface/95 backdrop-blur-md border-t border-border/50 text-xs text-content-muted shrink-0">
        {sizeStr && <span>{sizeStr}</span>}
        {item.modified && (
          <span>
            {new Date(item.modified).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
        <span className="truncate ml-auto">{item.extension.toUpperCase()}</span>
      </div>
    </div>
  );
}

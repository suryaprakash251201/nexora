import { useState } from "react";
import { Folder } from "lucide-react";
import { FileItem } from "../api/types";
import { iconForFile } from "./FileIcon";
import { formatBytes, formatDate } from "../lib/format";
import { thumbUrl } from "../lib/preview";
import { useUI } from "../store";

const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];

function FolderTile({ large }: { large?: boolean }) {
  return (
    <div className={`grid place-items-center rounded-xl bg-gradient-to-br from-accent/30 to-accent/10 text-accent ${large ? "h-16 w-16" : "h-9 w-9"}`}>
      <Folder className={large ? "h-8 w-8" : "h-5 w-5"} />
    </div>
  );
}

// FileThumb renders an embedded cover (audio) or image thumbnail, falling back
// to a type icon when no preview is available.
function FileThumb({ it, large }: { it: FileItem; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const ext = it.extension.toLowerCase();
  const isImage = it.mime.startsWith("image/") || IMAGE_EXT.includes(ext);
  const isAudioCover = it.mime.startsWith("audio/") || ext === "mp3" || ext === "flac";
  const dim = large ? "h-16 w-16" : "h-9 w-9";
  if ((!isImage && !isAudioCover) || failed) {
    const Icon = iconForFile(it);
    return (
      <div className={`grid place-items-center rounded-xl bg-white/5 ${dim}`}>
        <Icon className={`${large ? "h-8 w-8" : "h-5 w-5"} text-content-muted`} />
      </div>
    );
  }
  return (
    <img
      src={thumbUrl(it)}
      alt=""
      className={`${dim} object-cover rounded-xl ring-1 ring-white/10`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function FileBrowser({
  items,
  loading,
  viewMode,
  selection,
  canWrite,
  onOpen,
  onSelect,
  onContextMenu,
}: {
  items: FileItem[];
  loading: boolean;
  viewMode: "list" | "grid";
  selection: Set<string>;
  canWrite: boolean;
  onOpen: (item: FileItem) => void;
  onSelect: (item: FileItem, e: React.MouseEvent | React.ChangeEvent) => void;
  onContextMenu: (e: React.MouseEvent, item: FileItem) => void;
}) {
  const pushToast = useUI((s) => s.pushToast);

  if (loading) {
    return (
      <div className="p-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-surface-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="h-full grid place-items-center text-content-muted p-10 text-center">
        <div>
          <p className="text-lg font-medium">This folder is empty</p>
          <p className="text-sm">Upload files or create a new folder to get started.</p>
        </div>
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {items.map((it) => {
          const selected = selection.has(it.path);
          return (
            <button
              key={it.path}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) onSelect(it, e);
                else onOpen(it);
              }}
              onDoubleClick={() => onOpen(it)}
              onContextMenu={(e) => onContextMenu(e, it)}
              className={`group relative flex flex-col items-center gap-2 p-4 rounded-2xl border text-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg glass-hover ${
                selected ? "border-accent bg-accent/10" : "border-transparent"
              }`}
            >
              {it.is_dir ? <FolderTile large /> : <FileThumb it={it} large />}
              <span className="text-sm truncate w-full" title={it.name}>{it.name}</span>
              <span className="text-[11px] text-content-muted">{it.is_dir ? "" : formatBytes(it.size)}</span>
              {!it.is_dir && canWrite && (
                <input
                  type="checkbox"
                  className="absolute top-2 left-2 accent-accent"
                  checked={selected}
                  onChange={(e) => onSelect(it, e)}
                  onClick={(e) => e.stopPropagation()}
                  title="Select"
                />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="p-2">
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 text-xs uppercase tracking-wide text-content-muted border-b glass-divider">
        <span>Name</span>
        <span className="w-28 text-right">Size</span>
        <span className="w-40 text-right">Modified</span>
      </div>
      {items.map((it) => {
        const selected = selection.has(it.path);
        return (
          <div
            key={it.path}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey) onSelect(it, e);
              else onOpen(it);
            }}
            onDoubleClick={() => onOpen(it)}
            onContextMenu={(e) => onContextMenu(e, it)}
            className={`group grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 rounded-lg items-center cursor-pointer ${
              selected ? "bg-accent/10" : "glass-hover"
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              {!it.is_dir && canWrite && (
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={selected}
                  onChange={(e) => onSelect(it, e)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              {!it.is_dir ? <FileThumb it={it} /> : <FolderTile />}
              <span className="truncate" title={it.name}>{it.name}</span>
            </span>
            <span className="w-28 text-right text-sm text-content-muted">{it.is_dir ? "—" : formatBytes(it.size)}</span>
            <span className="w-40 text-right text-sm text-content-muted">{formatDate(it.modified)}</span>
          </div>
        );
      })}
    </div>
  );
}

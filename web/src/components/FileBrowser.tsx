import { FileItem } from "../api/types";
import { iconForFile } from "./FileIcon";
import { formatBytes, formatDate } from "../lib/format";
import { thumbUrl } from "../lib/preview";
import { useUI } from "../store";

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

  const thumb = (it: FileItem) => {
    const url = thumbUrl(it);
    if (url) return <img src={url} alt="" className="h-10 w-10 object-cover rounded" />;
    const Icon = iconForFile(it);
    return <Icon className={`h-10 w-10 ${it.is_dir ? "text-accent" : "text-content-muted"}`} />;
  };

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
              className={`group relative flex flex-col items-center gap-2 p-4 rounded-xl border text-center hover:bg-surface-muted ${
                selected ? "border-accent bg-accent/10" : ""
              }`}
            >
              {!it.is_dir && thumb(it)}
              {it.is_dir && <div className="h-10 w-10 grid place-items-center"><span className="text-3xl">📁</span></div>}
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
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 text-xs uppercase tracking-wide text-content-muted border-b">
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
              selected ? "bg-accent/10" : "hover:bg-surface-muted"
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
              {!it.is_dir ? thumb(it) : <span className="text-lg">📁</span>}
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

import { useState } from "react";
import { FileItem } from "../api/types";
import { formatBytes, formatDate } from "../lib/format";
import { useUI } from "../store";
import { FileThumb, FolderTile } from "./FileThumb";
import { EmptyState } from "./ui/EmptyState";
import { SkeletonGrid, SkeletonList } from "./ui/Skeleton";

export default function FileBrowser({
  items,
  loading,
  viewMode,
  selection,
  selectMode,
  canWrite,
  onOpen,
  onSelect,
  onContextMenu,
  onDropItem,
}: {
  items: FileItem[];
  loading: boolean;
  viewMode: "list" | "grid";
  selection: Set<string>;
  selectMode: boolean;
  canWrite: boolean;
  onOpen: (item: FileItem) => void;
  onSelect: (item: FileItem, e: React.MouseEvent | React.ChangeEvent) => void;
  onContextMenu: (e: React.MouseEvent, item: FileItem) => void;
  onDropItem?: (targetFolder: FileItem) => void;
}) {
  const pushToast = useUI((s) => s.pushToast);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const canDrop = canWrite && selectMode && onDropItem;

  if (loading) {
    return viewMode === "grid" ? <SkeletonGrid /> : <SkeletonList />;
  }

  if (items.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <EmptyState 
          variant="files" 
          title="This folder is empty" 
          description="Upload files or create a new folder to get started."
        />
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 stagger-children">
        {items.map((it) => {
          const selected = selection.has(it.path);
          return (
            <button
              key={it.path}
              onClick={(e) => {
                if (selectMode) onSelect(it, e);
                else if (e.metaKey || e.ctrlKey || e.shiftKey) onSelect(it, e);
                else onOpen(it);
              }}
              onDoubleClick={() => onOpen(it)}
              onContextMenu={(e) => onContextMenu(e, it)}
              onDragOver={(e) => { if (canDrop && it.is_dir) { e.preventDefault(); setDropTarget(it.path); } }}
              onDragLeave={() => { if (dropTarget === it.path) setDropTarget(null); }}
              onDrop={(e) => {
                if (canDrop && it.is_dir) {
                  e.preventDefault();
                  setDropTarget(null);
                  onDropItem?.(it);
                }
              }}
              className={`group relative flex flex-col items-center gap-3 p-4 rounded-2xl text-center transition-all duration-300 outline-none
                ${selected ? "bg-accent/15 ring-2 ring-accent shadow-lg shadow-accent/10" : "glass-hover hover:bg-surface/60 hover:shadow-xl hover:shadow-black/5 ring-1 ring-border/50"} 
                ${dropTarget === it.path ? "ring-2 ring-accent bg-accent/20 scale-105" : ""} 
                ${it.is_dir ? "cursor-pointer" : ""}`}
            >
              <div className="w-full flex justify-center mt-2 mb-1">
                {it.is_dir ? <FolderTile large /> : <FileThumb it={it} large />}
              </div>
              <div className="w-full min-w-0 flex flex-col items-center gap-0.5">
                <span className="text-sm font-medium truncate w-full px-1" title={it.name}>{it.name}</span>
                <span className="text-[11px] font-medium text-content-muted">{it.is_dir ? "Folder" : formatBytes(it.size)}</span>
              </div>
              
              {(selectMode || selected) && (
                <div 
                  className={`absolute top-3 left-3 z-10 transition-transform duration-200 ${selected ? "scale-100" : "scale-0 group-hover:scale-100"}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    className="w-5 h-5 rounded-md border-border bg-surface text-accent focus:ring-accent focus:ring-offset-0 transition-colors cursor-pointer"
                    checked={selected}
                    onChange={(e) => onSelect(it, e)}
                    title="Select"
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="p-2 stagger-children">
      <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 text-xs font-bold uppercase tracking-wider text-content-muted/70 border-b border-border/50 sticky top-0 bg-background/80 backdrop-blur-md z-10">
        <span className="pl-8">Name</span>
        <span className="w-24 text-right">Size</span>
        <span className="w-32 text-right hidden sm:block">Modified</span>
      </div>
      
      <div className="mt-1 space-y-0.5">
        {items.map((it) => {
          const selected = selection.has(it.path);
          return (
            <div
              key={it.path}
              onClick={(e) => {
                if (selectMode) onSelect(it, e);
                else if (e.metaKey || e.ctrlKey || e.shiftKey) onSelect(it, e);
                else onOpen(it);
              }}
              onDoubleClick={() => onOpen(it)}
              onContextMenu={(e) => onContextMenu(e, it)}
              onDragOver={(e) => { if (canDrop && it.is_dir) { e.preventDefault(); setDropTarget(it.path); } }}
              onDragLeave={() => { if (dropTarget === it.path) setDropTarget(null); }}
              onDrop={(e) => {
                if (canDrop && it.is_dir) {
                  e.preventDefault();
                  setDropTarget(null);
                  onDropItem?.(it);
                }
              }}
              className={`group grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2.5 rounded-xl items-center cursor-pointer transition-all duration-200 outline-none
                ${selected ? "bg-accent/15 ring-1 ring-accent shadow-sm" : "glass-hover hover:bg-surface/50 border border-transparent hover:border-border/50"} 
                ${dropTarget === it.path ? "ring-2 ring-accent bg-accent/20" : ""}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-5 flex justify-center items-center shrink-0 transition-opacity duration-200 ${selectMode || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border bg-surface text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer"
                    checked={selected}
                    onChange={(e) => onSelect(it, e)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                
                <div className="shrink-0">
                  {it.is_dir ? <FolderTile /> : <FileThumb it={it} />}
                </div>
                
                <span className="truncate font-medium text-sm" title={it.name}>{it.name}</span>
              </div>
              
              <span className="w-24 text-right text-xs font-medium text-content-muted">{it.is_dir ? "—" : formatBytes(it.size)}</span>
              <span className="w-32 text-right text-xs font-medium text-content-muted hidden sm:block">{formatDate(it.modified)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

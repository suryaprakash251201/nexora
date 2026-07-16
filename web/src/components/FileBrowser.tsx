import { useState } from "react";
import { Play, Share2, Download, Trash2, Folder, FileIcon } from "lucide-react";
import { FileItem } from "../api/types";
import { formatBytes, formatDate } from "../lib/format";
import { useUI } from "../store";
import { FileThumb, FolderTile } from "./FileThumb";
import { EmptyState } from "./ui/EmptyState";
import { SkeletonGrid, SkeletonList } from "./ui/Skeleton";
import { Button } from "./ui/Button";

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
      <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 stagger-children pb-32">
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
              className={`group relative flex flex-col items-center p-4 rounded-3xl text-center transition-all duration-300 ease-out outline-none
                ${selected ? "bg-accent/20 ring-2 ring-accent shadow-lg shadow-accent/20 scale-[1.02]" : "glass-strong hover:bg-surface/80 border border-border/50 hover:border-accent/30 hover:shadow-2xl hover:shadow-accent/10 hover:-translate-y-2"} 
                ${dropTarget === it.path ? "ring-2 ring-accent bg-accent/30 scale-105 shadow-xl" : ""} 
                ${it.is_dir ? "cursor-pointer" : ""}`}
            >
              <div className="w-full flex justify-center mb-4 transition-transform duration-300 group-hover:scale-105 relative">
                {it.is_dir ? <FolderTile large /> : <FileThumb it={it} large />}
                
                {/* Inline Quick Actions on Hover */}
                {!selectMode && (
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="flex gap-2 p-2 rounded-2xl bg-surface-strong/90 backdrop-blur-xl border border-white/10 shadow-xl" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => onOpen(it)} className="p-2 rounded-xl text-white hover:bg-accent/80 hover:text-white transition-colors bg-accent/50" title="Open">
                        <Play className="h-4 w-4" fill="currentColor" />
                      </button>
                      <button onClick={(e) => onContextMenu(e, it)} className="p-2 rounded-xl text-content-muted hover:bg-white/10 hover:text-content transition-colors" title="More Actions">
                        <Share2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="w-full min-w-0 flex flex-col items-center gap-1 px-1">
                <span className="text-sm font-bold truncate w-full text-content group-hover:text-accent transition-colors" title={it.name}>{it.name}</span>
                <span className="text-xs font-medium text-content-muted/80 flex items-center justify-center gap-1.5 w-full">
                  <span className="truncate">{it.is_dir ? "Folder" : formatBytes(it.size)}</span>
                  <span className="w-1 h-1 rounded-full bg-border/50"></span>
                  <span className="truncate opacity-75">{formatDate(it.modified).split(' ')[0]}</span>
                </span>
              </div>
              
              {(selectMode || selected) && (
                <div 
                  className={`absolute top-4 left-4 z-10 transition-all duration-300 ${selected ? "scale-100 opacity-100" : "scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100"}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    className="w-5 h-5 rounded-md border-2 border-border/80 bg-surface/80 text-accent focus:ring-accent focus:ring-offset-0 transition-colors cursor-pointer shadow-sm"
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
    <div className="p-4 stagger-children pb-32 max-w-7xl mx-auto">
      <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-6 py-4 text-xs font-bold uppercase tracking-widest text-content-muted/60 border-b border-border/30 sticky top-0 bg-background/80 backdrop-blur-xl z-10 rounded-t-2xl">
        <span className="w-6 text-center">
          {selectMode && <span className="opacity-50">All</span>}
        </span>
        <span>Name</span>
        <span className="w-32 text-right hidden lg:block">Kind</span>
        <span className="w-24 text-right">Size</span>
        <span className="w-40 text-right hidden sm:block">Date Modified</span>
      </div>
      
      <div className="mt-2 space-y-1">
        {items.map((it, idx) => {
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
              className={`group grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-6 py-3 rounded-2xl items-center cursor-pointer transition-all duration-200 outline-none
                ${selected ? "bg-accent/10 ring-1 ring-accent/30 shadow-sm" : idx % 2 === 0 ? "bg-surface/20" : "bg-transparent"} 
                hover:bg-surface/80 hover:shadow-md hover:ring-1 hover:ring-border/50
                ${dropTarget === it.path ? "ring-2 ring-accent bg-accent/20" : ""}`}
            >
              <div className={`w-6 flex justify-center items-center shrink-0 transition-all duration-200 ${selectMode || selected ? "opacity-100 scale-100" : "opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100"}`}>
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-border bg-surface text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer transition-colors"
                  checked={selected}
                  onChange={(e) => onSelect(it, e)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              
              <div className="flex items-center gap-4 min-w-0">
                <div className="shrink-0 transition-transform duration-200 group-hover:scale-110">
                  {it.is_dir ? <FolderTile /> : <FileThumb it={it} />}
                </div>
                <span className="truncate font-bold text-sm text-content group-hover:text-accent transition-colors" title={it.name}>{it.name}</span>
                
                {/* Inline Quick Actions (List View) */}
                {!selectMode && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1 ml-4" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => onOpen(it)} className="p-1.5 rounded-lg text-content-muted hover:bg-accent/10 hover:text-accent transition-colors" title="Open">
                      <Play className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={(e) => onContextMenu(e, it)} className="p-1.5 rounded-lg text-content-muted hover:bg-white/10 hover:text-content transition-colors" title="More Actions">
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              
              <span className="w-32 text-right text-xs font-medium text-content-muted hidden lg:block capitalize">{it.is_dir ? "Folder" : (it.name.split('.').pop() || "File")}</span>
              <span className="w-24 text-right text-xs font-medium text-content-muted">{it.is_dir ? "—" : formatBytes(it.size)}</span>
              <span className="w-40 text-right text-xs font-medium text-content-muted hidden sm:block">{formatDate(it.modified)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

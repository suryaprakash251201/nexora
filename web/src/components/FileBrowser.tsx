import { useState, useEffect, useRef, memo } from "react";
import { useUI } from "../store";
import {
  Play,
  MoreVertical,
} from "lucide-react";
import { FileItem } from "../api/types";
import { formatBytes, formatDate } from "../lib/format";
import { FileThumb, FolderTile } from "./FileThumb";
import { iconForFile, colorClasses } from "./FileIcon";
import { EmptyState } from "./ui/EmptyState";
import { SkeletonGrid, SkeletonList } from "./ui/Skeleton";

interface FileBrowserProps {
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
}

const FileIconForItem = memo(function FileIconForItem({ item, large, fill }: { item: FileItem; large?: boolean; fill?: boolean }) {
  const isImage = item.mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"].includes(item.extension.toLowerCase());

  const dim = large ? (fill ? "h-full w-full" : "h-16 w-16") : "h-9 w-9";

  if (item.is_dir) {
    return <FolderTile large={large} />;
  }

  if (isImage) {
    return <FileThumb it={item} large={large} fill={fill} />;
  }

  const { icon: Icon, color } = iconForFile(item);
  const c = colorClasses[color] || "text-gray-500 bg-gray-500/10";
  const [, bg] = c.split(" ");

  return (
    <div className={`grid place-items-center rounded-xl transition-transform duration-300 group-hover:scale-105 shadow-sm ${bg || "bg-surface-muted"} border border-border/50 ${dim}`}>
      <Icon className={`drop-shadow-md ${large ? "h-8 w-8" : "h-5 w-5"} ${c.split(" ")[0] || "text-content-muted"}`} />
    </div>
  );
});

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
}: FileBrowserProps) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const canDrop = canWrite && selectMode && onDropItem;

  const allSelected = items.length > 0 && items.every((i) => selection.has(i.path));

  const toggleSelectAll = () => {
    if (allSelected) {
      useUI.getState().clearSelection();
    } else {
      useUI.getState().setSelection(items.map((i) => i.path));
    }
  };

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      if (!canDrop) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      if (!canDrop) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.currentTarget === dropZoneRef.current) {
        setDragOver(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      if (!canDrop) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
    };

    const zone = dropZoneRef.current;
    if (zone) {
      zone.addEventListener("dragover", handleDragOver);
      zone.addEventListener("dragleave", handleDragLeave);
      zone.addEventListener("drop", handleDrop);
    }
    return () => {
      if (zone) {
        zone.removeEventListener("dragover", handleDragOver);
        zone.removeEventListener("dragleave", handleDragLeave);
        zone.removeEventListener("drop", handleDrop);
      }
    };
  }, [canDrop, onDropItem]);

  const handleItemClick = (item: FileItem, e: React.MouseEvent) => {
    if (selectMode) {
      onSelect(item, e);
    } else if (e.metaKey || e.ctrlKey || e.shiftKey) {
      onSelect(item, e);
    } else {
      onOpen(item);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, item: FileItem, index: number) => {
    switch (e.key) {
      case "Enter":
      case " ":
        if (e.key === " " && (e.target as HTMLElement).tagName === "INPUT") return;
        e.preventDefault();
        onOpen(item);
        break;
      case "ArrowRight":
        if (item.is_dir) {
          e.preventDefault();
          onOpen(item);
        }
        break;
      case "ArrowLeft":
        // Could navigate to parent
        break;
    }
  };

  if (loading) {
    return viewMode === "grid" ? <SkeletonGrid /> : <SkeletonList />;
  }

  if (items.length === 0) {
    return (
      <div ref={dropZoneRef} className="h-full grid place-items-center p-8">
        <EmptyState
          variant="files"
          title="This folder is empty"
          description="Drag files here or use the Upload button to add content."
          action={canWrite ? { label: "Upload files", onClick: () => {} } : undefined}
        />
    </div>
  );
  }

  const renderGridView = () => (
    <>
      {selectMode && items.length > 0 && (
        <div className="flex items-center gap-3 px-6 py-2 border-b border-border/30 bg-surface/30 backdrop-blur-sm">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-2 border-border/80 bg-surface/80 text-accent focus:ring-accent cursor-pointer transition-all"
            />
            <span className="font-medium text-content-muted">{allSelected ? "Deselect all" : "Select all"}</span>
          </label>
          <span className="text-xs text-content-muted/70">{selection.size} of {items.length} selected</span>
        </div>
      )}
      <div
      ref={dropZoneRef}
      className="p-4 sm:p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6 stagger-children pb-32"
      role="grid"
      aria-label="File grid"
      onDragOver={(e) => { if (canDrop) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (canDrop && e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => { if (canDrop) { e.preventDefault(); setDragOver(false); } }}
    >
      {items.map((item, index) => {
        const selected = selection.has(item.path);
        return (
          <div
            key={item.path}
            tabIndex={0}
            onClick={(e) => handleItemClick(item, e)}
            onDoubleClick={() => onOpen(item)}
            onContextMenu={(e) => onContextMenu(e, item)}
            onKeyDown={(e) => handleKeyDown(e, item, index)}
            onDragOver={(e) => { if (canDrop && item.is_dir) { e.preventDefault(); setDropTarget(item.path); } }}
            onDragLeave={() => { if (dropTarget === item.path) setDropTarget(null); }}
            onDrop={(e) => {
              if (canDrop && item.is_dir) {
                e.preventDefault();
                setDropTarget(null);
                onDropItem?.(item);
              }
            }}
            className={`
              group relative flex flex-col items-center p-4 rounded-3xl text-center transition-all duration-300 ease-out outline-none
              ${selected
                ? "bg-accent/20 ring-2 ring-accent shadow-lg shadow-accent/20 scale-[1.02]"
                : "glass-strong hover:bg-surface/80 border border-border/50 hover:border-accent/30 hover:shadow-2xl hover:shadow-accent/10 hover:-translate-y-2"}
              ${dropTarget === item.path ? "ring-2 ring-accent bg-accent/30 scale-105 shadow-xl" : ""}
              ${item.is_dir ? "cursor-pointer" : ""}
              ${dragOver ? "opacity-50" : ""}
            `}
          >
            <div className="w-full flex justify-center mb-4 transition-transform duration-300 group-hover:scale-105 relative">
              <FileIconForItem item={item} large />
              
              {/* Quick actions on hover (non-selection mode) */}
              {!selectMode && (
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="flex gap-2 p-2 rounded-2xl bg-surface-strong/90 backdrop-blur-xl border border-white/10 shadow-xl" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpen(item); }}
                      className="p-2 rounded-xl text-white hover:bg-accent/80 hover:text-white transition-colors bg-accent/50"
                      title="Open"
                    >
                      <Play className="h-4 w-4" fill="currentColor" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onContextMenu(e, item); }}
                      className="p-2 rounded-xl text-content-muted hover:bg-white/10 hover:text-content transition-colors"
                      title="More actions"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Drop indicator */}
              {dropTarget === item.path && (
                <div className="absolute inset-0 bg-accent/30 rounded-3xl animate-pulse" />
              )}
            </div>

            <div className="w-full min-w-0 flex flex-col items-center gap-1 px-1">
              {(selectMode || selected) && (
                <div
                  className={`absolute top-3 left-3 z-10 transition-all duration-300 ${selected ? "scale-100 opacity-100" : "scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100"}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <label className="cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-5 h-5 rounded-md border-2 border-border/80 bg-surface/80 text-accent focus:ring-accent focus:ring-offset-0 transition-colors cursor-pointer shadow-sm"
                      checked={selected}
                      onChange={(e) => onSelect(item, e)}
                      title="Select"
                    />
                  </label>
                </div>
              )}

              <div className="w-full min-w-0">
                <p className="truncate text-sm font-bold text-content leading-tight hover:text-accent transition-colors group-hover:text-accent" title={item.name}>
                  {item.name}
                </p>
                <p className="truncate text-[11px] font-medium text-content-muted/80 flex items-center justify-center gap-1.5 w-full">
                  <span className="truncate">{item.is_dir ? "Folder" : formatBytes(item.size)}</span>
                  <span className="w-1 h-1 rounded-full bg-border/50 hidden sm:inline-block" />
                  <span className="truncate opacity-75">{formatDate(item.modified).split(" ")[0]}</span>
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div></>
  );

  const renderListView = () => (
    <div ref={dropZoneRef} className="p-4 stagger-children pb-32 max-w-7xl mx-auto">
      <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-6 py-4 text-xs font-bold uppercase tracking-widest text-content-muted/60 border-b border-border/30 sticky top-0 bg-background/80 backdrop-blur-xl z-10 rounded-t-2xl">
        <span className="w-6 flex justify-center items-center">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            className="w-4 h-4 rounded border-2 border-border/80 bg-surface/80 text-accent focus:ring-accent cursor-pointer transition-all"
          />
        </span>
        <span>Name</span>
        <span className="w-32 text-right hidden lg:block">Kind</span>
        <span className="w-24 text-right">Size</span>
        <span className="w-40 text-right hidden sm:block">Date Modified</span>
      </div>

      <div className="mt-2 space-y-1">
        {items.map((item, index) => {
          const selected = selection.has(item.path);
          return (
            <div
              key={item.path}
              tabIndex={0}
              onClick={(e) => handleItemClick(item, e)}
              onDoubleClick={() => onOpen(item)}
              onContextMenu={(e) => onContextMenu(e, item)}
              onKeyDown={(e) => handleKeyDown(e, item, index)}
              onDragOver={(e) => { if (canDrop && item.is_dir) { e.preventDefault(); setDropTarget(item.path); } }}
              onDragLeave={() => { if (dropTarget === item.path) setDropTarget(null); }}
              onDrop={(e) => {
                if (canDrop && item.is_dir) {
                  e.preventDefault();
                  setDropTarget(null);
                  onDropItem?.(item);
                }
              }}
              className={`
                group grid grid-cols-[auto_1fr_auto_auto_auto] gap-2 sm:gap-4 px-3 sm:px-6 py-4 sm:py-3 rounded-2xl items-center cursor-pointer transition-all duration-200 outline-none
                ${selected ? "bg-accent/10 ring-1 ring-accent/30 shadow-sm" : index % 2 === 0 ? "bg-surface/20" : "bg-transparent"}
                hover:bg-surface/80 hover:shadow-md hover:ring-1 hover:ring-border/50
                ${dropTarget === item.path ? "ring-2 ring-accent bg-accent/20" : ""}
              `}
            >
              <div className={`w-6 flex justify-center items-center shrink-0 transition-all duration-200 ${selectMode || selected ? "opacity-100 scale-100" : "opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100"}`}>
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-border bg-surface text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer transition-colors"
                  checked={selected}
                  onChange={(e) => onSelect(item, e)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>

              <div className="flex items-center gap-4 min-w-0">
                <div className="shrink-0 transition-transform duration-200 group-hover:scale-110">
                  <FileIconForItem item={item} />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="truncate font-bold text-sm text-content group-hover:text-accent transition-colors" title={item.name}>
                    {item.name}
                  </span>

                  {/* Quick actions in list view */}
                  {!selectMode && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1 ml-4" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => { e.stopPropagation(); onOpen(item); }}
                        className="p-1.5 rounded-lg text-content-muted hover:bg-accent/10 hover:text-accent transition-colors"
                        title="Open"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onContextMenu(e, item); }}
                        className="p-1.5 rounded-lg text-content-muted hover:bg-white/10 hover:text-content transition-colors"
                        title="More actions"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <span className="w-32 text-right text-xs font-medium text-content-muted hidden lg:block capitalize">
                  {item.is_dir ? "Folder" : (item.extension ? item.extension.replace(/^\./, "").toUpperCase() : "File")}
                </span>
                <span className="w-24 text-right text-xs font-medium text-content-muted">
                  {item.is_dir ? "—" : formatBytes(item.size)}
                </span>
                <span className="w-40 text-right text-xs font-medium text-content-muted hidden sm:block">
                  {formatDate(item.modified)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return viewMode === "grid" ? renderGridView() : renderListView();
}
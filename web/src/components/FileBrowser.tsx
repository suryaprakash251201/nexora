import { useState, useEffect, useRef, memo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useUI } from "../store";
import { Play, MoreVertical, AlertTriangle, RefreshCw } from "lucide-react";
import { FileItem } from "../api/types";
import { formatBytes, formatDate } from "../lib/format";
import { FileThumb } from "./FileThumb";
import { iconForFile, colorClasses, iconGlowClasses } from "./FileIcon";
import { EmptyState } from "./ui/EmptyState";
import { SkeletonGrid, SkeletonList } from "./ui/Skeleton";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { TagChip } from "./TagManager";
import type { DensityMode } from "../store";

interface FileBrowserProps {
  items: FileItem[];
  loading: boolean;
  isFetching?: boolean;
  viewMode: "list" | "grid";
  selection: Set<string>;
  selectMode: boolean;
  canWrite: boolean;
  onOpen: (item: FileItem) => void;
  onSelect: (item: FileItem, e: React.MouseEvent | React.ChangeEvent) => void;
  onContextMenu: (e: React.MouseEvent, item: FileItem) => void;
  onDropItem?: (targetFolder: FileItem) => void;
  onUpload?: () => void;
  onUploadFolder?: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  density?: DensityMode;
}

const FileIconForItem = memo(function FileIconForItem({ item, large, fill, className }: { item: FileItem; large?: boolean; fill?: boolean; className?: string }) {
  const isImage = item.mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"].includes((item.extension || "").toLowerCase());
  const isAudio = item.mime.startsWith("audio/") || ["mp3", "flac", "wav", "ogg", "m4a"].includes((item.extension || "").toLowerCase());
  const dim = large ? (fill ? "h-full w-full" : "h-16 w-16") : "h-9 w-9";

  if (isImage || item.is_dir || isAudio) {
    return <FileThumb it={item} large={large} fill={fill} />;
  }

  const { icon: Icon, color, customIcon: CustomIcon } = iconForFile(item);
  const c = colorClasses[color] || "text-gray-500 bg-gray-500/10";
  const [, bg] = c.split(" ");
  const customSize = large ? 72 : 20;

  return (
    <div className={cn("grid place-items-center rounded-xl transition-all duration-300 group-hover:scale-105", bg || "bg-surface-muted", "border", iconGlowClasses[color] || "border-glass-border-soft shadow-sm", dim, className)}>
      {CustomIcon ? (
        <CustomIcon size={customSize} className="drop-shadow-md" />
      ) : (
        <Icon className={cn("drop-shadow-md", large ? "h-8 w-8" : "h-5 w-5", c.split(" ")[0] || "text-text-secondary")} />
      )}
    </div>
  );
});

export default function FileBrowser({
  items,
  loading,
  isFetching,
  viewMode,
  selection,
  selectMode,
  canWrite,
  onOpen,
  onSelect,
  onContextMenu,
  onDropItem,
  onUpload,
  onUploadFolder,
  hasMore,
  onLoadMore,
  isLoadingMore,
  error,
  onRetry,
  density = "comfortable",
}: FileBrowserProps) {
  const visibleColumns = useUI((s) => s.visibleColumns);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const canDrop = canWrite && selectMode && onDropItem;
  const allSelected = items.length > 0 && items.every((i) => selection.has(i.path));

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      useUI.getState().clearSelection();
    } else {
      useUI.getState().setSelection(items.map((i) => i.path));
    }
  }, [allSelected, items]);

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
      if (e.currentTarget === dropZoneRef.current) setDragOver(false);
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
        if (item.is_dir) { e.preventDefault(); onOpen(item); }
        break;
    }
  };

  if ((loading && items.length === 0) || (isFetching && items.length === 0)) {
    return viewMode === "grid" ? (
      <div className="p-4 sm:p-6">
        <SkeletonGrid />
      </div>
    ) : (
      <div className="p-2">
        <SkeletonList />
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="h-full grid place-items-center p-8">
        <div className="text-center max-w-md">
          <div className="inline-flex p-4 rounded-2xl bg-red-500/10 text-red-400 mb-4">
            <AlertTriangle className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Failed to load files</h3>
          <p className="text-sm text-content-muted mb-4">{error.message || "An unexpected error occurred"}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl glass-hover border border-glass-border text-sm font-medium text-content hover:text-accent transition-all min-h-[44px]"
            >
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div ref={dropZoneRef} className="h-full grid place-items-center p-8">
        <EmptyState
          variant="files"
          title="This folder is empty"
          description="Drag files or folders here, or use the Upload buttons to add content."
          action={canWrite && onUpload ? { label: "Upload files", onClick: onUpload } : undefined}
        />
        {canWrite && onUploadFolder && (
          <button
            onClick={onUploadFolder}
            className="mt-3 px-4 py-2 rounded-xl border border-glass-border text-sm font-medium text-text-secondary hover:text-foreground hover:bg-accent/10 transition-colors"
          >
            Upload folder
          </button>
        )}
      </div>
    );
  }

  // Density-based class helpers
  const dc = {
    grid: {
      compact: "p-1.5 gap-1.5",
      comfortable: "p-2 sm:p-3 gap-2 sm:gap-3",
      spacious: "p-3 sm:p-4 gap-3 sm:gap-4",
    },
    gridItem: {
      compact: "p-2",
      comfortable: "p-3",
      spacious: "p-4",
    },
    gridIcon: {
      compact: "h-28 w-28",
      comfortable: "h-32 w-32",
      spacious: "h-36 w-36",
    },
    gridIconInner: {
      compact: "h-20 w-20",
      comfortable: "h-24 w-24",
      spacious: "h-28 w-28",
    },
    gridName: {
      compact: "text-[11px]",
      comfortable: "text-xs",
      spacious: "text-sm",
    },
    gridMeta: {
      compact: "text-[9px]",
      comfortable: "text-[10px]",
      spacious: "text-[11px]",
    },
    listContainer: {
      compact: "p-2",
      comfortable: "p-3",
      spacious: "p-4",
    },
    listHeader: {
      compact: "px-2 py-2 text-[10px]",
      comfortable: "px-3 sm:px-6 py-4 text-xs",
      spacious: "px-4 sm:px-8 py-5 text-sm",
    },
    listRow: {
      compact: "gap-2 px-3 py-2",
      comfortable: "gap-3 px-4 sm:px-6 py-3",
      spacious: "gap-4 px-5 sm:px-8 py-4",
    },
    listIcon: {
      compact: "w-8 h-8",
      comfortable: "w-10 h-10",
      spacious: "w-12 h-12",
    },
    listIconInner: {
      compact: "w-5 h-5",
      comfortable: "w-6 h-6",
      spacious: "w-7 h-7",
    },
    listName: {
      compact: "text-xs",
      comfortable: "text-sm",
      spacious: "text-base",
    },
    listMeta: {
      compact: "text-[11px]",
      comfortable: "text-xs",
      spacious: "text-sm",
    },
    listKindWidth: {
      compact: "w-20",
      comfortable: "w-28",
      spacious: "w-32",
    },
    listSizeWidth: {
      compact: "w-16",
      comfortable: "w-20",
      spacious: "w-24",
    },
    listDateWidth: {
      compact: "w-28",
      comfortable: "w-36",
      spacious: "w-40",
    },
    checkbox: {
      compact: "w-4 h-4",
      comfortable: "w-4.5 h-4.5",
      spacious: "w-5 h-5",
    },
    headerCheckbox: {
      compact: "w-4 h-4",
      comfortable: "w-4.5 h-4.5",
      spacious: "w-5 h-5",
    },
  };

  const d = density;

  return (
    <div ref={dropZoneRef} className="flex-1 overflow-auto hide-scrollbar">
      {viewMode === "grid" ? (
        <>
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className={cn(dc.grid[d], "grid")} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
            role="grid"
            aria-label="File grid"
          >
            <AnimatePresence mode="popLayout">
              {items.map((item, index) => {
                const selected = selection.has(item.path);
                return (
                  <motion.div
                    key={item.path}
                    layout
                    variants={staggerItem}
                    initial={{ opacity: 0, y: 16, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95, y: -8 }}
                    transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1], delay: Math.min(index * 0.03, 0.6) }}
                    tabIndex={0}
                    onClick={(e) => handleItemClick(item, e)}
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
                    whileHover={{ y: -6 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      "group relative flex flex-col items-center text-center transition-all duration-200 outline-none cursor-pointer",
                      selected
                        ? "opacity-80"
                        : "opacity-100 hover:opacity-90",
                      dropTarget === item.path ? "ring-2 ring-accent scale-105" : "",
                      dragOver ? "opacity-50" : ""
                    )}
                  >
                    <div className="w-full h-36 flex items-center justify-center mb-0 transition-transform duration-300 relative">
                      <FileIconForItem item={item} large className={dc.gridIcon[d]} />

                      {!selectMode && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <div className="flex gap-2 p-1.5 rounded-2xl bg-glass-bg-strong backdrop-blur-2xl border border-glass-border shadow-2xl dark:border-white/10" onClick={(e) => e.stopPropagation()}>
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={(e) => { e.stopPropagation(); onOpen(item); }}
                              className="p-2 rounded-xl text-white hover:bg-accent transition-colors bg-accent/60"
                              title="Open"
                            >
                              <Play className="h-4 w-4" fill="currentColor" />
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                onContextMenu(e, item);
                              }}
                              className="p-2 rounded-xl text-text-secondary hover:bg-glass-bg hover:text-foreground transition-colors"
                              title="More actions"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </motion.button>
                          </div>
                        </div>
                      )}

                      {dropTarget === item.path && (
                        <div className="absolute inset-0 bg-accent/20 rounded-2xl animate-pulse" />
                      )}
                    </div>

                    <div className="w-full min-w-0 flex flex-col items-center gap-1.5 px-1">
                      {(selectMode || selected) && (
                        <div
                          className={cn(
                            "absolute top-3 left-3 z-10 transition-all duration-200",
                            selected ? "scale-100 opacity-100" : "scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100"
                          )}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <label className="cursor-pointer">
                            <input
                              type="checkbox"
                              className={cn("rounded-md border-2 border-glass-border bg-glass-bg text-accent focus:ring-accent cursor-pointer shadow-sm", dc.checkbox[d])}
                              checked={selected}
                              onChange={(e) => onSelect(item, e)}
                              title="Select"
                            />
                          </label>
                        </div>
                      )}

                      <div className="w-full min-w-0">
                        <p className={cn("truncate font-medium leading-tight group-hover:text-accent transition-colors", dc.gridName[d])} title={item.name}>
                          {item.name}
                        </p>
                        {item.tags && item.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {item.tags.map(t => <TagChip key={t.id} tag={t} small />)}
                          </div>
                        )}
                        {!item.is_dir && (
                          <p className={cn("truncate font-medium flex items-center justify-center gap-1.5 w-full mt-0.5", dc.gridMeta[d])}>
                            <span className="truncate">{formatBytes(item.size)}</span>
                            <span className="w-1 h-1 rounded-full bg-glass-border hidden sm:inline-block" />
                            <span className="truncate opacity-75">{formatDate(item.modified).split(" ")[0]}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
          {hasMore && onLoadMore && (
            <div className="flex justify-center py-6 pb-40">
              <button
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="px-6 py-3 rounded-2xl glass-hover border border-glass-border text-sm font-medium text-text-secondary hover:text-foreground transition-all duration-200 disabled:opacity-50 min-h-[44px]"
              >
                {isLoadingMore ? "Loading..." : "Load more files"}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className={cn(dc.listContainer[d], "pb-16 sm:pb-32 md:pb-36 max-w-7xl mx-auto")}>
          <div className={cn(
            "grid grid-cols-[auto_1fr_auto_auto] items-center border-b border-glass-border-soft sticky top-0 z-10",
            dc.listHeader[d]
          )}>
            <span className="flex justify-center items-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className={cn("rounded border-2 border-glass-border bg-glass-bg text-accent focus:ring-accent cursor-pointer transition-all", dc.headerCheckbox[d])}
              />
            </span>
            <span className="truncate font-semibold text-text-secondary">Name</span>
            {visibleColumns.size && (
              <span className={cn("text-right truncate text-text-tertiary", dc.listSizeWidth[d])}>Size</span>
            )}
            {visibleColumns.modified && (
              <span className={cn("text-right truncate text-text-tertiary", dc.listDateWidth[d])}>Modified</span>
            )}
          </div>

          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="mt-1"
          >
            <AnimatePresence mode="popLayout">
              {items.map((item, index) => {
                const selected = selection.has(item.path);
                return (
                  <motion.div
                    key={item.path}
                    layout
                    variants={staggerItem}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.2, delay: Math.min(index * 0.02, 0.4) }}
                    tabIndex={0}
                    onClick={(e) => handleItemClick(item, e)}
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
                    className={cn(
                      "group grid grid-cols-[auto_1fr_auto_auto] items-center cursor-pointer transition-all duration-150 border border-transparent",
                      dc.listRow[d],
                      index % 2 === 0 ? "bg-glass-bg-subtle/30" : "",
                      selected
                        ? "bg-accent/10 border-accent/30"
                        : "hover:bg-accent/5",
                      dropTarget === item.path ? "ring-2 ring-accent bg-accent/12" : ""
                    )}
                  >
                    {/* Checkbox */}
                    <div className="flex justify-center items-center">
                      <input
                        type="checkbox"
                        className={cn(
                          "rounded border-2 border-glass-border bg-glass-bg text-accent focus:ring-2 focus:ring-accent/50 cursor-pointer transition-all",
                          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                          dc.checkbox[d]
                        )}
                        checked={selected}
                        onChange={(e) => onSelect(item, e)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {/* Icon + Name + Tags + Actions */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn("shrink-0 flex items-center justify-center", dc.listIcon[d])}>
                        <FileIconForItem item={item} className={dc.listIconInner[d]} />
                      </div>
                      <span className={cn("truncate font-medium transition-colors", dc.listName[d], selected ? "text-foreground" : "text-text-primary group-hover:text-accent")} title={item.name}>
                        {item.name}
                      </span>

                      {item.tags && item.tags.length > 0 && (
                        <div className="flex items-center gap-1 overflow-hidden shrink-0">
                          {item.tags.map(t => <TagChip key={t.id} tag={t} small />)}
                        </div>
                      )}

                      {visibleColumns.kind && (
                        <span className="text-[10px] font-medium text-text-tertiary hidden lg:inline capitalize px-1.5 py-0.5 rounded bg-glass-bg-subtle">
                          {item.is_dir ? "Folder" : (item.extension ? item.extension.replace(/^\./, "").toUpperCase() : "File")}
                        </span>
                      )}

                      {/* Hover action buttons */}
                      {!selectMode && (
                        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150" onClick={(e) => e.stopPropagation()}>
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={(e) => { e.stopPropagation(); onOpen(item); }}
                            className="p-1.5 rounded-lg text-text-tertiary hover:text-accent hover:bg-accent/10 transition-colors"
                            title="Open"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={(e) => { e.stopPropagation(); onContextMenu(e, item); }}
                            className="p-1.5 rounded-lg text-text-tertiary hover:text-foreground hover:bg-glass-bg transition-colors"
                            title="More actions"
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </motion.button>
                        </div>
                      )}
                    </div>

                    {/* Size */}
                    {visibleColumns.size && (
                      <span className={cn("text-right font-medium text-text-tertiary truncate", dc.listMeta[d], dc.listSizeWidth[d])}>
                        {item.is_dir ? "—" : formatBytes(item.size)}
                      </span>
                    )}

                    {/* Modified */}
                    {visibleColumns.modified && (
                      <span className={cn("text-right font-medium text-text-tertiary truncate", dc.listMeta[d], dc.listDateWidth[d])}>
                        {formatDate(item.modified)}
                      </span>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
          {hasMore && onLoadMore && (
            <div className="flex justify-center py-6 pb-40">
              <button
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="px-6 py-3 rounded-2xl glass-hover border border-glass-border text-sm font-medium text-text-secondary hover:text-foreground transition-all duration-200 disabled:opacity-50 min-h-[44px]"
              >
                {isLoadingMore ? "Loading..." : "Load more files"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
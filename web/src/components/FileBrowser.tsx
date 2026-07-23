import { useState, useEffect, useRef, memo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useUI } from "../store";
import { Play, MoreVertical } from "lucide-react";
import { FileItem } from "../api/types";
import { formatBytes, formatDate } from "../lib/format";
import { FileThumb } from "./FileThumb";
import { iconForFile, colorClasses, iconGlowClasses } from "./FileIcon";
import { EmptyState } from "./ui/EmptyState";
import { SkeletonGrid, SkeletonList } from "./ui/Skeleton";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem } from "@/lib/animations";

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

  if (isImage || item.is_dir) {
    return <FileThumb it={item} large={large} fill={fill} />;
  }

  const { icon: Icon, color } = iconForFile(item);
  const c = colorClasses[color] || "text-gray-500 bg-gray-500/10";
  const [, bg] = c.split(" ");

  return (
    <div className={cn("grid place-items-center rounded-xl transition-all duration-300 group-hover:scale-105", bg || "bg-surface-muted", "border", iconGlowClasses[color] || "border-glass-border-soft shadow-sm", dim)}>
      <Icon className={cn("drop-shadow-md", large ? "h-8 w-8" : "h-5 w-5", c.split(" ")[0] || "text-text-secondary")} />
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

  if (loading) {
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

  return (
    <div ref={dropZoneRef} className="flex-1 overflow-auto">
      {viewMode === "grid" ? (
        <>
          {selectMode && items.length > 0 && (
            <div className="flex items-center gap-3 px-6 py-2 border-b border-glass-border-soft bg-glass-bg-subtle backdrop-blur-sm">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-2 border-glass-border bg-glass-bg text-accent focus:ring-accent cursor-pointer transition-all"
                />
                <span className="font-medium text-text-secondary">{allSelected ? "Deselect all" : "Select all"}</span>
              </label>
              <span className="text-xs text-text-tertiary">{selection.size} of {items.length} selected</span>
            </div>
          )}
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="p-4 sm:p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5 pb-32"
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
                    transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1], delay: index * 0.03 }}
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
                    whileHover={{ y: -6, boxShadow: "0 8px 32px rgba(0,0,0,0.22), 0 0 48px rgba(91,140,255,0.10), 0 0 0 1px rgba(255,255,255,0.08)" }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      "group relative flex flex-col items-center p-5 rounded-2xl text-center transition-all duration-200 outline-none cursor-pointer border overflow-hidden",
                      selected
                        ? "bg-accent/12 border-accent/35 shadow-lg shadow-accent/15"
                        : "glass border-white/[0.06] hover:border-accent-purple/30",
                      dropTarget === item.path ? "ring-2 ring-accent bg-accent/15 scale-105" : "",
                      dragOver ? "opacity-50" : ""
                    )}
                  >
                    {/* Inner glow highlight */}
                    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] via-transparent to-transparent pointer-events-none rounded-2xl" />
                    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                    <div className="w-full flex justify-center mb-4 transition-transform duration-300 relative">
                      <FileIconForItem item={item} large />

                      {!selectMode && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <div className="flex gap-2 p-1.5 rounded-2xl bg-black/80 backdrop-blur-2xl border border-white/10 shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
                              onClick={(e) => { e.stopPropagation(); onContextMenu(e, item); }}
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
                              className="w-5 h-5 rounded-md border-2 border-glass-border bg-glass-bg text-accent focus:ring-accent cursor-pointer shadow-sm"
                              checked={selected}
                              onChange={(e) => onSelect(item, e)}
                              title="Select"
                            />
                          </label>
                        </div>
                      )}

                      <div className="w-full min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground leading-tight group-hover:text-accent-purple transition-colors" title={item.name}>
                          {item.name}
                        </p>
                        <p className="truncate text-[11px] font-medium text-text-tertiary flex items-center justify-center gap-1.5 w-full mt-0.5">
                          <span className="truncate">{item.is_dir ? "Folder" : formatBytes(item.size)}</span>
                          <span className="w-1 h-1 rounded-full bg-glass-border hidden sm:inline-block" />
                          <span className="truncate opacity-75">{formatDate(item.modified).split(" ")[0]}</span>
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        </>
      ) : (
        <div className="p-4 pb-32 max-w-7xl mx-auto">
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-tertiary border-b border-glass-border-soft sticky top-0 z-10">
            <span className="w-6 flex justify-center items-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-2 border-glass-border bg-glass-bg text-accent focus:ring-accent cursor-pointer transition-all"
              />
            </span>
            <span>Name</span>
            <span className="w-32 text-right hidden lg:block">Kind</span>
            <span className="w-24 text-right">Size</span>
            <span className="w-40 text-right hidden sm:block">Modified</span>
          </div>

          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="mt-2 space-y-1"
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
                    transition={{ duration: 0.2, delay: index * 0.02 }}
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
                    whileHover={{ backgroundColor: "rgba(255,255,255,0.04)" }}
                    className={cn(
                      "group grid grid-cols-[auto_1fr_auto_auto_auto] gap-2 sm:gap-4 px-3 sm:px-6 py-3 rounded-xl items-center cursor-pointer transition-all duration-200 outline-none border border-transparent",
                      selected
                        ? "bg-accent/8 border-accent/15"
                        : "hover:border-glass-border-soft",
                      dropTarget === item.path ? "ring-2 ring-accent bg-accent/12" : ""
                    )}
                  >
                    <div className={cn(
                      "w-6 flex justify-center items-center shrink-0 transition-all duration-200",
                      selectMode || selected ? "opacity-100 scale-100" : "opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100"
                    )}>
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-glass-border bg-glass-bg text-accent focus:ring-accent cursor-pointer transition-colors"
                        checked={selected}
                        onChange={(e) => onSelect(item, e)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    <div className="flex items-center gap-4 min-w-0">
                      <div className="shrink-0 transition-transform duration-200 group-hover:scale-110">
                        <FileIconForItem item={item} />
                      </div>
                      <div className="min-w-0 flex-1 flex items-center gap-3">
                        <span className="truncate font-medium text-sm text-foreground group-hover:text-accent-purple transition-colors" title={item.name}>
                          {item.name}
                        </span>

                        {!selectMode && (
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={(e) => { e.stopPropagation(); onOpen(item); }}
                              className="p-1.5 rounded-lg text-text-tertiary hover:bg-accent/10 hover:text-accent transition-colors"
                              title="Open"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={(e) => { e.stopPropagation(); onContextMenu(e, item); }}
                              className="p-1.5 rounded-lg text-text-tertiary hover:bg-glass-bg hover:text-foreground transition-colors"
                              title="More actions"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </motion.button>
                          </div>
                        )}
                      </div>

                      <span className="w-32 text-right text-xs font-medium text-text-tertiary hidden lg:block capitalize">
                        {item.is_dir ? "Folder" : (item.extension ? item.extension.replace(/^\./, "").toUpperCase() : "File")}
                      </span>
                      <span className="w-24 text-right text-xs font-medium text-text-tertiary">
                        {item.is_dir ? "—" : formatBytes(item.size)}
                      </span>
                      <span className="w-40 text-right text-xs font-medium text-text-tertiary hidden sm:block">
                        {formatDate(item.modified)}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </div>
  );
}

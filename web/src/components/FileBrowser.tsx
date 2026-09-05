import { useState, useEffect, useRef, memo, useCallback } from "react";
import { motion } from "motion/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useUI } from "../store";
import { Play, MoreVertical, AlertTriangle, RefreshCw, Eye, FolderOpen } from "lucide-react";
import { FileItem } from "../api/types";
import { EmptyState } from "./ui/EmptyState";
import { formatBytes, formatDate } from "../lib/format";
import {
  beginDragMove, endDragMove, isInternalMoveDragEvent, canDropInto,
  currentDragPaths, payloadFromItems, useDragMove,
} from "../lib/dragMove";
import { FileThumb } from "./FileThumb";
import { iconForFile, colorClasses, iconGlowClasses } from "./FileIcon";
import { SkeletonGrid, SkeletonList } from "./ui/Skeleton";
import { cn } from "@/lib/utils";
import { AUDIO_EXTS, VIDEO_EXTS, IMAGE_EXTS } from "@nexora/core";
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
  /** Called after an internal move-drag drops onto `targetFolder`.
   *  `paths` are the dragged sources (may differ from current selection). */
  onDropItem?: (targetFolder: FileItem, paths: string[]) => void;
  /** When provided, dropping OS files onto a folder row uploads them there. */
  onUploadToPath?: (files: FileList, path: string) => void;
  onUpload?: () => void;
  onUploadFolder?: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  density?: DensityMode;
  /** Current folder path — resets the scroll container to top when it changes. */
  folderPath?: string;
}

/** Media extensions that get a "Play" hover action rather than "Preview" —
 *  derived from the canonical core sets instead of a divergent hardcoded list. */
const MEDIA_EXTS = new Set([...AUDIO_EXTS, ...VIDEO_EXTS]);

/** Contextual primary hover action — Play for media, Preview otherwise. */
function hoverActionFor(item: FileItem): { Icon: typeof Play; label: string; filled?: boolean } {
  if (item.is_dir) return { Icon: FolderOpen, label: "Open folder" };
  const ext = (item.extension || "").toLowerCase();
  if (item.mime.startsWith("audio/") || item.mime.startsWith("video/") || MEDIA_EXTS.has(ext)) {
    return { Icon: Play, label: "Play", filled: true };
  }
  return { Icon: Eye, label: "Preview" };
}

// Density-based class helpers (module scope: stable reference, not rebuilt per render)
const DENSITY_CLASSES = {
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
} satisfies Record<string, Record<DensityMode, string>>;

/**
 * Roving-focus navigation is ARITHMETIC on absolute item indices (data-idx):
 * we own the virtualized layout, so Up/Down move by `perRow` and Left/Right by
 * 1 — exact in both the grid and the list, including rows that are not
 * currently mounted (the caller scrolls them into view first).
 */
function neighbourIndex(currentIdx: number, key: string, perRow: number, total: number): number {
  switch (key) {
    case "ArrowRight": return currentIdx + 1;
    case "ArrowLeft": return currentIdx - 1;
    case "ArrowDown": return currentIdx + perRow;
    case "ArrowUp": return currentIdx - perRow;
    case "Home": return 0;
    case "End": return total - 1;
    default: return -1;
  }
}

const FileIconForItem = memo(function FileIconForItem({ item, large, fill, className }: { item: FileItem; large?: boolean; fill?: boolean; className?: string }) {
  const ext = (item.extension || "").toLowerCase();
  const isImage = item.mime.startsWith("image/") || IMAGE_EXTS.has(ext);
  const isAudio = item.mime.startsWith("audio/") || AUDIO_EXTS.has(ext);
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
  onUploadToPath,
  onUpload,
  onUploadFolder,
  hasMore,
  onLoadMore,
  isLoadingMore,
  error,
  onRetry,
  density = "comfortable",
  folderPath,
}: FileBrowserProps) {
  const visibleColumns = useUI((s) => s.visibleColumns);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  // Reactive handle to the real scroll container. The loading/error branches
  // render WITHOUT this element, so a mount-time-only ref/observer would
  // never attach (grid columns would collapse to 1). State re-runs the
  // measurement effects once the element actually exists.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    dropZoneRef.current = el;
    setScrollEl(el);
  }, []);
  const itemsGridRef = useRef<HTMLDivElement>(null);

  // When the visible folder changes, jump back to the top instead of
  // preserving the old scroll offset mid-list.
  const prevFolder = useRef(folderPath);
  useEffect(() => {
    if (prevFolder.current !== folderPath) {
      prevFolder.current = folderPath;
      anchorIdxRef.current = null;
      dropZoneRef.current?.scrollTo({ top: 0 });
    }
  }, [folderPath]);

  // Internal move-drags require write access; select-mode is NOT required —
  // dragging works any time, matching a desktop file manager.
  const moveDragEnabled = canWrite && !!onDropItem;
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
      // Veil reacts to OS-file upload drags only — internal move drags
      // highlight their own targets and must not dim every item.
      if (!canWrite || ![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      if (!canWrite || ![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.currentTarget === dropZoneRef.current) setDragOver(false);
    };
    const handleDrop = (e: DragEvent) => {
      // Always stop the browser from navigating on stray drops.
      if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
    };
    const zone = scrollEl;
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
  }, [canWrite, scrollEl]);

  // ── Internal move-drag plumbing ──────────────────────────────────────
  const draggedPaths = useDragMove((s) => (s.active ? s.paths : null));
  /** Which interaction the highlighted folder is offering. */
  const [dropKind, setDropKind] = useState<"move" | "upload">("move");

  /** Drag-start: drags the selection when the item is part of it, else just the item. */
  const startMoveDrag = useCallback((e: React.DragEvent, item: FileItem) => {
    if (!moveDragEnabled) return;
    let chosen: FileItem[];
    if (selection.has(item.path)) {
      chosen = items.filter((i) => selection.has(i.path));
      if (chosen.length === 0) chosen = [item];
    } else {
      chosen = [item];
    }
    beginDragMove(e, payloadFromItems(chosen));
  }, [moveDragEnabled, selection, items]);

  /** Handlers for folder tiles/rows acting as drop destinations —
   *  internal move drags AND OS-file upload drags. */
  const folderDropHandlers = (item: FileItem) =>
    item.is_dir
      ? {
          onDragOver: (e: React.DragEvent) => {
            const types = [...(e.dataTransfer?.types ?? [])];
            if (types.includes("Files")) {
              if (!onUploadToPath) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDropTarget(item.path);
              setDropKind("upload");
              return;
            }
            if (!isInternalMoveDragEvent(e)) return;
            const paths = currentDragPaths();
            // Invalid destination (self / descendant / read-only): no
            // preventDefault → browser shows the forbidden cursor.
            if (!canDropInto(item.path, paths)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropTarget(item.path);
            setDropKind("move");
          },
          onDragLeave: () => setDropTarget((t) => (t === item.path ? null : t)),
          onDrop: (e: React.DragEvent) => {
            const wasInternal = isInternalMoveDragEvent(e);
            const isFiles = [...(e.dataTransfer?.types ?? [])].includes("Files");
            setDropTarget(null);
            if (!wasInternal && !isFiles) return;
            e.preventDefault();
            e.stopPropagation();
            if (wasInternal) {
              const paths = currentDragPaths();
              endDragMove();
              if (!paths.length || !canDropInto(item.path, paths)) return;
              onDropItem?.(item, paths);
            } else if (isFiles && onUploadToPath && e.dataTransfer.files.length > 0) {
              onUploadToPath(e.dataTransfer.files, item.path);
            }
          },
        }
      : {};

  const handleItemClick = (item: FileItem, e: React.MouseEvent) => {
    const idx = Number((e.currentTarget as HTMLElement).dataset.idx);
    if (Number.isFinite(idx) && !e.shiftKey && !e.metaKey && !e.ctrlKey) anchorIdxRef.current = idx;
    if (selectMode) {
      onSelect(item, e);
    } else if (e.metaKey || e.ctrlKey || e.shiftKey) {
      onSelect(item, e);
    } else {
      onOpen(item);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, item: FileItem) => {
    switch (e.key) {
      case "Enter":
      case " ":
        if (e.key === " " && (e.target as HTMLElement).tagName === "INPUT") return;
        e.preventDefault();
        onOpen(item);
        break;
    }
  };

  // Roving focus: arrows move keyboard focus between items (grid-aware).
  // Shift+arrows/Home/End extend the selection from the anchor item;
  // plain navigation just moves focus and moves the anchor.
  const anchorIdxRef = useRef<number | null>(null);

  const selectRange = useCallback((from: number, to: number) => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    useUI.getState().setSelection(items.slice(lo, hi + 1).map((i) => i.path));
  }, [items]);

  // --- Virtualization (react-virtual): keeps DOM small for huge folders ---
  // NOTE: every hook here runs unconditionally — this block sits ABOVE all
  // early returns so React sees a stable hook count across renders.
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    if (!scrollEl || typeof ResizeObserver === "undefined") return;
    setContainerW(scrollEl.clientWidth);
    const ro = new ResizeObserver((entries) => setContainerW(entries[0].contentRect.width));
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl]);

  // Horizontal padding of the grid container per density (matches DENSITY_CLASSES.grid p-*)
  const padX = density === "compact" ? 12 : density === "spacious" ? 32 : 24;
  const gridGap = density === "compact" ? 6 : density === "spacious" ? 16 : 12;
  const gridCols = Math.max(1, Math.floor((containerW - padX * 2 + gridGap) / (150 + gridGap)));
  const gridRowCount = Math.max(1, Math.ceil(items.length / gridCols));

  const listVirt = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollEl,
    // Card list: row height + bottom gap between cards.
    estimateSize: () => (density === "compact" ? 50 : density === "spacious" ? 84 : 70),
    overscan: 10,
  });
  const gridVirt = useVirtualizer({
    count: gridRowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => (density === "compact" ? 210 : density === "spacious" ? 256 : 236),
    overscan: 4,
  });

  const handleArrowNavigation = useCallback((e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const key = e.key;
    const isArrow = key === "ArrowDown" || key === "ArrowUp" || key === "ArrowLeft" || key === "ArrowRight";
    if (!isArrow && key !== "Home" && key !== "End") return;

    // Absolute index of the focused item (rendered tiles carry data-idx).
    const active = document.activeElement as HTMLElement | null;
    if (!active?.hasAttribute("data-file-item")) return;
    const idx = Number(active.dataset.idx);
    if (!Number.isFinite(idx)) return;

    const perRow = viewMode === "grid" ? gridCols : 1;
    const want = neighbourIndex(idx, key, perRow, items.length);
    e.preventDefault(); // we handle the key — stop native scrolling
    if (want < 0 || want >= items.length) return;

    // Focus the target tile; if its row is not mounted (virtualized out),
    // scroll it into range first and focus after the re-render settles.
    const focusAbs = () => {
      itemsGridRef.current
        ?.querySelector<HTMLElement>(`[data-file-item][data-idx="${want}"]`)
        ?.focus();
    };
    const mounted = itemsGridRef.current?.querySelector<HTMLElement>(`[data-file-item][data-idx="${want}"]`);
    if (mounted) {
      mounted.focus();
    } else {
      const row = viewMode === "grid" ? Math.floor(want / gridCols) : want;
      const virt = viewMode === "grid" ? gridVirt : listVirt;
      virt.scrollToIndex(row, { align: key === "Home" ? "start" : key === "End" ? "end" : "auto" });
      requestAnimationFrame(() => requestAnimationFrame(focusAbs));
    }

    if (e.shiftKey) {
      selectRange(anchorIdxRef.current ?? idx, want);
    } else {
      anchorIdxRef.current = want;
    }
  }, [items.length, viewMode, gridCols, gridVirt, listVirt, selectRange]);

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
          <div className="inline-flex p-4 rounded-2xl bg-danger/10 text-danger mb-4">
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
      <div
        ref={dropZoneRef}
        className={cn(
          "h-full grid place-items-center p-8 rounded-2xl transition-all duration-200",
          dragOver && "bg-accent/[0.06] ring-2 ring-inset ring-accent/50 scale-[0.995]",
        )}
      >
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

  const dc = DENSITY_CLASSES;
  const d = density;

  return (
    <div ref={attachScroll} className="flex-1 overflow-auto hide-scrollbar">
      {viewMode === "grid" ? (
        <>
          <div
            ref={itemsGridRef}
            onKeyDown={handleArrowNavigation}
            className={cn(DENSITY_CLASSES.grid[d])}
            role="listbox"
            aria-multiselectable="true"
            aria-label="File grid"
          >
              {/* Virtualized rows of gridCols tiles each */}
              <div style={{ height: gridVirt.getTotalSize(), position: "relative" }}>
              {gridVirt.getVirtualItems().map((vr) => {
                const rowStart = vr.index * gridCols;
                const rowItems = items.slice(rowStart, rowStart + gridCols);
                return (
                <div
                  key={vr.key}
                  data-index={vr.index}
                  ref={gridVirt.measureElement}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vr.start}px)` }}
                >
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`, gap: gridGap }}>
                {rowItems.map((item, colIdx) => {
                const index = rowStart + colIdx;
                const selected = selection.has(item.path);
                const action = hoverActionFor(item);
                const ActionIcon = action.Icon;
                return (
                  <motion.div
                    key={item.path}
                    tabIndex={0}
                    data-file-item
                    data-idx={index}
                    role="option"
                    aria-selected={selected}
                    onClick={(e) => handleItemClick(item, e)}
                    onContextMenu={(e) => onContextMenu(e, item)}
                    onKeyDown={(e) => handleKeyDown(e, item)}
                    draggable={moveDragEnabled || undefined}
                    // framer-motion re-types onDragStart for its gesture API;
                    // we need the native HTML5 drag event.
                    onDragStart={((e: React.DragEvent) => startMoveDrag(e, item)) as never}
                    onDragEnd={endDragMove}
                    {...folderDropHandlers(item)}
                    whileHover={{ y: -6 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      "group relative flex flex-col items-center text-center transition-all duration-200 cursor-pointer rounded-2xl",
                      // Clear, consistent selection + hover affordance (was opacity dimming)
                      selected
                        ? "bg-accent/10 ring-1 ring-inset ring-accent/40"
                        : "hover:bg-glass-bg-subtle",
                      dropTarget === item.path
                        ? "relative z-10 ring-2 ring-accent/80 scale-[1.04] bg-accent/10 shadow-[0_0_0_5px_rgba(91,140,255,0.14),0_14px_36px_-10px_rgba(91,140,255,0.45)]"
                        : "",
                      draggedPaths?.includes(item.path) ? "opacity-40 saturate-50" : ""
                    )}
                  >
                    <div className="w-full h-36 flex items-center justify-center mb-0 transition-transform duration-300 relative">
                      <FileIconForItem item={item} large className={dc.gridIcon[d]} />

                      {!selectMode && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-200">
                          <div className="flex gap-2 p-1.5 rounded-2xl bg-glass-bg-strong backdrop-blur-2xl border border-glass-border shadow-2xl dark:border-white/10" onClick={(e) => e.stopPropagation()}>
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={(e) => { e.stopPropagation(); onOpen(item); }}
                              className="p-2 rounded-xl text-white hover:bg-accent transition-colors bg-accent/60"
                              title={action.label}
                              aria-label={action.label}
                            >
                              <ActionIcon className="h-4 w-4" fill={action.filled ? "currentColor" : "none"} />
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
                              aria-label={`More actions for ${item.name}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </motion.button>
                          </div>
                        </div>
                      )}

                      {dropTarget === item.path && (
                        <div className="absolute inset-0 z-10 rounded-2xl bg-accent/[0.08] border border-accent/40 pointer-events-none grid place-items-center">
                          <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg shadow-accent/40 animate-scale-in">
                            {dropKind === "upload" ? "Upload here" : "Move here"}
                          </span>
                        </div>
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
                              aria-label={`Select ${item.name}`}
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
                </div>
                </div>
              );
              })}
              </div>
          </div>
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
          {/* Grid owns both the sticky header row and data rows for valid ARIA ownership. */}
          <div ref={itemsGridRef} role="grid" aria-multiselectable="true" aria-rowcount={items.length + 1} aria-label="File list" onKeyDown={handleArrowNavigation}>
          <div role="row" className={cn(
            "grid grid-cols-[auto_1fr_auto_auto] items-center border-b border-glass-border-soft/80 sticky top-0 z-10 mb-1.5 bg-background/80 backdrop-blur-md rounded-lg",
            dc.listHeader[d]
          )}>
            <span role="columnheader" className="flex justify-center items-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                aria-label="Select all files"
                className={cn("rounded border-2 border-glass-border bg-glass-bg text-accent focus:ring-accent cursor-pointer transition-all", dc.headerCheckbox[d])}
              />
            </span>
            <span role="columnheader" className="truncate font-semibold uppercase tracking-wider text-[11px] text-text-tertiary">
              <span className="hidden sm:inline">Name</span>
              <span className="sm:hidden">File</span>
            </span>
            {visibleColumns.size && (
              <span role="columnheader" className={cn("text-right truncate font-semibold uppercase tracking-wider text-[11px] text-text-tertiary/80", dc.listSizeWidth[d])}>Size</span>
            )}
            {visibleColumns.modified && (
              <span role="columnheader" className={cn("text-right truncate font-semibold uppercase tracking-wider text-[11px] text-text-tertiary/80", dc.listDateWidth[d])}>
                <span className="hidden md:inline">Modified</span>
                <span className="md:hidden">Date</span>
              </span>
            )}
          </div>

              {/* Virtualized rows: plain positioning wrapper (measured) + row content */}
              <div style={{ height: listVirt.getTotalSize(), position: "relative", width: "100%" }}>
              {listVirt.getVirtualItems().map((vr) => {
                const item = items[vr.index];
                const index = vr.index;
                const selected = selection.has(item.path);
                const action = hoverActionFor(item);
                const ActionIcon = action.Icon;
                return (
                  <div
                    key={item.path}
                    data-index={vr.index}
                    ref={listVirt.measureElement}
                    className={d === "compact" ? "pb-1" : "pb-2"}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vr.start}px)` }}
                  >
                  <div
                    tabIndex={0}
                    data-file-item
                    data-idx={index}
                    role="row"
                    aria-selected={selected}
                    onClick={(e) => handleItemClick(item, e)}
                    onContextMenu={(e) => onContextMenu(e, item)}
                    onKeyDown={(e) => handleKeyDown(e, item)}
                    draggable={moveDragEnabled || undefined}
                    onDragStart={(e) => startMoveDrag(e, item)}
                    onDragEnd={endDragMove}
                    {...folderDropHandlers(item)}
                    className={cn(
                      // Line-by-line card: bordered surface per row with a
                      // gentle hover lift — mirrors the Home cards' language.
                      "group relative grid grid-cols-[auto_1fr_auto_auto] items-center cursor-pointer rounded-2xl border transition-all duration-200",
                      "bg-glass-bg-subtle shadow-[0_1px_2px_rgba(0,0,0,0.05)]",
                      dc.listRow[d],
                      selected
                        ? "bg-accent/10 border-accent/40 ring-1 ring-inset ring-accent/30"
                        : "border-glass-border-soft hover:border-accent/40 hover:bg-glass-bg hover:shadow-md hover:-translate-y-px",
                      dropTarget === item.path
                        ? "border-accent/60 ring-2 ring-accent/80 shadow-[0_0_0_4px_rgba(91,140,255,0.14)]"
                        : "",
                      draggedPaths?.includes(item.path) ? "opacity-40 saturate-50" : ""
                    )}
                  >
                    {/* Checkbox — hidden on idle rows (matches grid view);
                        fully visible on ALL rows while select mode is active
                        (right-click → Select) or once the row is selected. */}
                    <div role="gridcell" className="flex justify-center items-center">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.name}`}
                        className={cn(
                          "rounded border-2 border-glass-border bg-glass-bg text-accent focus:ring-2 focus:ring-accent/50 cursor-pointer transition-all",
                          selected || selectMode
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100",
                          dc.checkbox[d]
                        )}
                        checked={selected}
                        onChange={(e) => onSelect(item, e)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {/* Icon + Name + Tags + Actions */}
                    <div role="gridcell" className="flex items-center gap-3 min-w-0">
                      <div className={cn("shrink-0 flex items-center justify-center", dc.listIcon[d])}>
                        <FileIconForItem item={item} className={dc.listIconInner[d]} />
                      </div>
                      <span className={cn("truncate transition-colors", dc.listName[d], item.is_dir ? "font-semibold" : "font-medium", selected ? "text-foreground" : "text-text-primary group-hover:text-accent")} title={item.name}>
                        {item.name}
                      </span>

                      {item.tags && item.tags.length > 0 && (
                        <div className="flex items-center gap-1 overflow-hidden shrink-0 max-w-[30%]">
                          {item.tags.map(t => <TagChip key={t.id} tag={t} small />)}
                        </div>
                      )}

                      {visibleColumns.kind && (
                        <span className="text-[10px] font-medium text-text-tertiary hidden lg:inline capitalize px-1.5 py-0.5 rounded bg-glass-bg-subtle border border-glass-border-soft">
                          {item.is_dir ? "Folder" : (item.extension ? item.extension.replace(/^\./, "").toUpperCase() : "File")}
                        </span>
                      )}

                      {/* Floating action pill — anchored to the row's right edge,
                          slides in over the size/date cells on hover (no layout shift). */}
                      {!selectMode && (
                        <div
                          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex items-center gap-0.5 rounded-xl border border-glass-border bg-surface/95 backdrop-blur-md shadow-lg p-1 opacity-0 translate-x-1.5 group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 group-focus-within:translate-x-0 transition-all duration-150"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={(e) => { e.stopPropagation(); onOpen(item); }}
                            className="p-1.5 rounded-lg text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors"
                            title={action.label}
                            aria-label={action.label}
                          >
                            <ActionIcon className="h-4 w-4" fill={action.filled ? "currentColor" : "none"} />
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={(e) => { e.stopPropagation(); onContextMenu(e, item); }}
                            className="p-1.5 rounded-lg text-text-secondary hover:text-foreground hover:bg-glass-bg transition-colors"
                            title="More actions"
                            aria-label={`More actions for ${item.name}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </motion.button>
                        </div>
                      )}
                    </div>

                    {/* Size */}
                    {visibleColumns.size && (
                      <span role="gridcell" className={cn("text-right font-medium text-text-tertiary tabular-nums truncate", dc.listMeta[d], dc.listSizeWidth[d])}>
                        {item.is_dir ? "—" : formatBytes(item.size)}
                      </span>
                    )}

                    {/* Modified */}
                    {visibleColumns.modified && (
                      <span role="gridcell" className={cn("text-right font-medium text-text-tertiary/90 tabular-nums truncate", dc.listMeta[d], dc.listDateWidth[d])}>
                        {formatDate(item.modified)}
                      </span>
                    )}
                  </div>
                  </div>
                );
              })}
              </div>
          </div>
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
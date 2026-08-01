import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Search, Grid, Layout, Trash2, AlertCircle, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateLabel } from "@/lib/format";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Modal } from "../Modal";
import { useUI } from "@/store";

import { PhotoGrid } from "./PhotoGrid";
import { PhotoViewer } from "./PhotoViewer";
import { YearNavigator } from "./YearNavigator";
import { FilterBar } from "./FilterBar";
import { SelectionToolbar } from "./SelectionToolbar";
import { PhotoContextMenu } from "./PhotoContextMenu";
import { DensitySelector } from "./DensitySelector";
import { usePhotos, usePhotoSelection, useDebouncedValue } from "./hooks";
import { PhotoResult, PhotoFilters, PhotosResponse, Density, ViewMode } from "./types";
import { Root } from "@/api/types";
import { PhotoCard } from "./PhotoCard";
import { post, del } from "@/api/client";
import { rawUrl } from "@/lib/preview";

const STORAGE_KEY_DENSITY = "nexora.photos.density";
const STORAGE_KEY_VIEW_MODE = "nexora.photos.viewMode";
const SCROLL_KEY_PREFIX = "nexora.photos.scroll.";
const MAX_BULK_SHARE = 20;

interface PhotosViewProps {
  roots: Root[];
  onOpen: (rootId: string, path: string) => void;
  onPreview?: (rootId: string, path: string) => void;
}

export default function PhotosView({ roots, onOpen, onPreview }: PhotosViewProps) {
  const pushToast = useUI((s) => s.pushToast);

  // Density persistence
  const [density, setDensity] = useState<Density>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(STORAGE_KEY_DENSITY) as Density) || "comfortable";
    }
    return "comfortable";
  });
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_DENSITY, density);
  }, [density]);

  // View mode persistence
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(STORAGE_KEY_VIEW_MODE) as ViewMode) || "grid";
    }
    return "grid";
  });
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_VIEW_MODE, viewMode);
  }, [viewMode]);

  // Search (debounced so we don't hammer the API on every keystroke)
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  // Filters
  const [filters, setFilters] = useState<PhotoFilters>({
    year: undefined,
    month: undefined,
    cameraMake: undefined,
    hasLocation: undefined,
    favoritesOnly: false,
    dateFrom: undefined,
    dateTo: undefined,
    sort: "date_desc",
  });

  // Data fetching
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch,
  } = usePhotos(filters, debouncedSearch);

  // Flatten pages
  const photos = useMemo(() => data?.pages.flatMap((p: PhotosResponse) => p.items) || [], [data]);

  // Server-provided total (first page) is authoritative when present.
  const totalCount = data?.pages[0]?.total_count ?? photos.length;

  // Scroll-position key for this exact filter/search combination.
  const scrollKey = useMemo(() => {
    const parts = [
      debouncedSearch,
      filters.year ?? "",
      filters.month ?? "",
      filters.cameraMake ?? "",
      filters.hasLocation ? "loc" : "",
      filters.favoritesOnly ? "fav" : "",
      filters.dateFrom ?? "",
      filters.dateTo ?? "",
      filters.sort,
    ];
    return parts.join("|");
  }, [debouncedSearch, filters]);

  // Year facets for navigator
  const yearFacets = useMemo(() => {
    const yearMap = new Map<number, number>();
    for (const p of photos) {
      if (!p.date_taken) continue;
      const year = new Date(p.date_taken).getFullYear();
      if (isNaN(year)) continue;
      yearMap.set(year, (yearMap.get(year) || 0) + 1);
    }
    return Array.from(yearMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([year, count]) => ({ year, count }));
  }, [photos]);

  // Camera facets for filter
  const cameraFacets = useMemo(() => {
    const makes = new Map<string, number>();
    for (const p of photos) {
      if (p.make) makes.set(p.make, (makes.get(p.make) || 0) + 1);
    }
    return Array.from(makes.entries())
      .map(([make, count]) => ({ make, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [photos]);

  // Selection
  const { selectedIds, isSelecting, toggleSelection, clearSelection, selectionCount } = usePhotoSelection();

  // Viewer
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [viewerPanel, setViewerPanel] = useState<"info" | "map" | null>(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ photo: PhotoResult; x: number; y: number } | null>(null);

  // Confirm-delete dialog state
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "single" | "bulk"; photo?: PhotoResult; count?: number } | null>(null);

  // Scroll restoration
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const handleScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (scrollElRef.current === el) return;
      // Detach the old element's listener by removing the stored one implicitly:
      // the old element is replaced by the new grid, so listeners on it die with it.
      scrollElRef.current = el;
      if (!el) return;
      const key = SCROLL_KEY_PREFIX + scrollKey;
      const saved = Number(sessionStorage.getItem(key)) || 0;
      if (saved > 0) {
        requestAnimationFrame(() => {
          el.scrollTop = saved;
        });
      }
      el.addEventListener(
        "scroll",
        () => {
          sessionStorage.setItem(key, String(el.scrollTop));
        },
        { passive: true }
      );
    },
    [scrollKey]
  );

  // Handlers
  const handlePhotoClick = useCallback(
    (photo: PhotoResult, index: number) => {
      if (isSelecting) {
        toggleSelection(photo.id);
      } else {
        setViewerPanel(null);
        setViewerIndex(index);
        setIsViewerOpen(true);
      }
    },
    [isSelecting, toggleSelection]
  );

  const handlePhotoContextMenu = useCallback((photo: PhotoResult, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ photo, x: e.clientX, y: e.clientY });
  }, []);

  const handleSelectionToggle = useCallback((id: string) => toggleSelection(id), [toggleSelection]);

  const handleViewerClose = useCallback(() => {
    setIsViewerOpen(false);
    setViewerIndex(null);
  }, []);

  const handleViewerNavigate = useCallback((index: number) => setViewerIndex(index), []);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ── Keyboard shortcuts (viewer handles its own keys while open) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (isViewerOpen) return; // PhotoViewer owns keyboard handling

      if (e.key === "Escape") {
        if (selectionCount > 0) clearSelection();
        else if (contextMenu) setContextMenu(null);
      } else if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const allIds = photos.map((p) => p.id);
        if (allIds.length > 0) {
          for (const id of allIds) toggleSelection(id);
          pushToast("info", `Selected ${allIds.length} photo${allIds.length !== 1 ? "s" : ""} on screen`);
        }
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectionCount > 0) {
        e.preventDefault();
        setConfirmDelete({ kind: "bulk", count: selectionCount });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isViewerOpen, selectionCount, contextMenu, clearSelection, photos, toggleSelection, pushToast]);

  // Click outside context menu
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  // ── Bulk actions ──
  const handleBulkDownload = useCallback(() => {
    const selected = photos.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) return;
    // Sequential anchor clicks avoid popup-blocking (downloads are same-origin
    // and the server sends Content-Disposition: attachment).
    selected.forEach((photo, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = rawUrl(photo.root_id, photo.path, true);
        a.download = photo.name || "";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 120);
    });
    pushToast("info", `Downloading ${selected.length} photo${selected.length !== 1 ? "s" : ""}…`);
  }, [photos, selectedIds, pushToast]);

  const handleBulkShare = useCallback(async () => {
    const selected = photos.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) return;
    const toShare = selected.slice(0, MAX_BULK_SHARE);
    pushToast("info", `Creating share links for ${toShare.length} photo${toShare.length !== 1 ? "s" : ""}…`);
    const urls: string[] = [];
    for (const photo of toShare) {
      try {
        const res = await post<{ share?: { url?: string } }>("/shares", {
          root: photo.root_id,
          path: photo.path,
          scope: "preview",
        });
        if (res?.share?.url) urls.push(res.share.url);
      } catch {
        /* skip failed share */
      }
    }
    if (urls.length > 0) {
      try {
        await navigator.clipboard.writeText(urls.join("\n"));
      } catch {
        /* clipboard unavailable */
      }
      pushToast("success", `Copied ${urls.length} share link${urls.length !== 1 ? "s" : ""} to clipboard`);
      if (selected.length > urls.length) {
        pushToast("info", `${selected.length - urls.length} photo${selected.length - urls.length !== 1 ? "s" : ""} skipped (limit ${MAX_BULK_SHARE})`);
      }
    } else {
      pushToast("error", "Could not create share links");
    }
  }, [photos, selectedIds, pushToast]);

  const runDelete = useCallback(
    async (photosToDelete: PhotoResult[]) => {
      if (photosToDelete.length === 0) return;
      let ok = 0;
      for (const photo of photosToDelete) {
        try {
          await del("/files", { root: photo.root_id, path: photo.path });
          ok++;
        } catch {
          /* continue on failure */
        }
      }
      clearSelection();
      refetch();
      if (ok === photosToDelete.length) {
        pushToast("success", `Deleted ${ok} photo${ok !== 1 ? "s" : ""}`);
      } else if (ok > 0) {
        pushToast("success", `Deleted ${ok} of ${photosToDelete.length} photos`);
      } else {
        pushToast("error", "Could not delete photos");
      }
    },
    [clearSelection, refetch, pushToast]
  );

  const handleConfirmDelete = useCallback(() => {
    if (!confirmDelete) return;
    if (confirmDelete.kind === "single" && confirmDelete.photo) {
      runDelete([confirmDelete.photo]);
    } else {
      const selected = photos.filter((p) => selectedIds.has(p.id));
      runDelete(selected);
    }
    setConfirmDelete(null);
  }, [confirmDelete, photos, selectedIds, runDelete]);

  // Single-photo actions (context menu + viewer)
  const handleToggleFavorite = useCallback(
    async (id: string) => {
      const photo = photos.find((p) => p.id === id);
      if (!photo) return;
      try {
        if (photo.is_favorite) {
          await del("/favorites", { root: photo.root_id, path: photo.path });
        } else {
          await post("/favorites", { root: photo.root_id, path: photo.path });
        }
        refetch();
        pushToast("success", photo.is_favorite ? "Removed from favorites" : "Added to favorites");
      } catch {
        pushToast("error", "Could not update favorite");
      }
    },
    [photos, refetch, pushToast]
  );

  const handleDownload = useCallback(
    (photo: PhotoResult) => {
      const a = document.createElement("a");
      a.href = rawUrl(photo.root_id, photo.path, true);
      a.download = photo.name || "";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      pushToast("info", `Downloading ${photo.name}`);
    },
    [pushToast]
  );

  const handleDelete = useCallback((photo: PhotoResult) => {
    setConfirmDelete({ kind: "single", photo });
  }, []);

  const handleShare = useCallback(
    async (photo: PhotoResult) => {
      try {
        const res = await post<{ share?: { url?: string } }>("/shares", {
          root: photo.root_id,
          path: photo.path,
          scope: "preview",
        });
        if (res?.share?.url) {
          try {
            await navigator.clipboard.writeText(res.share.url);
          } catch {
            /* clipboard unavailable */
          }
          pushToast("success", "Share link copied to clipboard");
        } else {
          pushToast("error", "Could not create share link");
        }
      } catch {
        pushToast("error", "Could not create share link");
      }
    },
    [pushToast]
  );

  const handleCopyPath = useCallback(
    async (photo: PhotoResult) => {
      try {
        await navigator.clipboard.writeText(photo.path);
        pushToast("success", "Path copied to clipboard");
      } catch {
        pushToast("error", "Could not copy path");
      }
    },
    [pushToast]
  );

  const handleViewMetadata = useCallback(
    (photo: PhotoResult) => {
      const index = photos.findIndex((p) => p.id === photo.id);
      if (index >= 0) {
        setViewerPanel("info");
        setViewerIndex(index);
        setIsViewerOpen(true);
      } else {
        pushToast("info", "This photo is not in the current view");
      }
    },
    [photos, pushToast]
  );

  const handleViewOnMap = useCallback(
    (photo: PhotoResult) => {
      const index = photos.findIndex((p) => p.id === photo.id);
      if (index >= 0) {
        setViewerPanel("map");
        setViewerIndex(index);
        setIsViewerOpen(true);
      } else {
        pushToast("info", "This photo is not in the current view");
      }
    },
    [photos, pushToast]
  );

  const handleArchive = useCallback(
    (photo: PhotoResult) => {
      // Archiving is a file-browser concept; from Photos we navigate there.
      onOpen(photo.root_id, photo.path);
    },
    [onOpen]
  );

  const handleAddToAlbum = useCallback(() => {
    pushToast("info", "Albums are not available yet — coming soon");
  }, [pushToast]);

  return (
    <div className="flex flex-col h-full bg-background" data-density={density}>
      {/* Header */}
      <header className="border-b border-glass-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-accent via-accent-secondary to-accent-tertiary">
                Photos
              </h1>
              <span className="text-sm text-content-muted hidden sm:inline">
                {totalCount.toLocaleString()} photo{totalCount !== 1 ? "s" : ""}
                {yearFacets.length > 0 && <span className="mx-2">·</span>}
                {yearFacets.length} year{yearFacets.length !== 1 ? "s" : ""}
                {isSelecting && (
                  <span className="ml-2 text-accent font-medium">{selectionCount} selected</span>
                )}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              {/* Search */}
              <form onSubmit={(e) => e.preventDefault()} className="flex-1 max-w-md">
                <Input
                  variant="search"
                  icon={<Search className="h-4 w-4" />}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search photos…"
                  className="h-10 bg-surface/60 border-glass-border focus:border-accent/50"
                  aria-label="Search photos"
                />
              </form>

              {/* View controls */}
              <div className="flex items-center gap-2">
                <DensitySelector value={density} onChange={setDensity} />

                <div className="flex items-center gap-1 bg-surface/50 rounded-lg p-1 border border-glass-border/50">
                  <button
                    onClick={() => setViewMode("grid")}
                    className={cn(
                      "p-2 rounded-md transition-colors",
                      viewMode === "grid" ? "bg-accent text-accent-foreground" : "text-content-muted hover:text-content"
                    )}
                    aria-label="Grid view"
                    aria-pressed={viewMode === "grid"}
                  >
                    <Grid className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setViewMode("timeline")}
                    className={cn(
                      "p-2 rounded-md transition-colors",
                      viewMode === "timeline" ? "bg-accent text-accent-foreground" : "text-content-muted hover:text-content"
                    )}
                    aria-label="Timeline view"
                    aria-pressed={viewMode === "timeline"}
                  >
                    <Layout className="h-4 w-4" />
                  </button>
                </div>

                <FilterBar
                  filters={filters}
                  onChange={setFilters}
                  cameraFacets={cameraFacets}
                  yearFacets={yearFacets}
                  className="hidden sm:flex"
                />
              </div>

              {/* Mobile Filter Bar — inside sticky header so it stays visible */}
              <FilterBar
                filters={filters}
                onChange={setFilters}
                cameraFacets={cameraFacets}
                yearFacets={yearFacets}
                className="sm:hidden mt-3"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Year Navigator Sidebar */}
        <aside className="hidden lg:block w-48 shrink-0 border-r border-glass-border/50 bg-background/50 backdrop-blur-sm">
          <YearNavigator
            years={yearFacets}
            selectedYear={filters.year}
            onYearSelect={(year) => setFilters((f) => ({ ...f, year: f.year === year ? undefined : year, month: undefined }))}
          />
        </aside>

        {/* Grid/Viewport */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {isLoading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          )}

          {isError && (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-md">
                <AlertCircle className="h-12 w-12 text-destructive/50 mx-auto mb-4" />
                <p className="text-lg font-medium text-destructive mb-2">Failed to load photos</p>
                <p className="text-content-muted text-sm mb-6">
                  {error instanceof Error ? error.message : "An unexpected error occurred."}
                </p>
                <Button onClick={() => refetch()} variant="primary">
                  Try again
                </Button>
              </div>
            </div>
          )}

          {!isLoading && !isError && totalCount === 0 && (
            <div className="flex-1 flex items-center justify-center p-16">
              <div className="text-center">
                <ImageIcon className="h-16 w-16 text-accent/50 mx-auto mb-6" />
                <h2 className="text-2xl font-semibold mb-3">
                  {debouncedSearch || filters.year || filters.cameraMake || filters.favoritesOnly || filters.hasLocation
                    ? "No photos match your filters"
                    : "No photos found"}
                </h2>
                <p className="text-content-muted text-sm max-w-md mx-auto mb-6">
                  {debouncedSearch || filters.year || filters.cameraMake || filters.favoritesOnly || filters.hasLocation
                    ? "Try clearing filters or searching for something else."
                    : "Make sure you have images in an indexed storage root. The background scanner indexes images and extracts metadata every 6 hours."}
                </p>
                <div className="flex items-center justify-center gap-3">
                  {(debouncedSearch || filters.year || filters.cameraMake || filters.favoritesOnly || filters.hasLocation) && (
                    <Button
                      onClick={() =>
                        setFilters({
                          year: undefined,
                          month: undefined,
                          cameraMake: undefined,
                          hasLocation: undefined,
                          favoritesOnly: false,
                          dateFrom: undefined,
                          dateTo: undefined,
                          sort: "date_desc",
                        })
                      }
                      variant="secondary"
                    >
                      Clear filters
                    </Button>
                  )}
                  <Button onClick={() => refetch()} variant={debouncedSearch ? "secondary" : "primary"}>
                    Refresh
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!isLoading && !isError && totalCount > 0 && (
            viewMode === "grid" ? (
              <PhotoGrid
                photos={photos}
                density={density}
                selectedIds={selectedIds}
                isSelecting={isSelecting}
                onPhotoClick={handlePhotoClick}
                onPhotoContextMenu={handlePhotoContextMenu}
                onSelectionToggle={handleSelectionToggle}
                onLoadMore={handleLoadMore}
                hasMore={hasNextPage}
                isLoadingMore={isFetchingNextPage}
                onScrollRef={handleScrollRef}
              />
            ) : (
              <div className="flex-1 min-w-0 overflow-auto custom-scrollbar">
                <TimelineView
                  photos={photos}
                  density={density}
                  selectedIds={selectedIds}
                  isSelecting={isSelecting}
                  onPhotoClick={handlePhotoClick}
                  onPhotoContextMenu={handlePhotoContextMenu}
                  onSelectionToggle={handleSelectionToggle}
                  onLoadMore={handleLoadMore}
                  hasMore={hasNextPage}
                  isLoadingMore={isFetchingNextPage}
                />
              </div>
            )
          )}
        </main>
      </div>

      {/* Selection Toolbar */}
      <AnimatePresence>
        {selectionCount > 0 && (
          <SelectionToolbar
            count={selectionCount}
            totalOnScreen={photos.length}
            onDownload={handleBulkDownload}
            onShare={handleBulkShare}
            onDelete={() => setConfirmDelete({ kind: "bulk", count: selectionCount })}
            onAddToAlbum={handleAddToAlbum}
            onSelectAll={() => {
              for (const id of photos.map((p) => p.id)) toggleSelection(id);
              pushToast("info", `Selected ${photos.length} photo${photos.length !== 1 ? "s" : ""} on screen`);
            }}
            onClear={clearSelection}
          />
        )}
      </AnimatePresence>

      {/* Photo Viewer */}
      <AnimatePresence mode="wait">
        {isViewerOpen && viewerIndex !== null && photos[viewerIndex] && (
          <PhotoViewer
            photos={photos}
            initialIndex={viewerIndex}
            initialPanel={viewerPanel}
            onClose={handleViewerClose}
            onNavigate={handleViewerNavigate}
            onSelectionToggle={handleSelectionToggle}
            selectedIds={selectedIds}
            onDownload={handleDownload}
            onShare={handleShare}
          />
        )}
      </AnimatePresence>

      {/* Confirm delete dialog */}
      <AnimatePresence>
        {confirmDelete && (
          <ConfirmDeleteDialog
            photo={confirmDelete.kind === "single" ? confirmDelete.photo : undefined}
            count={confirmDelete.kind === "bulk" ? (confirmDelete.count ?? 1) : 1}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={handleConfirmDelete}
          />
        )}
      </AnimatePresence>

      {/* Context Menu */}
      <PhotoContextMenu
        contextMenu={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpen={onOpen}
        onPreview={onPreview}
        onToggleFavorite={handleToggleFavorite}
        onDownload={handleDownload}
        onDelete={handleDelete}
        onShare={handleShare}
        onCopyPath={handleCopyPath}
        onAddToAlbum={handleAddToAlbum}
        onViewMetadata={handleViewMetadata}
        onViewOnMap={handleViewOnMap}
        onArchive={handleArchive}
      />
    </div>
  );
}

// ── Confirm delete dialog ──────────────────────────────────────────
function ConfirmDeleteDialog({
  photo,
  count,
  onCancel,
  onConfirm,
}: {
  photo?: PhotoResult;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isBulk = count > 1;
  return (
    <Modal
      title={isBulk ? `Delete ${count} photos?` : `Delete "${photo?.name ?? "photo"}"?`}
      description={
        isBulk
          ? "This will move the selected photos to the trash. You can restore them from the trash later."
          : "This will move the photo to the trash. You can restore it from the trash later."
      }
      icon={<Trash2 className="h-6 w-6 text-destructive" />}
      onClose={onCancel}
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      }
    >
      <p className="text-sm text-content-muted">
        {isBulk
          ? `Are you sure you want to delete ${count} photos? This action moves them to the trash.`
          : `Are you sure you want to delete "${photo?.name}"? This action moves it to the trash.`}
      </p>
    </Modal>
  );
}

// ── Timeline view ──────────────────────────────────────────────────
function TimelineView({
  photos,
  density,
  selectedIds,
  isSelecting,
  onPhotoClick,
  onPhotoContextMenu,
  onSelectionToggle,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: {
  photos: PhotoResult[];
  density: Density;
  selectedIds: Set<string>;
  isSelecting: boolean;
  onPhotoClick: (photo: PhotoResult, index: number) => void;
  onPhotoContextMenu: (photo: PhotoResult, e: React.MouseEvent) => void;
  onSelectionToggle: (id: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, PhotoResult[]>();
    for (const p of photos) {
      const date = new Date(p.date_taken);
      // Fall back to an "unknown date" bucket instead of dropping photos.
      const key = p.date_taken && !isNaN(date.getTime()) ? formatDateLabel(p.date_taken) : "Unknown date";
      const arr = map.get(key) || [];
      arr.push(p);
      map.set(key, arr);
    }
    let offset = 0;
    const sorted = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === "Unknown date") return 1;
      if (b[0] === "Unknown date") return -1;
      return new Date(b[1][0].date_taken).getTime() - new Date(a[1][0].date_taken).getTime();
    });
    return sorted.map(([label, groupPhotos]) => {
      const startIndex = offset;
      offset += groupPhotos.length;
      return { label, photos: groupPhotos, startIndex };
    });
  }, [photos]);

  if (groups.length === 0) return null;

  return (
    <div className="p-6 pt-4 space-y-8">
      {groups.map(({ label, photos: groupPhotos, startIndex }) => (
        <section key={label} className="space-y-4">
          <h2 className="text-lg font-semibold sticky top-0 z-10 bg-background/85 backdrop-blur-sm py-2 border-b border-glass-border/50">
            {label}
            <span className="ml-2 text-sm font-normal text-content-muted">{groupPhotos.length}</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {groupPhotos.map((p, i) => {
              const globalIndex = startIndex + i;
              return (
                <PhotoCard
                  key={p.id}
                  photo={p}
                  index={globalIndex}
                  density={density}
                  isSelected={selectedIds.has(p.id)}
                  isSelecting={isSelecting}
                  onClick={() => onPhotoClick(p, globalIndex)}
                  onContextMenu={(e) => onPhotoContextMenu(p, e)}
                  onSelectionToggle={() => onSelectionToggle(p.id)}
                />
              );
            })}
          </div>
        </section>
      ))}

      {/* Load more (timeline mode has no virtualizer) */}
      {hasMore && (
        <div className="flex justify-center pb-4">
          <Button
            onClick={onLoadMore}
            variant="secondary"
            disabled={isLoadingMore}
            loading={isLoadingMore}
          >
            {isLoadingMore ? "Loading…" : "Load more photos"}
          </Button>
        </div>
      )}
      {!hasMore && photos.length > 0 && (
        <p className="text-center text-xs text-content-muted/50 pb-4">You're all caught up</p>
      )}
    </div>
  );
}

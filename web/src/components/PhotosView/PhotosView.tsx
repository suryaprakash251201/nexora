import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Search, Grid, Layout } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateLabel } from "@/lib/format";
import { Input } from "../ui/Input";
import { AlertCircle, Image as ImageIcon } from "lucide-react";

import { PhotoGrid } from "./PhotoGrid";
import { PhotoViewer } from "./PhotoViewer";
import { YearNavigator } from "./YearNavigator";
import { FilterBar } from "./FilterBar";
import { SelectionToolbar } from "./SelectionToolbar";
import { PhotoContextMenu } from "./PhotoContextMenu";
import { DensitySelector } from "./DensitySelector";
import { usePhotos, usePhotoSelection } from "./hooks";
import { PhotoResult, PhotoFilters, PhotosResponse, Density, ViewMode } from "./types";
import { Root } from "@/api/types";
import { PhotoCard } from "./PhotoCard";
import { post, del } from "@/api/client";
import { rawUrl } from "@/lib/preview";

const STORAGE_KEY_DENSITY = "nexora.photos.density";
const STORAGE_KEY_VIEW_MODE = "nexora.photos.viewMode";

interface PhotosViewProps {
  roots: Root[];
  onOpen: (rootId: string, path: string) => void;
  onPreview?: (rootId: string, path: string) => void;
}

export default function PhotosView({ roots, onOpen, onPreview }: PhotosViewProps) {
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

  // Search
  const [searchQuery, setSearchQuery] = useState("");

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

  // Scroll position
  const gridContainerRef = useRef<HTMLDivElement>(null);

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
  } = usePhotos(filters, searchQuery);

  // Flatten pages
  const photos = useMemo(() => data?.pages.flatMap((p: PhotosResponse) => p.items) || [], [data]);

  // Year facets for navigator
  const yearFacets = useMemo(() => {
    const yearMap = new Map<number, number>();
    for (const p of photos) {
      if (!p.date_taken) continue;
      const year = new Date(p.date_taken).getFullYear();
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
  const {
    selectedIds,
    isSelecting,
    toggleSelection,
    clearSelection,
    selectionCount,
  } = usePhotoSelection();

  // Viewer
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ photo: PhotoResult; x: number; y: number } | null>(null);

  // Handlers
  const handlePhotoClick = useCallback((photo: PhotoResult, index: number) => {
    if (isSelecting) {
      toggleSelection(photo.id);
    } else {
      setViewerIndex(index);
      setIsViewerOpen(true);
    }
  }, [isSelecting, toggleSelection]);

  const handlePhotoContextMenu = useCallback((photo: PhotoResult, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ photo, x: e.clientX, y: e.clientY });
  }, []);

  const handleSelectionToggle = useCallback((id: string) => {
    toggleSelection(id);
  }, [toggleSelection]);

  const handleViewerClose = useCallback(() => {
    setIsViewerOpen(false);
    setViewerIndex(null);
  }, []);

  const handleViewerNavigate = useCallback((index: number) => {
    setViewerIndex(index);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleScroll = useCallback(() => {
    // Scroll position tracking for future use
    if (gridContainerRef.current) {
      // setScrollPosition(gridContainerRef.current.scrollTop);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "Escape") {
        if (isViewerOpen) {
          handleViewerClose();
        } else if (selectionCount > 0) {
          clearSelection();
        } else if (contextMenu) {
          setContextMenu(null);
        }
      } else if (e.key === "ArrowRight" && isViewerOpen && viewerIndex !== null) {
        if (viewerIndex < photos.length - 1) {
          handleViewerNavigate(viewerIndex + 1);
        }
      } else if (e.key === "ArrowLeft" && isViewerOpen && viewerIndex !== null) {
        if (viewerIndex > 0) {
          handleViewerNavigate(viewerIndex - 1);
        }
      } else if ((e.key === "a" && (e.metaKey || e.ctrlKey)) && !isViewerOpen) {
        e.preventDefault();
        const allIds = photos.map((p) => p.id);
        for (const id of allIds) {
          toggleSelection(id);
        }
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectionCount > 0 && !isViewerOpen) {
        handleBulkDelete();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isViewerOpen, viewerIndex, photos.length, selectionCount, contextMenu, handleViewerClose, clearSelection, handleViewerNavigate, photos, toggleSelection]);

  // Click outside context menu
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const totalPhotos = photos.length;

  // Bulk actions
  const handleBulkDownload = useCallback(async () => {
    const selected = photos.filter((p) => selectedIds.has(p.id));
    for (const photo of selected) {
      const url = rawUrl(photo.root_id, photo.path, true);
      window.open(url, "_blank");
    }
  }, [photos, selectedIds]);

  const handleBulkShare = useCallback(async () => {
    const selected = photos.filter((p) => selectedIds.has(p.id));
    const first = selected[0];
    if (first) {
      try {
        await navigator.clipboard.writeText(rawUrl(first.root_id, first.path));
      } catch {
        /* clipboard unavailable */
      }
    }
  }, [photos, selectedIds]);

  const handleBulkDelete = useCallback(async () => {
    const selected = photos.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) return;
    if (!confirm(`Delete ${selected.length} photo(s)? This cannot be undone.`)) return;
    for (const photo of selected) {
      try {
        await del("/files", { root: photo.root_id, path: photo.path });
      } catch {
        /* continue */
      }
    }
    clearSelection();
    refetch();
  }, [photos, selectedIds, clearSelection, refetch]);

  const handleAddToAlbum = useCallback(async () => {
    console.log("Add to album", selectionCount, "photos");
  }, [selectionCount]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Search handled by searchQuery state
  };

  // Context menu actions
  const handleToggleFavorite = useCallback(async (id: string) => {
    const photo = photos.find((p) => p.id === id);
    if (!photo) return;
    try {
      if (photo.is_favorite) {
        await del("/favorites", { root: photo.root_id, path: photo.path });
      } else {
        await post("/favorites", { root: photo.root_id, path: photo.path });
      }
      refetch();
    } catch {
      /* favorite toggle failed */
    }
  }, [photos, refetch]);

  const handleDownload = useCallback((photo: PhotoResult) => {
    window.open(rawUrl(photo.root_id, photo.path, true), "_blank");
  }, []);

  const handleDelete = useCallback(async (photo: PhotoResult) => {
    if (!confirm(`Delete "${photo.name}"? This cannot be undone.`)) return;
    try {
      await del("/files", { root: photo.root_id, path: photo.path });
      refetch();
    } catch {
      /* delete failed */
    }
  }, [refetch]);

  const handleShare = useCallback(async (photo: PhotoResult) => {
    try {
      await navigator.clipboard.writeText(rawUrl(photo.root_id, photo.path));
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  const handleCopyPath = useCallback(async (photo: PhotoResult) => {
    try {
      await navigator.clipboard.writeText(photo.path);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  const handleViewMetadata = useCallback((photo: PhotoResult) => {
    const index = photos.findIndex((p) => p.id === photo.id);
    if (index >= 0) {
      setViewerIndex(index);
      setIsViewerOpen(true);
    }
  }, [photos]);

  const handleViewOnMap = useCallback((photo: PhotoResult) => {
    const index = photos.findIndex((p) => p.id === photo.id);
    if (index >= 0) {
      setViewerIndex(index);
      setIsViewerOpen(true);
    }
  }, [photos]);

  const handleArchive = useCallback((photo: PhotoResult) => {
    // Archiving not implemented yet
    console.log("Archive", photo.name);
  }, []);

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
                {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""}
                {yearFacets.length > 0 && <span className="mx-2">·</span>}
                {yearFacets.length} year{yearFacets.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              {/* Search */}
              <form onSubmit={handleSearch} className="flex-1 max-w-md">
                <Input
                  variant="search"
                  icon={<Search className="h-4 w-4" />}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search photos…"
                  className="h-10 bg-surface/60 border-glass-border focus:border-accent/50"
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
            onYearSelect={(year) => setFilters((f) => ({ ...f, year: f.year === year ? undefined : year }))}
          />
        </aside>

        {/* Grid/Viewport */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden" ref={gridContainerRef} onScroll={handleScroll}>
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
                <button
                  onClick={() => refetch()}
                  className="px-6 py-2.5 rounded-lg bg-accent text-accent-foreground font-medium hover:bg-accent/90 transition"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {!isLoading && !isError && totalPhotos === 0 && (
            <div className="flex-1 flex items-center justify-center p-16">
              <div className="text-center">
                <ImageIcon className="h-16 w-16 text-accent/50 mx-auto mb-6" />
                <h2 className="text-2xl font-semibold mb-3">No photos found</h2>
                <p className="text-content-muted text-sm max-w-md mx-auto mb-6">
                  Make sure you have images in an indexed storage root. 
                  The background scanner indexes images and extracts metadata every 6 hours.
                </p>
                <button
                  onClick={() => refetch()}
                  className="px-6 py-2.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition text-sm font-medium"
                >
                  Refresh
                </button>
              </div>
            </div>
          )}

          {!isLoading && !isError && totalPhotos > 0 && (
            <>
              <div className="flex-1 min-w-0 overflow-auto custom-scrollbar">
                {viewMode === "grid" ? (
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
                    containerRef={gridContainerRef}
                  />
                ) : (
                  <TimelineView
                    photos={photos}
                    selectedIds={selectedIds}
                    isSelecting={isSelecting}
                    onPhotoClick={handlePhotoClick}
                    onPhotoContextMenu={handlePhotoContextMenu}
                    onSelectionToggle={handleSelectionToggle}
                  />
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Selection Toolbar */}
      <AnimatePresence>
        {selectionCount > 0 && (
          <SelectionToolbar
            count={selectionCount}
            onDownload={handleBulkDownload}
            onShare={handleBulkShare}
            onDelete={handleBulkDelete}
            onAddToAlbum={handleAddToAlbum}
            onClear={clearSelection}
          />
        )}
      </AnimatePresence>

      {/* Photo Viewer */}
      <AnimatePresence mode="wait">
        {isViewerOpen && viewerIndex !== null && (
          <PhotoViewer
            photos={photos}
            initialIndex={viewerIndex}
            onClose={handleViewerClose}
            onNavigate={handleViewerNavigate}
            onSelectionToggle={toggleSelection}
            selectedIds={selectedIds}
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
        onAddToAlbum={() => {}}
        onViewMetadata={handleViewMetadata}
        onViewOnMap={handleViewOnMap}
        onArchive={handleArchive}
      />
    </div>
  );
}

// Timeline view component
function TimelineView({
  photos,
  selectedIds,
  isSelecting,
  onPhotoClick,
  onPhotoContextMenu,
  onSelectionToggle,
}: {
  photos: PhotoResult[];
  selectedIds: Set<string>;
  isSelecting: boolean;
  onPhotoClick: (photo: PhotoResult, index: number) => void;
  onPhotoContextMenu: (photo: PhotoResult, e: React.MouseEvent) => void;
  onSelectionToggle: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, PhotoResult[]>();
    for (const p of photos) {
      if (!p.date_taken) continue;
      const key = formatDateLabel(p.date_taken);
      const arr = map.get(key) || [];
      arr.push(p);
      map.set(key, arr);
    }
    let offset = 0;
    const sorted = Array.from(map.entries())
      .sort((a, b) => new Date(b[1][0].date_taken).getTime() - new Date(a[1][0].date_taken).getTime());
    return sorted.map(([label, groupPhotos]) => {
      const startIndex = offset;
      offset += groupPhotos.length;
      return { label, photos: groupPhotos, startIndex };
    });
  }, [photos]);

  return (
    <div className="p-6 pt-4 space-y-8">
      {groups.map(({ label, photos: groupPhotos, startIndex }) => (
        <section key={label} className="space-y-4">
          <h2 className="text-xl font-semibold sticky top-20 z-10 bg-background/80 backdrop-blur-sm py-2 border-b border-glass-border/50">
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
                  density="comfortable"
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
    </div>
  );
}
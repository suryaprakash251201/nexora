import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { favoritesApi, filesApi, sharesApi } from "../../api/endpoints";
import { AnimatePresence, motion } from "motion/react";
import {
  Download, FolderOpen, LayoutGrid, Map as MapIcon, MapPin, Search,
  Share2, Star, Trash2, X, Check, Copy,
} from "lucide-react";
;
import { rawUrl } from "@/lib/preview";
import { useUI } from "@/store";
import { cn } from "@/lib/utils";
import { Gallery } from "./Gallery";
import { MapGallery } from "./MapGallery";
import { PhotoViewer } from "./PhotoViewer";
import { FilterMenu } from "./FilterMenu";
import { SelectionBar } from "./SelectionBar";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useDebouncedValue, useElementSize, useLocalStorage, usePhotos } from "./hooks";
import type { Density, PhotoFilters, PhotoResult, ViewMode } from "./types";
const MAX_BULK_SHARE = 20;
interface RootInfo {
  id: string;
  name: string;
}
interface PhotosViewProps {
  roots: RootInfo[];
  onOpen: (rootId: string, path: string) => void;
  onPreview: (rootId: string, path: string) => void;
}
const EMPTY_FILTERS: PhotoFilters = { sort: "date_desc" };
function isFiltered(f: PhotoFilters, search: string): boolean {
  return !!(
    search ||
    f.year ||
    f.month ||
    f.cameraMake ||
    f.hasLocation ||
    f.favoritesOnly ||
    f.dateFrom ||
    f.dateTo ||
    f.sort !== "date_desc"
  );
}
export default function PhotosView({ roots, onOpen, onPreview }: PhotosViewProps) {
  const pushToast = useUI((s) => s.pushToast);
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>("nexora.photos.viewMode", "gallery");
  const [density, setDensity] = useLocalStorage<Density>("nexora.photos.density", "cozy");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [filters, setFilters] = useState<PhotoFilters>(EMPTY_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "selection" } | { kind: "one"; photo: PhotoResult }>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; photo: PhotoResult } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(0);
  const { photos, hasMore, loading, loadingMore, error, totalCount, reload, loadMore, patch } = usePhotos(
    filters,
    debouncedSearch,
    true
  );
  const selecting = selectedIds.size > 0;
  const filtered = isFiltered(filters, debouncedSearch);
  // Measure header height so sticky day headers land right below it.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    setHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, [viewMode]);
  // Scroll back to top whenever the feed (filters/search) changes.
  useEffect(() => {
    const scroller = document.querySelector("main") as HTMLElement | null;
    scroller?.scrollTo?.({ top: 0 });
  }, [debouncedSearch, filters]);
  // Gallery keyboard shortcuts (viewer owns the keyboard while open).
  useEffect(() => {
    if (viewerIndex !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (contextMenu) setContextMenu(null);
        else if (selecting) setSelectedIds(new Set());
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        if (photos.length) {
          e.preventDefault();
          setSelectedIds(new Set(photos.map((p) => p.id)));
        }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selecting) {
        e.preventDefault();
        setConfirm({ kind: "selection" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerIndex, selecting, photos, contextMenu]);
  /* ------------------------------ derived data ------------------------------ */
  const years = useMemo(() => {
    const s = new Set<number>();
    for (const p of photos) {
      const y = Number((p.date_taken || "").slice(0, 4));
      if (y) s.add(y);
    }
    return [...s].sort((a, b) => b - a);
  }, [photos]);
  const cameras = useMemo(() => {
    const s = new Set<string>();
    for (const p of photos) if (p.make) s.add(p.make);
    return [...s].sort();
  }, [photos]);
  const geoCount = useMemo(() => photos.filter((p) => typeof p.lat === "number" && typeof p.lng === "number").length, [photos]);
  const topCamera = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of photos) {
      if (!p.make) continue;
      const k = [p.make, p.model].filter(Boolean).join(" ");
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let best: [string, number] | null = null;
    for (const [k, n] of counts) if (!best || n > best[1]) best = [k, n];
    return best;
  }, [photos]);
  const favoriteCount = useMemo(() => photos.filter((p) => p.is_favorite).length, [photos]);
  /* -------------------------------- selection ------------------------------- */
  const toggleSelect = useCallback((p: PhotoResult) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
  }, []);
  const selectAllOnScreen = useCallback(() => {
    setSelectedIds((prev) => (prev.size === photos.length ? new Set() : new Set(photos.map((p) => p.id))));
  }, [photos]);
  /* ------------------------------ photo actions ----------------------------- */
  const toggleFavorite = useCallback(
    (p: PhotoResult) => {
      const target = !p.is_favorite;
      patch((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_favorite: target } : x)));
      const apiCall = target ? favoritesApi.add(p.root_id, p.path) : favoritesApi.remove(p.root_id, p.path);
      apiCall
        .then(() => pushToast("success", target ? "Added to favorites" : "Removed from favorites"))
        .catch(() => {
          patch((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_favorite: !target } : x)));
          pushToast("error", "Could not update favorite");
        });
    },
    [patch, pushToast]
  );
  const downloadPhotos = useCallback((list: PhotoResult[]) => {
    if (!list.length) return;
    // Sequential same-origin anchor clicks avoid popup blockers.
    list.forEach((p, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = rawUrl(p.root_id, p.path, true);
        a.download = p.name || "photo";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 150);
    });
  }, []);
  const sharePhotos = useCallback(
    async (list: PhotoResult[]) => {
      if (list.length > MAX_BULK_SHARE) {
        pushToast("error", `Share links are capped at ${MAX_BULK_SHARE} photos — select fewer`);
        return;
      }
      setSharing(true);
      pushToast("info", `Creating share links for ${list.length} photo${list.length === 1 ? "" : "s"}…`);
      const urls: string[] = [];
      for (const p of list) {
        try {
          const res = await sharesApi.create({ root: p.root_id, path: p.path, scope: "preview" });
          if (res?.share?.url) urls.push(res.share.url);
        } catch {
          /* skip failed share */
        }
      }
      setSharing(false);
      if (!urls.length) {
        pushToast("error", "Could not create share links");
        return;
      }
      try {
        await navigator.clipboard.writeText(urls.join("\n"));
        pushToast("success", `Copied ${urls.length} share link${urls.length === 1 ? "" : "s"} to clipboard`);
      } catch {
        pushToast("success", `Created ${urls.length} share link${urls.length === 1 ? "" : "s"}`);
      }
    },
    [pushToast]
  );
  const deletePhotos = useCallback(
    async (list: PhotoResult[]) => {
      setBusy(true);
      const ids = new Set(list.map((p) => p.id));
      let ok = 0;
      for (const p of list) {
        try {
          await filesApi.delete(p.root_id, p.path);
          ok++;
        } catch {
          /* keep going */
        }
      }
      setBusy(false);
      setConfirm(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      patch((prev) => prev.filter((p) => !ids.has(p.id)));
      setViewerIndex((i) => {
        if (i === null) return null;
        const remaining = Math.max(0, photos.length - list.length);
        return Math.max(0, Math.min(i, remaining - 1));
      });
      if (ok === list.length) {
        pushToast("success", `Moved ${ok} photo${ok === 1 ? "" : "s"} to trash`);
      } else if (ok > 0) {
        pushToast("success", `Moved ${ok} of ${list.length} photos to trash`);
      } else {
        pushToast("error", "Could not move photos to trash");
      }
    },
    [patch, pushToast, photos]
  );
  /* ------------------------------ viewer wiring ----------------------------- */
  const openViewerAt = useCallback((index: number) => setViewerIndex(index), []);
  const viewerPhoto = viewerIndex !== null ? photos[viewerIndex] : undefined;
  const handleViewerDelete = useCallback(
    (p: PhotoResult) => {
      setConfirm({ kind: "one", photo: p });
    },
    []
  );
  /* ----------------------------- context menu ------------------------------ */
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);
  const onTileContextMenu = useCallback((e: React.MouseEvent, p: PhotoResult) => {
    e.preventDefault();
    setContextMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 320), photo: p });
  }, []);
  /* --------------------------------- render -------------------------------- */
  const activeFilterCount =
    (filters.year ? 1 : 0) +
    (filters.month ? 1 : 0) +
    (filters.cameraMake ? 1 : 0) +
    (filters.hasLocation ? 1 : 0) +
    (filters.favoritesOnly ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0);
  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* ------------------------------ Header ------------------------------ */}
      <div ref={headerRef} className="sticky top-0 z-20 border-b border-border/30 bg-surface-1/80 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-3 sm:px-5">
          <div className="mr-2 min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-content">Photos</h1>
            <p className="text-xs text-content-muted">
              {totalCount ?? photos.length.toLocaleString()} photo{(totalCount ?? photos.length) === 1 ? "" : "s"}
              {geoCount > 0 && <> · {geoCount} geotagged</>}
              {favoriteCount > 0 && <> · {favoriteCount} favorite{favoriteCount === 1 ? "" : "s"}</>}
              {topCamera && photos.length > 20 && <> · mostly {topCamera[0]}</>}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {/* search */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search photos…"
                className="w-40 rounded-lg border border-border/40 bg-surface-2 py-1.5 pl-8 pr-7 text-sm outline-none transition-all placeholder:text-content-muted focus:w-56 focus:border-accent sm:w-48"
              />
              {search && (
                <button onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-content-muted glass-hover rounded p-0.5">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <FilterMenu filters={filters} onChange={setFilters} availableCameras={cameras} activeCount={activeFilterCount} />
            {/* density */}
            <div className="hidden items-center rounded-lg border border-border/40 p-0.5 sm:flex">
              <button
                onClick={() => setDensity("cozy")}
                aria-label="Cozy density"
                className={cn("rounded-md px-2.5 py-1 text-xs transition-colors", density === "cozy" ? "bg-accent/15 text-accent" : "text-content-muted hover:text-content")}
              >
                Cozy
              </button>
              <button
                onClick={() => setDensity("compact")}
                aria-label="Compact density"
                className={cn("rounded-md px-2.5 py-1 text-xs transition-colors", density === "compact" ? "bg-accent/15 text-accent" : "text-content-muted hover:text-content")}
              >
                Compact
              </button>
            </div>
            {/* view mode */}
            <div className="flex items-center rounded-lg border border-border/40 p-0.5">
              <button
                onClick={() => setViewMode("gallery")}
                aria-label="Gallery view"
                className={cn("rounded-md p-1.5 transition-colors", viewMode === "gallery" ? "bg-accent/15 text-accent" : "text-content-muted hover:text-content")}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode("map")}
                aria-label="Map view"
                className={cn("rounded-md p-1.5 transition-colors", viewMode === "map" ? "bg-accent/15 text-accent" : "text-content-muted hover:text-content")}
              >
                <MapIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        {/* year chips + active filter chips */}
        {(years.length > 1 || filtered) && (
          <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-2 hide-scrollbar sm:px-5">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setFilters((f) => ({ ...f, year: f.year === y ? undefined : y, month: undefined }))}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                  filters.year === y ? "border-accent/50 bg-accent/15 text-accent" : "border-border/40 text-content-muted hover:text-content"
                )}
              >
                {y}
              </button>
            ))}
            {filters.favoritesOnly && (
              <button onClick={() => setFilters((f) => ({ ...f, favoritesOnly: false }))} className="flex shrink-0 items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs text-amber-300">
                <Star className="h-3 w-3 fill-current" /> Favorites <X className="h-3 w-3" />
              </button>
            )}
            {filters.hasLocation && (
              <button onClick={() => setFilters((f) => ({ ...f, hasLocation: false }))} className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">
                <MapPin className="h-3 w-3" /> With location <X className="h-3 w-3" />
              </button>
            )}
            {(filtered || search) && (
              <button
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setSearch("");
                }}
                className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-border/40 px-3 py-1 text-xs text-content-muted hover:text-content"
              >
                <Check className="h-3 w-3" /> Clear all
              </button>
            )}
          </div>
        )}
      </div>
      {/* ------------------------------ Content ------------------------------ */}
      <GalleryContainer>
        {({ width }) =>
          viewMode === "gallery" ? (
            <Gallery
              photos={photos}
              density={density}
              containerWidth={width}
              stickyTop={headerH}
              loading={loading}
              loadingMore={loadingMore}
              hasMore={hasMore}
              error={error}
              onLoadMore={loadMore}
              onRetry={reload}
              selecting={selecting}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onOpenAt={openViewerAt}
              onToggleFavorite={toggleFavorite}
              onContextMenu={onTileContextMenu}
              emptyTitle={filtered ? "No matching photos" : "No photos here yet"}
              emptySubtitle={
                filtered
                  ? "Try clearing the search or filters."
                  : "Photos you index will appear here, grouped by day."
              }
            />
          ) : (
            <MapGallery photos={photos} onOpenAt={openViewerAt} indexOf={(id) => Math.max(0, photos.findIndex((p) => p.id === id))} />
          )
        }
      </GalleryContainer>
      {/* ---------------------------- Selection bar ---------------------------- */}
      {selecting && (
        <SelectionBar
          count={selectedIds.size}
          onScreenCount={photos.length}
          allOnScreenSelected={selectedIds.size === photos.length}
          onSelectAllOnScreen={selectAllOnScreen}
          onFavorite={() => {
            const toFav = photos.filter((p) => selectedIds.has(p.id) && !p.is_favorite);
            toFav.forEach((p) => toggleFavorite(p));
            pushToast("info", toFav.length ? `Favorited ${toFav.length} photo${toFav.length === 1 ? "" : "s"}` : "Already favorites");
          }}
          onDownload={() => downloadPhotos(photos.filter((p) => selectedIds.has(p.id)))}
          onShare={() => void sharePhotos(photos.filter((p) => selectedIds.has(p.id)))}
          onDelete={() => setConfirm({ kind: "selection" })}
          onClear={() => setSelectedIds(new Set())}
          sharing={sharing}
        />
      )}
      {/* ------------------------------ Context menu ------------------------------ */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-50 w-52 rounded-xl border border-border/40 bg-surface-1 p-1 shadow-2xl shadow-black/50 backdrop-blur-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <MenuItem icon={<FolderOpen className="h-4 w-4" />} label="Open in folder" onClick={() => { onOpen(contextMenu.photo.root_id, contextMenu.photo.path); setContextMenu(null); }} />
            <MenuItem
              icon={<Star className={cn("h-4 w-4", contextMenu.photo.is_favorite && "fill-current text-amber-400")} />}
              label={contextMenu.photo.is_favorite ? "Remove from favorites" : "Add to favorites"}
              onClick={() => { toggleFavorite(contextMenu.photo); setContextMenu(null); }}
            />
            <MenuItem icon={<Share2 className="h-4 w-4" />} label="Share" onClick={() => { setContextMenu(null); void sharePhotos([contextMenu.photo]); }} />
            <MenuItem icon={<Download className="h-4 w-4" />} label="Download" onClick={() => { downloadPhotos([contextMenu.photo]); setContextMenu(null); }} />
            <MenuItem
              icon={<Copy className="h-4 w-4" />}
              label="Copy path"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(contextMenu.photo.path);
                  pushToast("success", "Path copied");
                } catch {
                  pushToast("error", "Could not copy path");
                }
                setContextMenu(null);
              }}
            />
            <div className="my-1 h-px bg-border/40" />
            <MenuItem
              danger
              icon={<Trash2 className="h-4 w-4" />}
              label="Move to trash"
              onClick={() => { setConfirm({ kind: "one", photo: contextMenu.photo }); setContextMenu(null); }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {/* -------------------------------- Viewer -------------------------------- */}
      <AnimatePresence>
        {viewerIndex !== null && viewerPhoto && (
          <PhotoViewer
            photos={photos}
            initialIndex={viewerIndex}
            onClose={() => setViewerIndex(null)}
            onNavigate={setViewerIndex}
            onToggleFavorite={toggleFavorite}
            onDelete={handleViewerDelete}
            onOpenInFolder={(p) => onOpen(p.root_id, p.path)}
            onShare={(p) => sharePhotos([p])}
          />
        )}
      </AnimatePresence>
      {/* --------------------------- Confirm dialog --------------------------- */}
      <ConfirmDialog
        open={confirm !== null}
        danger
        title={confirm?.kind === "selection" ? `Delete ${selectedIds.size} photo${selectedIds.size === 1 ? "" : "s"}?` : "Delete this photo?"}
        description={
          confirm === null
            ? undefined
            : confirm.kind === "selection"
              ? `${selectedIds.size} photo${selectedIds.size === 1 ? "" : "s"} selected. This moves them to the trash — you can restore them from there.`
              : `${confirm.photo.name}. This moves it to the trash — you can restore it from there.`
        }
        confirmLabel="Move to trash"
        loading={busy}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "selection") {
            void deletePhotos(photos.filter((p) => selectedIds.has(p.id)));
          } else {
            void deletePhotos([confirm.photo]);
          }
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        danger ? "text-red-400 hover:bg-red-500/15" : "text-content hover:bg-white/5"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
/**
 * Wraps the gallery in a full-width block and reports its content width to the
 * row-packing algorithm. The gallery needs to know the exact width to compute
 * perfect rows — this is the only layout coupling between the two.
 */
function GalleryContainer({ children }: { children: (ctx: { width: number }) => React.ReactNode }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  return (
    <div ref={ref} className="flex flex-1 flex-col">
      {children({ width: size.width })}
    </div>
  );
}
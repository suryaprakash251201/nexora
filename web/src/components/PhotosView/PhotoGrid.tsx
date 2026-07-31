import { useRef, useCallback, useMemo, useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PhotoCard } from "./PhotoCard";
import { PhotoResult } from "@/api/types";
import { Loader2 } from "lucide-react";

type Density = "compact" | "comfortable" | "spacious";

const DENSITY_CONFIG: Record<Density, { cols: { base: number; sm: number; md: number; lg: number; xl: number }; gap: number; cardWidth: number; aspectRatio: number }> = {
  compact: { cols: { base: 3, sm: 4, md: 5, lg: 6, xl: 8 }, gap: 4, cardWidth: 140, aspectRatio: 4 / 3 },
  comfortable: { cols: { base: 2, sm: 3, md: 4, lg: 5, xl: 6 }, gap: 8, cardWidth: 180, aspectRatio: 4 / 3 },
  spacious: { cols: { base: 2, sm: 2, md: 3, lg: 4, xl: 4 }, gap: 16, cardWidth: 240, aspectRatio: 3 / 2 },
};

interface PhotoGridProps {
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
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export function PhotoGrid({
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
  containerRef,
}: PhotoGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const config = DENSITY_CONFIG[density];
  const [containerWidth, setContainerWidth] = useState(0);

  // Update container width on resize
  useEffect(() => {
    const updateWidth = () => {
      if (parentRef.current) {
        setContainerWidth(parentRef.current.clientWidth);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    if (parentRef.current) observer.observe(parentRef.current);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  // Responsive column count
  const columns = useMemo(() => {
    if (containerWidth === 0) return config.cols.base;
    const breakpoints = [
      { min: 1536, cols: config.cols.xl },
      { min: 1024, cols: config.cols.lg },
      { min: 768, cols: config.cols.md },
      { min: 640, cols: config.cols.sm },
      { min: 0, cols: config.cols.base },
    ];
    const bp = breakpoints.find((b) => containerWidth >= b.min);
    return bp?.cols ?? config.cols.base;
  }, [containerWidth, config.cols]);

  // Row height from card width at this breakpoint
  const rowHeight = useMemo(() => {
    if (containerWidth === 0) return 160;
    const cardWidth = Math.max(60, (containerWidth - config.gap * (columns - 1) - 32) / columns);
    return cardWidth / config.aspectRatio + config.gap;
  }, [containerWidth, columns, config.gap, config.aspectRatio]);

  // Virtualize ROWS, not individual photos
  const rowCount = Math.ceil(photos.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current as HTMLDivElement,
    estimateSize: () => rowHeight,
    overscan: 4,
    horizontal: false,
  });

  // Infinite scroll: load more when near the bottom
  const handleScroll = useCallback(() => {
    if (!hasMore || isLoadingMore || !onLoadMore || !parentRef.current) return;
    const el = parentRef.current;
    const scrollTop = el.scrollTop;
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    if (scrollTop + clientHeight >= scrollHeight - 400) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true } as AddEventListenerOptions);
    return () => el.removeEventListener("scroll", handleScroll, { passive: true } as EventListenerOptions);
  }, [handleScroll]);

  const virtualRows = virtualizer.getVirtualItems();

  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        parentRef.current = node;
        if (containerRef) {
          containerRef.current = node;
        }
      }
    },
    [containerRef]
  );

  return (
    <div
      ref={combinedRef}
      className="flex-1 min-w-0 overflow-auto custom-scrollbar"
      role="list"
      aria-label="Photo grid"
    >
      <div
        className="relative"
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
        }}
      >
        {virtualRows.map((virtualRow: { index: number; start: number; size: number }) => {
          const rowStart = virtualRow.index * columns;
          const rowPhotos = photos.slice(rowStart, rowStart + columns);
          return (
            <div
              key={virtualRow.index}
              className="absolute left-0 right-0 px-4"
              style={{
                top: virtualRow.start,
                height: virtualRow.size,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: `${config.gap}px`,
              }}
              role="list"
            >
              {rowPhotos.map((photo, colIndex) => {
                const globalIndex = rowStart + colIndex;
                return (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    index={globalIndex}
                    density={density}
                    isSelected={selectedIds.has(photo.id)}
                    isSelecting={isSelecting}
                    onClick={() => onPhotoClick(photo, globalIndex)}
                    onContextMenu={(e) => onPhotoContextMenu(photo, e)}
                    onSelectionToggle={() => onSelectionToggle(photo.id)}
                    style={{ width: "100%", height: "100%" }}
                  />
                );
              })}
            </div>
          );
        })}

        {/* Load more indicator */}
        {hasMore && isLoadingMore && (
          <div
            className="absolute left-0 right-0 flex items-center justify-center"
            style={{ top: virtualizer.getTotalSize(), height: 60 }}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 text-content-muted text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              Loading more photos…
            </div>
          </div>
        )}

        {/* End marker */}
        {!hasMore && photos.length > 0 && (
          <div
            className="absolute left-0 right-0 flex items-center justify-center"
            style={{ top: virtualizer.getTotalSize(), height: 48 }}
          >
            <p className="text-xs text-content-muted/50">You're all caught up</p>
          </div>
        )}
      </div>
    </div>
  );
}

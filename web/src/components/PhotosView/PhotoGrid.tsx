import { useVirtualizer, Virtualizer } from "@tanstack/react-virtual";
import { useRef, useCallback, useMemo, useEffect } from "react";
import { PhotoCard } from "./PhotoCard";
import { PhotoResult } from "@/api/types";
import { cn } from "@/lib/utils";

type Density = "compact" | "comfortable" | "spacious";

const DENSITY_CONFIG: Record<Density, { cols: { base: number; sm: number; md: number; lg: number; xl: number }; gap: number; cardWidth: number }> = {
  compact: { cols: { base: 3, sm: 4, md: 5, lg: 6, xl: 8 }, gap: 4, cardWidth: 140 },
  comfortable: { cols: { base: 2, sm: 3, md: 4, lg: 5, xl: 6 }, gap: 8, cardWidth: 180 },
  spacious: { cols: { base: 2, sm: 2, md: 3, lg: 4, xl: 4 }, gap: 16, cardWidth: 240 },
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
  containerRef?: React.RefObject<HTMLDivElement>;
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
  const gridRef = useRef<HTMLDivElement>(null);
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
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  // Calculate number of columns based on container width
  const columns = useMemo(() => {
    if (containerWidth === 0) return config.cols.base;
    const cardWidthWithGap = config.cardWidth + config.gap;
    const calculatedCols = Math.max(1, Math.floor((containerWidth + config.gap) / cardWidthWithGap));
    // Clamp to density max
    const maxCols = config.cols.xl;
    return Math.min(calculatedCols, maxCols);
  }, [containerWidth, config.cardWidth, config.gap, config.cols.xl]);

  // Estimate row height based on aspect ratio (4:3) + header space
  const estimateSize = useCallback((index: number) => {
    const cardWidth = (containerWidth - config.gap * (columns - 1)) / columns;
    const cardHeight = cardWidth * (4 / 3); // 4:3 aspect ratio
    return cardHeight + 32; // Add space for potential month header
  }, [containerWidth, columns, config.gap]);

  const virtualizer = useVirtualizer({
    count: photos.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 5,
    horizontal: false,
  });

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    if (!hasMore || isLoadingMore || !onLoadMore || !parentRef.current) return;
    const el = parentRef.current;
    const scrollTop = el.scrollTop;
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    // Trigger load when within 200px of bottom
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll, { passive: true });
  }, [handleScroll]);

  const virtualItems = virtualizer.getVirtualItems();

  // Group items by row for month headers (optional)
  // For simplicity, we render flat grid

  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      parentRef.current = node;
      if (containerRef) {
        // @ts-ignore
        containerRef.current = node;
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
        ref={gridRef}
        className={cn("relative", "grid", `grid-cols-${columns}`, `gap-${config.gap}`, "p-4")}
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
        role="list"
      >
        {virtualItems.map((virtualRow) => (
          <PhotoCard
            key={photos[virtualRow.index]?.id || virtualRow.index}
            photo={photos[virtualRow.index]!}
            index={virtualRow.index}
            density={density}
            isSelected={selectedIds.has(photos[virtualRow.index]?.id || "")}
            isSelecting={isSelecting}
            onClick={() => onPhotoClick(photos[virtualRow.index]!, virtualRow.index)}
            onContextMenu={(e) => onPhotoContextMenu(photos[virtualRow.index]!, e)}
            onSelectionToggle={() => onSelectionToggle(photos[virtualRow.index]!.id)}
            style={{
              position: "absolute",
              top: virtualRow.start,
              left: 0,
              width: "100%",
              height: virtualRow.size,
            }}
          />
        ))}

        {/* Load more indicator */}
        {hasMore && isLoadingMore && (
          <div
            style={{
              position: "absolute",
              top: virtualizer.getTotalSize(),
              left: 0,
              right: 0,
              height: 60,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
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
        {hasMore && !isLoadingMore && photos.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: virtualizer.getTotalSize(),
              left: 0,
              right: 0,
              height: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <p className="text-xs text-content-muted/50">Scroll to load more</p>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useMemo, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useCallback, useRef, useState, useEffect } from "react";
import { useInfiniteQuery, UseInfiniteQueryResult } from "@tanstack/react-query";
import { get } from "@/api/client";
import { PhotoResult, PhotosResponse, PhotoFilters } from "./types";

/**
 * Hook for fetching photos with infinite scroll and filtering
 */
export function usePhotos(filters: PhotoFilters, searchQuery: string) {
  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set("limit", "100");
    if (filters.year) params.set("year", String(filters.year));
    if (filters.month) params.set("month", String(filters.month));
    if (filters.cameraMake) params.set("camera_make", filters.cameraMake);
    if (filters.hasLocation !== undefined) params.set("has_location", String(filters.hasLocation));
    if (filters.favoritesOnly) params.set("favorites_only", "true");
    if (filters.dateFrom) params.set("date_from", filters.dateFrom);
    if (filters.dateTo) params.set("date_to", filters.dateTo);
    if (filters.sort) params.set("sort", filters.sort);
    if (searchQuery) params.set("q", searchQuery);
    return params.toString();
  }, [filters, searchQuery]);

  const queryKey = ["photos", buildQuery()];

  return useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const url = pageParam 
        ? `/photos?cursor=${encodeURIComponent(pageParam)}` 
        : `/photos?${buildQuery()}`;
      return get<PhotosResponse>(url);
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    initialPageParam: undefined as string | undefined,
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Hook for managing photo selection state
 */
export function usePhotoSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setIsSelecting(true);
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
    setIsSelecting(true);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelecting(false);
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const selectRange = useCallback((startId: string, endId: string, allIds: string[]) => {
    const startIndex = allIds.indexOf(startId);
    const endIndex = allIds.indexOf(endId);
    if (startIndex === -1 || endIndex === -1) return;
    
    const [min, max] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
    const rangeIds = allIds.slice(min, max + 1);
    setSelectedIds((prev) => new Set([...prev, ...rangeIds]));
    setIsSelecting(true);
  }, []);

  return {
    selectedIds,
    isSelecting,
    toggleSelection,
    selectAll,
    clearSelection,
    isSelected,
    selectRange,
    count: selectedIds.size,
  };
}

/**
 * Hook for managing fullscreen photo viewer state
 */
export function usePhotoViewer(photos: PhotoResult[]) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [showMetadata, setShowMetadata] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const open = useCallback((index: number) => {
    setCurrentIndex(index);
    setIsOpen(true);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const navigate = useCallback((delta: number) => {
    setCurrentIndex((prev) => Math.max(0, Math.min(photos.length - 1, prev + delta)));
  }, [photos.length]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  }, []);

  const currentPhoto = photos[currentIndex] || null;

  return {
    isOpen,
    currentIndex,
    currentPhoto,
    zoom,
    setZoom,
    pan,
    setPan,
    rotation,
    setRotation,
    showMetadata,
    setShowMetadata,
    showMap,
    setShowMap,
    open,
    close,
    navigate,
    resetView,
  };
}

/**
 * Hook for virtualized grid scroll management
 */
export function useVirtualizedGrid(
  itemCount: number,
  estimateSize: (index: number) => number,
  options: { overscan?: number; onScroll?: () => void } = {}
) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

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

  // Note: Actual virtualizer would be created in component using @tanstack/react-virtual
  // This hook provides shared ref and width state

  return {
    parentRef,
    containerWidth,
  };
}

/**
 * Hook for keyboard navigation in grid
 */
export function useGridKeyboardNavigation(
  itemCount: number,
  columns: number,
  onSelect: (index: number) => void,
  onOpen: (index: number) => void,
  enabled: boolean = true
) {
  const [focusedIndex, setFocusedIndex] = useState(-1);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      let newIndex = focusedIndex;
      const cols = columns;

      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          newIndex = Math.min(focusedIndex + 1, itemCount - 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          newIndex = Math.max(focusedIndex - 1, 0);
          break;
        case "ArrowDown":
          e.preventDefault();
          newIndex = Math.min(focusedIndex + cols, itemCount - 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          newIndex = Math.max(focusedIndex - cols, 0);
          break;
        case "Home":
          e.preventDefault();
          newIndex = 0;
          break;
        case "End":
          e.preventDefault();
          newIndex = itemCount - 1;
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (focusedIndex >= 0) {
            if (e.shiftKey || e.metaKey || e.ctrlKey) {
              onSelect(focusedIndex);
            } else {
              onOpen(focusedIndex);
            }
          }
          break;
        case "Escape":
          // Let parent handle
          break;
        default:
          return;
      }

      if (newIndex !== focusedIndex) {
        setFocusedIndex(newIndex);
        // Scroll into view would be handled by parent
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusedIndex, itemCount, columns, onSelect, onOpen, enabled]);

  return {
    focusedIndex,
    setFocusedIndex,
  };
}

import { useState } from "react";
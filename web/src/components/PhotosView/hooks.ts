import { useCallback, useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { get } from "@/api/client";
import { PhotosResponse, PhotoFilters } from "./types";

/**
 * Debounce a rapidly-changing value (e.g. a search box) so downstream
 * effects/queries only run after the input settles.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function usePhotos(filters: PhotoFilters, searchQuery: string) {
  const buildQuery = useCallback((offset: number) => {
    const params = new URLSearchParams();
    params.set("limit", "100");
    if (offset > 0) params.set("offset", String(offset));
    if (filters.year) params.set("year", String(filters.year));
    if (filters.month) params.set("month", String(filters.month));
    if (filters.cameraMake) params.set("camera_make", filters.cameraMake);
    if (filters.hasLocation) params.set("has_location", "true");
    if (filters.favoritesOnly) params.set("favorites_only", "true");
    if (filters.dateFrom) params.set("date_from", filters.dateFrom);
    if (filters.dateTo) params.set("date_to", filters.dateTo);
    if (filters.sort) params.set("sort", filters.sort);
    if (searchQuery) params.set("q", searchQuery);
    return params.toString();
  }, [filters, searchQuery]);

  return useInfiniteQuery({
    queryKey: ["photos", buildQuery(0)],
    queryFn: async ({ pageParam }) => {
      return get<PhotosResponse>(`/photos?${buildQuery(pageParam as number)}`);
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.has_more) return undefined;
      return allPages.reduce((sum, p) => sum + p.items.length, 0);
    },
    initialPageParam: 0,
    staleTime: 30_000,
    retry: 2,
  });
}

export function usePhotoSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);

  const toggleSelection = useCallback((id: string) => {
    // Compute the next set outside the updater so we can derive state
    // without calling setState from inside another setState updater.
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Keep `isSelecting` in sync with the actual selection set.
  useEffect(() => {
    setIsSelecting(selectedIds.size > 0);
  }, [selectedIds]);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const selectRange = useCallback((startId: string, endId: string, allIds: string[]) => {
    const startIndex = allIds.indexOf(startId);
    const endIndex = allIds.indexOf(endId);
    if (startIndex === -1 || endIndex === -1) return;
    const min = Math.min(startIndex, endIndex);
    const max = Math.max(startIndex, endIndex);
    const rangeIds = allIds.slice(min, max + 1);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of rangeIds) next.add(id);
      return next;
    });
  }, []);

  return {
    selectedIds,
    isSelecting,
    toggleSelection,
    selectAll,
    clearSelection,
    isSelected,
    selectRange,
    selectionCount: selectedIds.size,
  };
}

import { useCallback } from "react";
import { useInfiniteQuery, UseInfiniteQueryResult } from "@tanstack/react-query";
import { get } from "@/api/client";
import { PhotoResult, PhotosResponse, PhotoFilters } from "../types";

/**
 * Hook for fetching photos with infinite scroll and filtering
 */
export function usePhotos(
  filters: PhotoFilters,
  searchQuery: string
): UseInfiniteQueryResult<PhotosResponse, Error> {
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
    
    const min = Math.min(startIndex, endIndex);
    const max = Math.max(startIndex, endIndex);
    const rangeIds = allIds.slice(min, max + 1);
    setSelectedIds(new Set(rangeIds));
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
    selectionCount: selectedIds.size,
  };
}

import { useState, useCallback } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get } from "@/api/client";
import type { PhotoFilters, PhotoResult, PhotosResponse } from "./types";

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw) as T;
    } catch {
      /* corrupted storage — fall through to default */
    }
    return initial;
  });
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* storage may be unavailable */
        }
        return next;
      });
    },
    [key]
  );
  return [value, set];
}

/** Tracks the content-box size of a ref'd element (ResizeObserver). */
export function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function buildPhotoQuery(filters: PhotoFilters, search: string): Record<string, string | number | boolean | undefined> {
  return {
    q: search || undefined,
    year: filters.year,
    month: filters.month,
    camera_make: filters.cameraMake,
    has_location: filters.hasLocation || undefined,
    favorites_only: filters.favoritesOnly || undefined,
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    sort: filters.sort,
  };
}

const PAGE_SIZE = 120;

/**
 * Infinite-scroll photo feed. Pages are merged into a flat list (the gallery
 * re-groups them into days on every render, so pagination never breaks a day).
 */
export function usePhotos(
  filters: PhotoFilters,
  search: string,
  enabled: boolean
) {
  const [photos, setPhotos] = useState<PhotoResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const offsetRef = useRef(0);

  const query = useMemo(() => buildPhotoQuery(filters, search), [filters, search]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Optimistic updates (favorites, deletions) applied on top of the feed.
  const patch = useCallback((fn: (prev: PhotoResult[]) => PhotoResult[]) => {
    setPhotos(fn);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    offsetRef.current = 0;
    get<PhotosResponse>("/photos", { ...query, limit: PAGE_SIZE, offset: 0 })
      .then((res) => {
        if (cancelled) return;
        setPhotos(res.items || []);
        setHasMore(!!res.has_more);
        setTotalCount(res.total_count);
        offsetRef.current = (res.items || []).length;
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Failed to load photos");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, query, reloadKey]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !enabled) return;
    setLoadingMore(true);
    try {
      const res = await get<PhotosResponse>("/photos", {
        ...query,
        limit: PAGE_SIZE,
        offset: offsetRef.current,
      });
      const items = res.items || [];
      setPhotos((prev) => [...prev, ...items]);
      setHasMore(!!res.has_more);
      offsetRef.current += items.length;
    } catch {
      /* transient — the sentinel will retry on next intersection */
    } finally {
      setLoadingMore(false);
    }
  }, [query, hasMore, loadingMore, enabled]);

  return { photos, hasMore, loading, loadingMore, error, totalCount, reload, loadMore, patch };
}

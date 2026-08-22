import { useMemo, useCallback } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { favoritesApi } from "../api/endpoints";
import { useUI } from "../store";

/**
 * Unified favorites hook.
 * Single source of truth for /favorites — queryKey ["favorites"].
 * Previously Workspace had two queries both hitting /favorites:
 *   - favorites (enabled only on /favorites view)
 *   - fav-set   (always enabled for star checks)
 * This hook collapses them into one query that returns both the list and a derived Set.
 *
 * Sidebar, DetailsDrawer, and any other consumer should reuse this same queryKey
 * so React Query dedupes the network request (no redundant /favorites fetches).
 */
export function useFavorites(options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: ["favorites"],
    queryFn: () => favoritesApi.list(),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });

  const favSet = useMemo(() => {
    const items = query.data?.items ?? [];
    return new Set(items.map((f) => `${f.root_id}:${f.path}`));
  }, [query.data]);

  const isFavorite = useCallback(
    (rootId: string, path: string) => favSet.has(`${rootId}:${path}`),
    [favSet]
  );

  return {
    ...query,
    // Derived values for convenience:
    favorites: query.data?.items ?? [],
    favSet,
    isFavorite,
  };
}

/**
 * Mutation to toggle a single favorite. Invalidates ["favorites"] on success
 * so every consumer (Workspace, Sidebar badge, Drawer star) sees the update.
 */
export function useToggleFavorite() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);

  return useMutation({
    mutationFn: async ({ rootId, path, shouldFavorite }: { rootId: string; path: string; shouldFavorite: boolean }) => {
      if (shouldFavorite) {
        await favoritesApi.add(rootId, path);
      } else {
        await favoritesApi.remove(rootId, path);
      }
      return { rootId, path, shouldFavorite };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["favorites"] });
      pushToast("success", vars.shouldFavorite ? "Added to favorites" : "Removed from favorites");
    },
    onError: (e: any) => {
      pushToast("error", e.message || "Failed to update favorite");
    },
  });
}

/**
 * Legacy shape compatibility: some code expects favSet as a query object with .data.items.
 * This helper returns a query-shaped object that shares the same underlying ["favorites"] cache
 * via select — no extra network request.
 */
export function useFavSet() {
  return useQuery({
    queryKey: ["favorites"],
    queryFn: () => favoritesApi.list(),
    staleTime: 30_000,
    select: (data) => data,
  });
}

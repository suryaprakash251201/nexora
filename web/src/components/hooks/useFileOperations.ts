import { useCallback } from 'react';
import { del, post, getBaseUrl } from '../../api/client';
import { trashApi } from '../../api/endpoints';
import { useUI } from '../../store';
import type { QueryClient } from '@tanstack/react-query';
import type { FavoriteItem } from '../../api/types';

export function useFileOperations({
  rootId,
  refresh,
  qc,
  selection,
  clearSelection,
  favSet,
}: {
  rootId: string | null;
  refresh: () => void;
  qc: QueryClient;
  selection: Set<string>;
  clearSelection: () => void;
  favSet: { data?: { items: FavoriteItem[] } };
}) {
  const pushToast = useUI((s) => s.pushToast);

  const doDelete = useCallback(async (p: string) => {
    if (!rootId) return;
    try {
      await del('/files', { root: rootId, path: p });
      const name = p.split('/').pop() || p;
      pushToast('success', `Moved "${name}" to trash`, {
        label: 'Undo',
        onClick: async () => {
          try {
            // Find the freshest trash entry matching what we just deleted.
            const { items } = await trashApi.list();
            const match = items
              .filter((t) => t.root_id === rootId && t.original_path === p)
              .sort((a, b) => (b.deleted_at || '').localeCompare(a.deleted_at || ''))[0];
            if (!match) {
              pushToast('error', 'Could not undo — entry not found in trash');
              return;
            }
            await trashApi.restore(match.id);
            pushToast('success', `Restored "${name}"`);
            refresh();
          } catch (e: any) {
            pushToast('error', e?.message || 'Undo failed');
          }
        },
      });
      refresh();
    } catch (e: any) {
      pushToast('error', e.message);
    }
  }, [rootId, refresh, pushToast]);

  const bulkDelete = useCallback(async () => {
    if (!rootId) return;
    let ok = 0;
    const failures: string[] = [];
    for (const p of Array.from(selection)) {
      try {
        await del('/files', { root: rootId, path: p });
        ok++;
      } catch (e: any) {
        failures.push(`${p.split('/').pop() || p}: ${e.message}`);
      }
    }
    clearSelection();
    // Report honestly: a partial failure is not a success, and the user
    // needs to know which items survived.
    if (ok > 0) pushToast('success', `Moved ${ok} item${ok === 1 ? '' : 's'} to trash`);
    for (const f of failures.slice(0, 3)) pushToast('error', f);
    if (failures.length > 3) pushToast('error', `+${failures.length - 3} more failed`);
    refresh();
  }, [rootId, selection, clearSelection, refresh, pushToast]);

  const archivePaths = useCallback(async (paths: string[], name: string) => {
    if (!rootId || !paths.length) return;
    try {
      const res = await post<{ job: { id: string } }>('/archive', { root: rootId, paths, name });
      pushToast('info', 'Preparing archive…');
      pollArchive(res.job.id, pushToast);
    } catch (e: any) { 
      pushToast('error', e.message); 
    }
  }, [rootId, pushToast]);

  const toggleFavorite = useCallback(async (item: { path: string }) => {
    if (!rootId) return;
    const isFav = favSet.data?.items.some((f) => f.root_id === rootId && f.path === item.path);
    try {
      if (isFav) { 
        await del('/favorites', { root: rootId, path: item.path }); 
        pushToast('success', 'Removed from favorites'); 
      } else { 
        await post('/favorites', { root: rootId, path: item.path }); 
        pushToast('success', 'Added to favorites'); 
      }
      // Single source of truth: ["favorites"]. All consumers (Workspace, Sidebar, Drawer) share this key so React Query dedupes.
      qc.invalidateQueries({ queryKey: ['favorites'] });
    } catch (e: any) { 
      pushToast('error', e.message); 
    }
  }, [rootId, favSet.data?.items, qc, pushToast]);

  return { doDelete, bulkDelete, archivePaths, toggleFavorite };
}

function pollArchive(jobId: string, pushToast: (k: any, m: string) => void) {
  // Resolve against the configured API base — a relative URL never reaches
  // the server in desktop builds pointed at a remote host.
  const es = new EventSource(`${getBaseUrl()}/api/v1/jobs/${jobId}/events`);
  let settled = false;
  const finish = (ok: boolean, msg?: string) => {
    if (settled) return;
    settled = true;
    es.close();
    if (ok) { 
      pushToast('success', 'Archive ready'); 
      window.open(`${getBaseUrl()}/api/v1/jobs/${jobId}/download`, '_blank', 'noopener,noreferrer');
    } else {
      pushToast('error', msg || 'Archive failed');
    }
  };
  es.addEventListener('progress', (ev: MessageEvent) => {
    try {
      const job = JSON.parse(ev.data);
      if (job.status === 'done') finish(true);
      else if (job.status === 'failed') finish(false, job.error);
    } catch { /* ignore */ }
  });
  es.onerror = () => { es.close(); finish(false, 'Archive stream interrupted'); };
}

export async function extractZip(rootId: string, src: string, dest: string, pushToast: (k: any, m: string) => void, refresh: () => void) {
  try {
    await post('/extract', { root: rootId, path: src, destination: dest });
    pushToast('info', 'Extracting archive…');
    // Large archives take longer than any fixed wait — refresh a few times
    // with backoff so the listing converges for both small and huge files.
    const delays = [1500, 4000, 8000];
    for (const d of delays) setTimeout(refresh, d);
  } catch (e: any) {
    pushToast('error', e.message);
  }
}

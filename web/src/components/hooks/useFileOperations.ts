import { useCallback } from 'react';
import { del, post } from '../../api/client';
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
      pushToast('success', 'Moved to trash'); 
      refresh(); 
    } catch (e: any) { 
      pushToast('error', e.message); 
    }
  }, [rootId, refresh, pushToast]);

  const bulkDelete = useCallback(async () => {
    if (!rootId) return;
    for (const p of Array.from(selection)) {
      try { await del('/files', { root: rootId, path: p }); } catch (e: any) { pushToast('error', e.message); }
    }
    clearSelection();
    pushToast('success', 'Items moved to trash');
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
      qc.invalidateQueries({ queryKey: ['favorites'] });
      qc.invalidateQueries({ queryKey: ['fav-set'] });
    } catch (e: any) { 
      pushToast('error', e.message); 
    }
  }, [rootId, favSet.data?.items, qc, pushToast]);

  return { doDelete, bulkDelete, archivePaths, toggleFavorite };
}

function pollArchive(jobId: string, pushToast: (k: any, m: string) => void) {
  const es = new EventSource(`/api/v1/jobs/${jobId}/events`);
  let settled = false;
  const finish = (ok: boolean, msg?: string) => {
    if (settled) return;
    settled = true;
    es.close();
    if (ok) { 
      pushToast('success', 'Archive ready'); 
      window.open(`/api/v1/jobs/${jobId}/download`, '_blank'); 
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
    setTimeout(refresh, 1500);
  } catch (e: any) { 
    pushToast('error', e.message); 
  }
}

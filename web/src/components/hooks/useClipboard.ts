import { useState, useCallback } from 'react';
import { post } from '../../api/client';
import { useUI } from '../../store';

export function useClipboard({
  rootId,
  selection,
  clearSelection,
  refresh,
  canWrite,
}: {
  rootId: string | null;
  selection: Set<string>;
  clearSelection: () => void;
  refresh: () => void;
  canWrite: boolean;
}) {
  const [folderPicker, setFolderPicker] = useState<{ mode: 'move' | 'copy'; paths: string[] } | null>(null);
  const pushToast = useUI((s) => s.pushToast);

  const moveSelectionTo = useCallback(() => {
    if (!rootId || !canWrite) return;
    const srcPaths = Array.from(selection);
    if (srcPaths.length === 0) return;
    setFolderPicker({ mode: 'move', paths: srcPaths });
  }, [rootId, canWrite, selection]);

  const openMovePicker = useCallback(() => {
    const paths = Array.from(selection);
    if (!paths.length) return;
    setFolderPicker({ mode: 'move', paths });
  }, [selection]);

  const openCopyPicker = useCallback(() => {
    const paths = Array.from(selection);
    if (!paths.length) return;
    setFolderPicker({ mode: 'copy', paths });
  }, [selection]);

  // Open the folder picker for an explicit set of paths (e.g. a single item
  // from its context menu, where the bulk selection may be empty).
  const openPickerFor = useCallback((mode: 'move' | 'copy', paths: string[]) => {
    if (!paths.length) return;
    setFolderPicker({ mode, paths });
  }, []);

  // Move an explicit set of paths to a destination folder (used by breadcrumb
  // drop targets and the folder picker). Skips self/descendant moves.
  const movePathsTo = useCallback(async (paths: string[], destPath: string) => {
    if (!rootId) return;
    try {
      let moved = 0;
      for (const p of paths) {
        if (p === destPath || destPath.startsWith(p + '/')) continue; // skip self/descendant
        await post(`/files/move`, {
          root: rootId,
          source: p,
          destination: (destPath ? destPath + '/' : '') + p.split('/').pop()
        });
        moved++;
      }
      if (moved > 0) {
        pushToast('success', `Moved ${moved} item${moved === 1 ? '' : 's'}`);
        clearSelection();
        refresh();
      }
    } catch (e: any) {
      pushToast('error', e.message || 'Move failed');
    }
  }, [rootId, pushToast, clearSelection, refresh]);

  const applyFolderPicker = useCallback(async (destPath: string) => {
    const fp = folderPicker;
    setFolderPicker(null);
    if (!fp || !rootId) return;
    await movePathsTo(fp.paths, destPath);
  }, [folderPicker, rootId, movePathsTo]);

  return {
    folderPicker,
    setFolderPicker,
    moveSelectionTo,
    openMovePicker,
    openCopyPicker,
    openPickerFor,
    applyFolderPicker,
    movePathsTo,
  };
}

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

  const applyFolderPicker = useCallback(async (destPath: string) => {
    const fp = folderPicker;
    setFolderPicker(null);
    if (!fp || !rootId) return;
    const verb = fp.mode === 'move' ? 'Moving' : 'Copying';
    try {
      for (const p of fp.paths) {
        if (p === destPath || destPath.startsWith(p + '/')) continue; // skip self/descendant
        await post(`/files/${fp.mode}`, { 
          root: rootId, 
          source: p, 
          destination: (destPath ? destPath + '/' : '') + p.split('/').pop() 
        });
      }
      pushToast('success', fp.mode === 'move' ? 'Moved' : 'Copied');
      clearSelection();
      refresh();
    } catch (e: any) {
      pushToast('error', e.message || `${verb} failed`);
    }
  }, [folderPicker, rootId, pushToast, clearSelection, refresh]);

  return {
    folderPicker,
    setFolderPicker,
    moveSelectionTo,
    openMovePicker,
    openCopyPicker,
    applyFolderPicker,
  };
}

import { useState, useCallback } from 'react';
import { post } from '../../api/client';
import { useUI } from '../../store';

type ClipMode = 'move' | 'copy';

export function useClipboard({
  rootId,
  path,
  selection,
  clearSelection,
  refresh,
  canWrite,
}: {
  rootId: string | null;
  path: string;
  selection: Set<string>;
  clearSelection: () => void;
  refresh: () => void;
  canWrite: boolean;
}) {
  const [folderPicker, setFolderPicker] = useState<{ mode: ClipMode; paths: string[] } | null>(null);
  const pushToast = useUI((s) => s.pushToast);
  const clipboard = useUI((s) => s.clipboard);
  const setClipboard = useUI((s) => s.setClipboard);

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
  const openPickerFor = useCallback((mode: ClipMode, paths: string[]) => {
    if (!paths.length) return;
    setFolderPicker({ mode, paths });
  }, []);

  // Transfer an explicit set of paths into destPath. Skips self/descendant
  // targets for moves; copies never descend into themselves either but the
  // API handles nesting by suffixing names server-side.
  const transferPaths = useCallback(async (paths: string[], destPath: string, mode: ClipMode) => {
    if (!rootId) return;
    try {
      let moved = 0;
      for (const p of paths) {
        if (p === destPath || destPath.startsWith(p + '/')) continue; // skip self/descendant
        await post(`/files/${mode}`, {
          root: rootId,
          source: p,
          destination: (destPath ? destPath + '/' : '') + p.split('/').pop()
        });
        moved++;
      }
      if (moved > 0) {
        pushToast('success', `${mode === 'move' ? 'Moved' : 'Copied'} ${moved} item${moved === 1 ? '' : 's'}`);
        clearSelection();
        refresh();
      }
    } catch (e: any) {
      pushToast('error', e.message || (mode === 'move' ? 'Move failed' : 'Copy failed'));
    }
  }, [rootId, pushToast, clearSelection, refresh]);

  const applyFolderPicker = useCallback(async (destPath: string) => {
    const fp = folderPicker;
    setFolderPicker(null);
    if (!fp || !rootId) return;
    await transferPaths(fp.paths, destPath, fp.mode);
  }, [folderPicker, rootId, transferPaths]);

  // Back-compat wrapper used by breadcrumb drops (always a move).
  const movePathsTo = useCallback(async (paths: string[], destPath: string) => {
    await transferPaths(paths, destPath, 'move');
  }, [transferPaths]);

  // ---- Ctrl+C / X / V style clipboard ----

  const stash = useCallback((mode: ClipMode) => {
    if (!rootId) return;
    const paths = Array.from(selection);
    if (!paths.length) return;
    setClipboard({ mode, paths, rootId });
    pushToast('info', `${mode === 'move' ? 'Cut' : 'Copied'} ${paths.length} item${paths.length === 1 ? '' : 's'}${mode === 'copy' ? ' — Ctrl+V to paste a copy' : ' — Ctrl+V to move here'}`);
  }, [rootId, selection, setClipboard, pushToast]);

  const copySelection = useCallback(() => stash('copy'), [stash]);
  const cutSelection = useCallback(() => stash('move'), [stash]);

  /** Paste the stashed clipboard into destPath (defaults to current folder). */
  const pasteClipboard = useCallback(async (destPath?: string) => {
    if (!clipboard) return;
    if (!canWrite) { pushToast('error', 'No write access here'); return; }
    if (clipboard.rootId !== rootId) { pushToast('error', 'Clipboard items belong to a different storage'); return; }
    const target = destPath ?? path ?? '';
    // Cut clears the clipboard after a successful paste; copy stays for repeats.
    await transferPaths(clipboard.paths, target, clipboard.mode);
    if (clipboard.mode === 'move') setClipboard(null);
  }, [clipboard, canWrite, rootId, path, transferPaths, setClipboard, pushToast]);

  const clearClipboard = useCallback(() => setClipboard(null), [setClipboard]);

  return {
    folderPicker,
    setFolderPicker,
    moveSelectionTo,
    openMovePicker,
    openCopyPicker,
    openPickerFor,
    applyFolderPicker,
    movePathsTo,
    transferPaths,
    clipboard,
    copySelection,
    cutSelection,
    pasteClipboard,
    clearClipboard,
  };
}

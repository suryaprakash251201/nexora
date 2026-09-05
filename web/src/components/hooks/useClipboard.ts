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
  // Returns true only when every path transferred — callers that clear
  // state (clipboard, selection) key off this.
  const transferPaths = useCallback(async (paths: string[], destPath: string, mode: ClipMode): Promise<boolean> => {
    if (!rootId) return false;
    let moved = 0;
    const failures: string[] = [];
    for (const p of paths) {
      if (p === destPath || destPath.startsWith(p + '/')) continue; // skip self/descendant
      // Dropping back into the item's own folder resolves to the identical
      // path — skip quietly instead of surfacing a server "already
      // exists" error for a no-op (e.g. drop onto the current breadcrumb).
      const base = p.split('/').pop() ?? p;
      if ((destPath ? destPath + '/' : '') + base === p) continue;
      try {
        await post(`/files/${mode}`, {
          root: rootId,
          source: p,
          destination: (destPath ? destPath + '/' : '') + p.split('/').pop()
        });
        moved++;
      } catch (e: any) {
        // Per-item errors must not abort the rest of the batch, and the
        // summary must reflect what actually happened.
        failures.push(`${p.split('/').pop() || p}: ${e?.message || 'failed'}`);
      }
    }
    if (moved > 0) {
      pushToast('success', `${mode === 'move' ? 'Moved' : 'Copied'} ${moved} item${moved === 1 ? '' : 's'}`);
      refresh();
    }
    for (const f of failures.slice(0, 3)) pushToast('error', f);
    if (failures.length > 3) pushToast('error', `+${failures.length - 3} more failed`);
    if (moved > 0 && failures.length === 0) clearSelection();
    return moved > 0 && failures.length === 0;
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
    // Cut clears the clipboard only after a fully successful paste — a
    // failed or partial move keeps the items so the user can retry.
    const ok = await transferPaths(clipboard.paths, target, clipboard.mode);
    if (ok && clipboard.mode === 'move') setClipboard(null);
  }, [clipboard, canWrite, rootId, path, transferPaths, setClipboard, pushToast]);

  const clearClipboard = useCallback(() => setClipboard(null), [setClipboard]);

  return {
    folderPicker,
    setFolderPicker,
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

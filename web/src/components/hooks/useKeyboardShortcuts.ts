import { useEffect } from 'react';
import { useUI } from '../../store';
import type { FileItem } from '../../api/types';

export function useKeyboardShortcuts({
  canWrite,
  view,
  setView,
  selection,
  items,
  bulkDelete,
  setMenu,
  fileInputRef,
  isModalOpen,
  setCommandPaletteOpen,
  setShortcutsModalOpen,
  onCopy,
  onCut,
  onPaste,
}: {
  canWrite: boolean;
  view: string;
  setView: (v: any) => void;
  selection: Set<string>;
  items: FileItem[];
  bulkDelete: () => void;
  setMenu: (menu: { kind: string; item?: FileItem } | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  isModalOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  setShortcutsModalOpen?: (open: boolean) => void;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
}) {
  const setSelectMode = useUI((s) => s.setSelectMode);
  const setSelection = useUI((s) => s.setSelection);
  const clearSelection = useUI((s) => s.clearSelection);
  const selectMode = useUI((s) => s.selectMode);
  const viewMode = useUI((s) => s.viewMode);
  const setViewMode = useUI((s) => s.setViewMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (typing) return;
      if (isModalOpen) return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Command palette
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
      // Keyboard shortcuts modal (Cmd+/ or Shift+/ for ?)
      else if ((mod && e.key === '/') || e.key === '?') {
        e.preventDefault();
        if (setShortcutsModalOpen) setShortcutsModalOpen(true);
      }
      // Search
      else if (e.key === '/') {
        e.preventDefault();
        setView('search');
      }
      // New folder
      else if (e.key.toLowerCase() === 'n' && canWrite && view === 'files') {
        e.preventDefault();
        setMenu({ kind: 'newFolder' });
      }
      // Upload
      else if (e.key.toLowerCase() === 'u' && canWrite && view === 'files') {
        e.preventDefault();
        fileInputRef.current?.click();
      }
      // Delete
      else if (e.key === 'Delete' && selection.size > 0 && canWrite) {
        e.preventDefault();
        bulkDelete();
      }
      // F2 rename (exactly one selected file/folder)
      else if (e.key === 'F2' && canWrite && view === 'files' && selection.size === 1) {
        e.preventDefault();
        const item = items.find((i) => selection.has(i.path));
        if (item) setMenu({ kind: 'rename', item });
      }
      // Select all
      else if (mod && e.key.toLowerCase() === 'a' && view === 'files' && items.length) {
        e.preventDefault();
        if (!selectMode) setSelectMode(true);
        setSelection(items.map((i) => i.path));
      }
      // Escape to clear selection, then pending clipboard
      else if (e.key === 'Escape') {
        if (selection.size > 0) { e.preventDefault(); clearSelection(); }
        else if (useUI.getState().clipboard) {
          e.preventDefault();
          useUI.getState().setClipboard(null);
        }
      }
      // Clipboard: copy / cut / paste (paste takes over old Ctrl+V view toggle)
      else if (mod && e.key.toLowerCase() === 'c' && !e.shiftKey && selection.size > 0) {
        e.preventDefault();
        onCopy?.();
      }
      else if (mod && e.key.toLowerCase() === 'x' && selection.size > 0 && canWrite) {
        e.preventDefault();
        onCut?.();
      }
      else if (mod && e.key.toLowerCase() === 'v' && !e.shiftKey) {
        e.preventDefault();
        onPaste?.();
      }
      // Toggle view mode (moved to Ctrl/Cmd+Shift+V to free Ctrl+V for paste)
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        setViewMode(viewMode === 'grid' ? 'list' : 'grid');
      }
      // F5 is intentionally left to the browser: hijacking it defeats the
      // cached/service-worker reload path and surprises users. Data refresh
      // happens via React Query invalidation instead.
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    canWrite, view, setView, selection, items,
    bulkDelete, setMenu, fileInputRef, isModalOpen,
    selectMode, setSelectMode, setSelection, clearSelection,
    viewMode, setViewMode, setCommandPaletteOpen, setShortcutsModalOpen
  ]);
}
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
}: {
  canWrite: boolean;
  view: string;
  setView: (v: any) => void;
  selection: Set<string>;
  items: FileItem[];
  bulkDelete: () => void;
  setMenu: (menu: { kind: string; item?: FileItem } | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  isModalOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  setShortcutsModalOpen?: (open: boolean) => void;
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
      // Keyboard shortcuts modal
      else if (e.key === '?' && setShortcutsModalOpen) {
        e.preventDefault();
        setShortcutsModalOpen(true);
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
      // Select all
      else if (mod && e.key.toLowerCase() === 'a' && view === 'files' && items.length) {
        e.preventDefault();
        if (!selectMode) setSelectMode(true);
        setSelection(items.map((i) => i.path));
      }
      // Escape to clear selection
      else if (e.key === 'Escape' && selection.size > 0) {
        e.preventDefault();
        clearSelection();
      }
      // Toggle view mode
      else if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        setViewMode(viewMode === 'grid' ? 'list' : 'grid');
      }
      // Refresh
      else if (e.key === 'F5') {
        e.preventDefault();
        window.location.reload();
      }
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
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
}) {
  const setSelectMode = useUI((s) => s.setSelectMode);
  const setSelection = useUI((s) => s.setSelection);
  const selectMode = useUI((s) => s.selectMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (typing) return;
      if (isModalOpen) return;

      if (e.key === '/') { 
        e.preventDefault(); 
        setView('search'); 
      } else if (e.key.toLowerCase() === 'n' && canWrite && view === 'files') { 
        e.preventDefault(); 
        setMenu({ kind: 'newFolder' }); 
      } else if (e.key.toLowerCase() === 'u' && canWrite && view === 'files') { 
        e.preventDefault(); 
        fileInputRef.current?.click(); 
      } else if (e.key === 'Delete' && selection.size > 0 && canWrite) { 
        e.preventDefault(); 
        bulkDelete(); 
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && view === 'files' && items.length) {
        e.preventDefault();
        if (!selectMode) setSelectMode(true);
        setSelection(items.map((i) => i.path));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    canWrite, view, setView, selection, items, 
    bulkDelete, setMenu, fileInputRef, isModalOpen, 
    selectMode, setSelectMode, setSelection
  ]);
}

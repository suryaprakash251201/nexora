import { useState, useRef, useCallback } from 'react';

export function useDragAndDrop({
  rootId,
  canWrite,
  uploadFiles,
}: {
  rootId: string | null;
  canWrite: boolean;
  uploadFiles: (files: FileList | null) => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [dropPicker, setDropPicker] = useState(false);
  const pendingDrop = useRef<FileList | null>(null);
  const dragDepth = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) { 
      dragDepth.current = 0; 
      setDragActive(false); 
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (!files || !files.length) return;
    
    if (rootId && canWrite) {
      uploadFiles(files);
    } else {
      pendingDrop.current = files;
      setDropPicker(true);
    }
  }, [rootId, canWrite, uploadFiles]);

  return {
    dragProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
    dragActive,
    dropPicker,
    setDropPicker,
    pendingDrop,
  };
}

import { useCallback } from 'react';
import { startUpload, startDownload } from '../../lib/transfer';

export function useTransfers(rootId: string | null, path: string, refresh: () => void) {
  const uploadFiles = useCallback(async (fileList: FileList | null, destRootId?: string, destPath?: string) => {
    const rid = destRootId ?? rootId;
    const p = destPath ?? path;
    if (!fileList || !fileList.length || !rid) return;
    startUpload(rid, p, fileList, refresh);
  }, [rootId, path, refresh]);

  const downloadItem = useCallback((item: { is_dir: boolean; root_id: string; path: string; name: string }) => {
    if (!item.is_dir) startDownload(item.root_id, item.path, item.name);
  }, []);

  return { uploadFiles, downloadItem };
}

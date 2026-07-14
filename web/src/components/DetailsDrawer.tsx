import { useQuery } from "@tanstack/react-query";
import { X, Download, Eye, Pencil, Trash2, Scissors, Copy, Info, Star, Share2 } from "lucide-react";
import { get } from "../api/client";
import { formatBytes, formatDate } from "../lib/format";
import { useUI } from "../store";

export default function DetailsDrawer({
  rootName,
  rootId,
  path,
  canWrite,
  isFavorite,
  onClose,
  onDownload,
  onPreview,
  onRename,
  onDelete,
  onMove,
  onCopy,
  onShare,
  onFavorite,
  onEdit,
}: {
  rootName: string;
  rootId: string;
  path: string;
  canWrite: boolean;
  isFavorite: boolean;
  onClose: () => void;
  onDownload: () => void;
  onPreview: () => void;
  onRename: () => void;
  onDelete: () => void;
  onMove: () => void;
  onCopy: () => void;
  onShare: () => void;
  onFavorite: () => void;
  onEdit: () => void;
}) {
  const pushToast = useUI((s) => s.pushToast);
  const { data, isLoading } = useQuery({
    queryKey: ["stat", rootId, path],
    queryFn: () => get<any>("/files/stat", { root: rootId, path }),
    enabled: !!path,
  });

  return (
    <aside className="w-80 shrink-0 border-l glass h-full flex flex-col">
      <div className="h-14 flex items-center justify-between px-4 border-b">
        <span className="font-semibold">Details</span>
        <button onClick={onClose} className="p-1 rounded glass-hover"><X className="h-4 w-4" /></button>
      </div>
      {!path && (
        <div className="p-4 text-sm text-content-muted">Select a file or folder to see details.</div>
      )}
      {path && isLoading && <div className="p-4 text-sm text-content-muted">Loading…</div>}
      {path && data && (
        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <p className="text-xs uppercase text-content-muted">Name</p>
            <p className="font-medium break-all">{data.name}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs uppercase text-content-muted">Type</p>
              <p className="capitalize">{data.is_dir ? "Folder" : data.extension || "file"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-content-muted">Size</p>
              <p>{data.is_dir ? "—" : formatBytes(data.size)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs uppercase text-content-muted">Modified</p>
              <p>{formatDate(data.modified)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs uppercase text-content-muted">Location</p>
              <p className="break-all">{rootName} / {data.path}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs uppercase text-content-muted">MIME</p>
              <p className="break-all">{data.mime}</p>
            </div>
          </div>

           <div className="flex flex-col gap-1 pt-2 border-t">
            <button onClick={onDownload} className="flex items-center gap-2 px-3 py-2 rounded-lg glass-hover text-sm">
              <Download className="h-4 w-4" /> Download
            </button>
            {!data.is_dir && (
              <button onClick={onPreview} className="flex items-center gap-2 px-3 py-2 rounded-lg glass-hover text-sm">
                <Eye className="h-4 w-4" /> Preview
              </button>
            )}
            <button onClick={onShare} className="flex items-center gap-2 px-3 py-2 rounded-lg glass-hover text-sm">
              <Share2 className="h-4 w-4" /> Share
            </button>
            <button onClick={onFavorite} className="flex items-center gap-2 px-3 py-2 rounded-lg glass-hover text-sm">
              <Star className={`h-4 w-4 ${isFavorite ? "text-amber-400 fill-amber-400" : ""}`} /> {isFavorite ? "Remove favorite" : "Add to favorites"}
            </button>
            {!data.is_dir && canWrite && (
              <button onClick={onEdit} className="flex items-center gap-2 px-3 py-2 rounded-lg glass-hover text-sm">
                <Pencil className="h-4 w-4" /> Edit
              </button>
            )}
            {canWrite && (
              <>
                <button onClick={onRename} className="flex items-center gap-2 px-3 py-2 rounded-lg glass-hover text-sm">
                  <Pencil className="h-4 w-4" /> Rename
                </button>
                <button onClick={onMove} className="flex items-center gap-2 px-3 py-2 rounded-lg glass-hover text-sm">
                  <Scissors className="h-4 w-4" /> Move
                </button>
                <button onClick={onCopy} className="flex items-center gap-2 px-3 py-2 rounded-lg glass-hover text-sm">
                  <Copy className="h-4 w-4" /> Copy
                </button>
                <button onClick={onDelete} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-500/10 text-red-500 text-sm">
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </>
            )}
          </div>

          <div className="text-xs text-content-muted flex items-start gap-1 pt-2 border-t">
            <Info className="h-3 w-3 mt-0.5" /> Checksums and media metadata are computed on request.
          </div>
        </div>
      )}
    </aside>
  );
}

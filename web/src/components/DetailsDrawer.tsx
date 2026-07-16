import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Download, Eye, Pencil, Trash2, Scissors, Copy, Info, Star, Share2, Activity, FileText, Share } from "lucide-react";
import { get } from "../api/client";
import { formatBytes, formatDate } from "../lib/format";
import { useUI } from "../store";
import { FileThumb, FolderTile } from "./FileThumb";
import { Button } from "./ui/Button";

type Tab = "details" | "activity" | "shares";

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
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const pushToast = useUI((s) => s.pushToast);
  
  const { data, isLoading } = useQuery({
    queryKey: ["stat", rootId, path],
    queryFn: () => get<any>("/files/stat", { root: rootId, path }),
    enabled: !!path,
  });

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 w-[340px] glass-strong border-l border-glass-border-soft flex flex-col shadow-2xl animate-drawer-in lg:relative lg:z-auto">
        
        <div className="h-[72px] flex items-center justify-between px-5 border-b border-border/50 shrink-0">
          <span className="font-bold text-lg tracking-tight">Details</span>
          <button onClick={onClose} className="p-2 rounded-xl glass-hover text-content-muted hover:text-content transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!path ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center opacity-60">
            <Info className="h-12 w-12 mb-4 text-accent" />
            <p className="text-sm font-medium">Select a file or folder to see details.</p>
          </div>
        ) : isLoading ? (
          <div className="p-6 space-y-6 flex-1">
            <div className="flex flex-col items-center gap-4">
              <div className="skeleton w-24 h-24 rounded-2xl" />
              <div className="skeleton h-6 w-3/4 rounded-lg" />
            </div>
            <div className="space-y-4">
              <div className="skeleton h-4 w-1/2 rounded" />
              <div className="skeleton h-4 w-full rounded" />
              <div className="skeleton h-4 w-2/3 rounded" />
            </div>
          </div>
        ) : data ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Header / Preview */}
            <div className="p-6 flex flex-col items-center text-center bg-gradient-to-b from-transparent to-surface/30">
              <div className="w-24 h-24 mb-4 shadow-lg rounded-2xl">
                {data.is_dir ? <FolderTile large /> : <FileThumb it={data} large fill />}
              </div>
              <h3 className="font-bold text-lg leading-tight break-all mb-1">{data.name}</h3>
              <p className="text-xs font-medium text-content-muted uppercase tracking-wider">
                {data.is_dir ? "Folder" : data.extension || "file"} • {data.is_dir ? "—" : formatBytes(data.size)}
              </p>
            </div>

            {/* Tabs */}
            <div className="flex p-2 gap-1 bg-surface-muted/50 border-y border-border/50">
              <button 
                onClick={() => setActiveTab("details")}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all ${activeTab === "details" ? "bg-surface shadow-sm text-content" : "text-content-muted hover:text-content hover:bg-surface/50"}`}
              >
                <FileText className="h-3.5 w-3.5" /> Details
              </button>
              <button 
                onClick={() => setActiveTab("activity")}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all ${activeTab === "activity" ? "bg-surface shadow-sm text-content" : "text-content-muted hover:text-content hover:bg-surface/50"}`}
              >
                <Activity className="h-3.5 w-3.5" /> Activity
              </button>
              <button 
                onClick={() => setActiveTab("shares")}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all ${activeTab === "shares" ? "bg-surface shadow-sm text-content" : "text-content-muted hover:text-content hover:bg-surface/50"}`}
              >
                <Share className="h-3.5 w-3.5" /> Shares
              </button>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
              
              {activeTab === "details" && (
                <>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 text-sm">
                      <div className="p-3 rounded-xl bg-surface/40 border border-border/40">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-content-muted mb-1">Modified</p>
                        <p className="font-medium">{formatDate(data.modified)}</p>
                      </div>
                      
                      <div className="p-3 rounded-xl bg-surface/40 border border-border/40">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-content-muted mb-1">Location</p>
                        <p className="font-medium break-all text-xs font-mono">{rootName} / {data.path}</p>
                      </div>
                      
                      <div className="p-3 rounded-xl bg-surface/40 border border-border/40">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-content-muted mb-1">MIME Type</p>
                        <p className="font-medium break-all text-xs font-mono">{data.mime}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-xs text-content-muted flex items-start gap-2 p-3 bg-accent/5 text-accent rounded-xl">
                    <Info className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>Checksums and media metadata are computed on request.</span>
                  </div>
                </>
              )}

              {activeTab === "activity" && (
                <div className="flex flex-col items-center justify-center h-full text-center opacity-60">
                  <Activity className="h-10 w-10 mb-3 text-content-muted" />
                  <p className="text-sm font-medium">Activity timeline coming soon</p>
                </div>
              )}
              
              {activeTab === "shares" && (
                <div className="flex flex-col items-center justify-center h-full text-center opacity-60">
                  <Share2 className="h-10 w-10 mb-3 text-content-muted" />
                  <p className="text-sm font-medium">Sharing details coming soon</p>
                </div>
              )}
            </div>

            {/* Actions Footer */}
            <div className="p-4 border-t border-border/50 bg-surface/30 space-y-2 shrink-0">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="primary" size="sm" onClick={onDownload} icon={<Download className="h-4 w-4" />}>
                  Download
                </Button>
                
                {!data.is_dir && (
                  <Button size="sm" onClick={onPreview} icon={<Eye className="h-4 w-4" />}>
                    Preview
                  </Button>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={onShare} icon={<Share2 className="h-4 w-4" />}>
                  Share
                </Button>
                
                <Button size="sm" onClick={onFavorite} className={isFavorite ? "text-amber-500 hover:text-amber-600" : ""} icon={<Star className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />}>
                  {isFavorite ? "Unstar" : "Star"}
                </Button>
              </div>

              {canWrite && (
                <div className="pt-2 mt-2 border-t border-border/50 grid grid-cols-2 gap-2">
                  {!data.is_dir && (
                    <Button size="sm" onClick={onEdit} icon={<Pencil className="h-4 w-4" />}>
                      Edit
                    </Button>
                  )}
                  <Button size="sm" onClick={onRename} icon={<Pencil className="h-4 w-4" />}>
                    Rename
                  </Button>
                  <Button size="sm" onClick={onMove} icon={<Scissors className="h-4 w-4" />}>
                    Move
                  </Button>
                  <Button size="sm" onClick={onCopy} icon={<Copy className="h-4 w-4" />}>
                    Copy
                  </Button>
                  <Button variant="danger" size="sm" onClick={onDelete} className="col-span-2" icon={<Trash2 className="h-4 w-4" />}>
                    Delete
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}

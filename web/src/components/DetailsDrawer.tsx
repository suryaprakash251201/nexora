import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Download, Eye, Pencil, Trash2, Scissors, Copy, Info, Star, Share2, Activity, FileText, Share, Clock, Link } from "lucide-react";
import { get, post, del } from "../api/client";
import { formatBytes, formatDate } from "../lib/format";
import { useUI } from "../store";
import { FileThumb, FolderTile } from "./FileThumb";
import { Button } from "./ui/Button";

type Tab = "details" | "activity" | "shares";

interface DetailsDrawerProps {
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
}

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
}: DetailsDrawerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [renaming, setRenaming] = useState(false);
  const [_renameValue, setRenameValue] = useState("");
  const pushToast = useUI((s) => s.pushToast);
  const qc = useQueryClient();
  
  const { data: stat, isLoading } = useQuery({
    queryKey: ["stat", rootId, path],
    queryFn: () => get<any>("/files/stat", { root: rootId, path }),
    enabled: !!path,
  });


  const handleDelete = async () => {
    if (!window.confirm(`Delete "${stat?.name}"? This moves it to trash.`)) return;
    try {
      await del("/files", { root: rootId, path: stat!.path });
      pushToast("success", "Moved to trash");
      onClose();
      qc?.invalidateQueries({ queryKey: ["files", rootId] });
      qc?.invalidateQueries({ queryKey: ["trash"] });
    } catch (e: any) {
      pushToast("error", e.message);
    }
  };

  const handleFavorite = () => onFavorite();

  const handleMove = () => onMove();
  const handleCopy = () => onCopy();

  const handleShare = () => onShare();

  useEffect(() => {
    if (stat && !renaming) setRenameValue(stat.name);
  }, [stat, renaming]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 w-full sm:w-[380px] glass-strong border-l border-glass-border-soft flex flex-col shadow-2xl animate-drawer-in lg:relative lg:z-auto">
        
        <div className="h-[64px] flex items-center justify-between px-4 sm:px-6 border-b border-border/50 shrink-0">
          <span className="font-semibold text-base tracking-tight">Details</span>
          <button onClick={onClose} className="p-2 rounded-xl glass-hover text-content-muted hover:text-content transition-colors" aria-label="Close details">
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
        ) : stat ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Header / Preview */}
            <div className="p-6 flex flex-col items-center text-center bg-gradient-to-b from-transparent to-surface/30">
              <div className="relative w-24 h-24 mb-4 shadow-lg rounded-2xl overflow-hidden">
                {stat.is_dir ? (
                  <FolderTile large />
                ) : (
                  <FileThumb it={stat} large fill />
                )}
                {stat.is_favorite && (
                  <div className="absolute top-1 right-1">
                    <Star className="h-5 w-5 fill-amber-400 text-amber-400 drop-shadow" />
                  </div>
                )}
              </div>
              <div className="w-full">
                <h3 className="font-bold text-lg leading-tight break-all mb-1 truncate" title={stat.name}>
                  {stat.name}
                </h3>
                <p className="text-xs font-medium text-content-muted uppercase tracking-wider">
                  {stat.is_dir ? "Folder" : stat.extension || "File"} • {stat.is_dir ? "—" : formatBytes(stat.size)}
                </p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex p-2 bg-surface-muted/50 border-y border-border/50">
              <button 
                onClick={() => setActiveTab("details")}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all ${
                  activeTab === "details" ? "bg-surface shadow-sm text-content" : "text-content-muted hover:text-content hover:bg-surface/50"
                }`}
              >
                <FileText className="h-3.5 w-3.5" /> Details
              </button>
              <button 
                onClick={() => setActiveTab("activity")}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all ${
                  activeTab === "activity" ? "bg-surface shadow-sm text-content" : "text-content-muted hover:text-content hover:bg-surface/50"
                }`}
              >
                <Activity className="h-3.5 w-3.5" /> Activity
              </button>
              <button 
                onClick={() => setActiveTab("shares")}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all ${
                  activeTab === "shares" ? "bg-surface shadow-sm text-content" : "text-content-muted hover:text-content hover:bg-surface/50"
                }`}
              >
                <Share className="h-3.5 w-3.5" /> Shares
              </button>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
              
              {activeTab === "details" && (
                <>
                  {/* Info Grid */}
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="p-3 rounded-xl bg-surface/40 border border-border/40">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-content-muted mb-1">Modified</p>
                        <p className="font-medium">{formatDate(stat.modified)}</p>
                      </div>
                      
                      <div className="p-3 rounded-xl bg-surface/40 border border-border/40">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-content-muted mb-1">Created</p>
                        <p className="font-medium">{stat.created ? formatDate(stat.created) : "—"}</p>
                      </div>
                      
                      <div className="p-3 rounded-xl bg-surface/40 border border-border/40">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-content-muted mb-1">Size</p>
                        <p className="font-medium">{stat.is_dir ? "—" : formatBytes(stat.size)}</p>
                      </div>
                      
                      <div className="p-3 rounded-xl bg-surface/40 border border-border/40">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-content-muted mb-1">Type</p>
                        <p className="font-medium text-xs break-all font-mono">{stat.mime}</p>
                      </div>
                    </div>

                    {/* Location */}
                    <div className="p-3 rounded-xl bg-surface/40 border border-border/40">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-content-muted mb-1">Location</p>
                      <p className="font-medium break-all text-xs font-mono text-content">{rootName} / {stat.path}</p>
                    </div>

                    {/* Additional metadata for files */}
                    {!stat.is_dir && stat.checksum && (
                      <div className="p-3 rounded-xl bg-surface/40 border border-border/40">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-content-muted mb-1">SHA-256</p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-xs font-mono break-all bg-surface/50 px-2 py-1 rounded">{stat.checksum}</code>
                          <button 
                            onClick={() => { navigator.clipboard.writeText(stat.checksum); pushToast("success", "Checksum copied"); }}
                            className="p-1.5 rounded-lg glass-hover text-content-muted hover:text-content transition-colors"
                            title="Copy checksum"
                          >
                            <Link className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Media metadata placeholder */}
                    {!stat.is_dir && stat.media && (
                      <div className="p-3 rounded-xl bg-accent/5 text-accent border border-accent/10">
                        <p className="text-xs font-medium mb-1 flex items-center gap-1">
                          <Info className="h-3.5 w-3.5" /> Media metadata available
                        </p>
                        <p className="text-xs font-mono opacity-80">Duration: {stat.media.duration}s • {stat.media.width}×{stat.media.height}</p>
                      </div>
                    )}
                  </div>

                  <div className="text-xs text-content-muted flex items-start gap-2 p-3 bg-accent/5 text-accent rounded-xl">
                    <Info className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>Additional metadata (EXIF, ID3 tags) computed on demand.</span>
                  </div>
                </>
              )}

              {activeTab === "activity" && (
                <ActivityFeed rootId={rootId} path={stat.path} />
              )}

              {activeTab === "shares" && (
                <SharesList rootId={rootId} path={stat.path} />
              )}
            </div>

            {/* Actions Footer */}
            <div className="p-4 border-t border-border/50 bg-surface/30 space-y-3 shrink-0">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="primary" size="sm" onClick={onDownload} icon={<Download className="h-4 w-4" />}>
                  Download
                </Button>
                
                {!stat.is_dir && (
                  <Button size="sm" onClick={onPreview} icon={<Eye className="h-4 w-4" />}>
                    Preview
                  </Button>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={handleShare} icon={<Share2 className="h-4 w-4" />}>
                  Share
                </Button>
                
                <Button 
                  size="sm" 
                  onClick={handleFavorite} 
                  className={isFavorite ? "text-amber-500 hover:text-amber-600" : ""} 
                  icon={<Star className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />}
                >
                  {isFavorite ? "Unstar" : "Star"}
                </Button>
              </div>

              {canWrite && (
                <div className="pt-2 mt-2 border-t border-border/50 space-y-2">
                  {!stat.is_dir && (
                    <Button size="sm" onClick={onEdit} icon={<Pencil className="h-4 w-4" />}>
                      Edit
                    </Button>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" onClick={() => { setRenameValue(stat.name); setRenaming(true); }} icon={<Pencil className="h-4 w-4" />}>
                      Rename
                    </Button>
                    <Button size="sm" onClick={handleMove} icon={<Scissors className="h-4 w-4" />}>
                      Move
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" onClick={handleCopy} icon={<Copy className="h-4 w-4" />}>
                      Copy
                    </Button>
                    <Button variant="danger" size="sm" onClick={handleDelete} className="col-span-2" icon={<Trash2 className="h-4 w-4" />}>
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}

function ActivityFeed({ rootId, path }: { rootId: string; path: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["activity", rootId, path],
    queryFn: () => get<{ items: any[] }>("/activity", { root: rootId, path }),
    enabled: !!path,
  });

  const activity = (data?.items || []).map((a) => ({
    id: a.id,
    action: a.action,
    user: a.user_name || "Unknown",
    time: formatDate(a.created_at),
    detail: a.detail,
  }));

  if (isLoading) return <div className="p-4 text-center text-content-muted">Loading activity…</div>;
  if (!activity.length) return <div className="flex flex-col items-center justify-center h-full text-center opacity-60"><Activity className="h-10 w-10 mb-3 text-content-muted" /><p className="text-sm font-medium">No activity yet</p></div>;

  return (
    <div className="space-y-4">
      {activity.map((a) => (
        <div key={a.id} className="flex gap-3 p-3 rounded-xl glass-subtle">
          <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
            <Activity className="h-4 w-4 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{a.action}</p>
            <p className="text-xs text-content-muted">{a.user} • {a.time}</p>
            {a.detail && <p className="text-xs text-content-muted/80 mt-0.5 truncate">{a.detail}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function SharesList({ rootId, path }: { rootId: string; path: string }) {
  const [creating, setCreating] = useState(false);
  const pushToast = useUI((s) => s.pushToast);
  const qc = useQueryClient();
  const shareKey = ["shares", rootId, path];

  const { data: shares, isLoading } = useQuery({
    queryKey: shareKey,
    queryFn: () => get<{ items: any[] }>("/shares", { root: rootId, path }),
    enabled: !!path,
  });

  const createShare = async () => {
    setCreating(true);
    try {
      await post("/shares", { root: rootId, path, expires_at: null, max_downloads: null });
      pushToast("success", "Share link created");
      qc.invalidateQueries({ queryKey: shareKey });
    } catch (e: any) {
      pushToast("error", e.message);
    }
    setCreating(false);
  };

  const deleteShare = async (id: string) => {
    try {
      await del("/shares", { id });
      pushToast("success", "Share removed");
      qc.invalidateQueries({ queryKey: shareKey });
    } catch (e: any) {
      pushToast("error", e.message);
    }
  };

  const items = shares?.items || [];
  if (isLoading) return <div className="p-4 text-center text-content-muted">Loading shares…</div>;

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-xl bg-accent/5 border border-accent/10 text-accent text-xs font-medium flex items-center gap-2">
        <Share2 className="h-4 w-4" />
        <span>Create a link to share this item</span>
      </div>

      {items.length === 0 ? (
        <button 
          onClick={createShare}
          disabled={creating}
          className="w-full p-4 rounded-xl glass-hover border border-dashed border-border/50 flex items-center justify-center gap-2 text-content-muted hover:text-content hover:border-accent/50 transition-colors"
        >
          <Share2 className="h-5 w-5" />
          <span className="font-medium">{creating ? "Creating…" : "Create share link"}</span>
        </button>
      ) : (
        <div className="space-y-3">
          {items.map((s) => (
            <div key={s.id} className="p-3 rounded-xl glass-subtle border border-border/40">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Link className="h-4 w-4 text-accent" />
                  <span className="text-xs font-mono text-content-muted">{`/s/${s.token}`}</span>
                </div>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(`/s/${s.token}`);
                    pushToast("success", "Link copied");
                  }}
                  className="p-1.5 rounded-lg glass-hover text-content-muted hover:text-content transition-colors"
                  title="Copy link"
                >
                  <Link className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-4 text-[10px] font-medium text-content-muted">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {s.expires_at ? formatDate(s.expires_at) : "No expiry"}
                </span>
                <span className="flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  {s.downloads} / {s.max_downloads ?? "∞"} downloads
                </span>
              </div>
              <button 
                onClick={() => deleteShare(s.id)}
                className="w-full mt-2 p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 text-xs font-medium transition-colors"
              >
                Remove share
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
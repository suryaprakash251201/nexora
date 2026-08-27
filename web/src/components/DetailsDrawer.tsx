import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import {
  X, Download, Eye, Pencil, Trash2, Scissors, Copy, Info, Star, Share2, Activity, FileText, Share, Clock, Link, Folder, FolderOpen, MessageSquare, History,
  HardDrive, Calendar, Tag as TagIcon, ShieldCheck, Hash, Ruler, FileType, ChevronRight, Image as ImageIcon, Video as VideoIcon, Music as MusicIcon, File as FileGeneric, MoreHorizontal, Edit3, ExternalLink, ArrowUpRight, Lock, Globe, CheckCircle2, AlertCircle, Layers
} from "lucide-react";
import { filesApi, sharesApi, activityApi } from "../api/endpoints";
import { formatBytes, formatDate, formatRelative } from "../lib/format";
import { useUI } from "../store";
import { FileThumb } from "./FileThumb";
import { Button } from "./ui/Button";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { QueryError } from "./ui/QueryError";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "./ui/sheet";
import { revealInFileManager } from "../lib/desktop";
import { FileComments } from "./FileComments";
import { cn } from "@/lib/utils";

type Tab = "details" | "activity" | "shares" | "comments" | "versions";

interface DetailsDrawerProps {
  rootName: string;
  rootId: string;
  path: string;
  canWrite: boolean;
  userId?: string;
  isAdmin?: boolean;
  revealPath?: string | null;
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
  onShowVersions?: () => void;
}

// ---------- helpers ----------
function kindLabel(mime: string, ext: string, isDir: boolean): string {
  if (isDir) return "Folder";
  const e = (ext || "").toLowerCase();
  if (mime?.startsWith("image/")) return e ? `${e.toUpperCase()} Image` : "Image";
  if (mime?.startsWith("video/")) return e ? `${e.toUpperCase()} Video` : "Video";
  if (mime?.startsWith("audio/")) return e ? `${e.toUpperCase()} Audio` : "Audio";
  if (e === "pdf") return "PDF Document";
  if (["zip", "tar", "gz", "7z", "rar", "iso", "bz2", "xz"].includes(e)) return "Archive";
  if (["doc", "docx", "odt", "pages", "rtf"].includes(e)) return "Word Document";
  if (["xls", "xlsx", "csv", "ods", "numbers"].includes(e)) return "Spreadsheet";
  if (["ppt", "pptx", "key", "odp"].includes(e)) return "Presentation";
  if (["md", "markdown", "txt", "log"].includes(e)) return "Text Document";
  if (["js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "go", "rs", "java", "c", "cpp", "h", "rb", "php", "swift", "kt", "html", "css", "scss", "json", "xml", "yaml", "yml", "toml", "ini", "sh", "bash"].includes(e)) return `${e.toUpperCase()} Code`;
  if (e) return `${e.toUpperCase()} File`;
  return mime?.split("/")[1] ? mime.split("/")[1].toUpperCase() + " File" : "File";
}

function useCopyToast() {
  const pushToast = useUI((s) => s.pushToast);
  return async (text: string, msg = "Copied to clipboard") => {
    try { await navigator.clipboard.writeText(text); pushToast("success", msg); } catch { pushToast("error", "Copy failed"); }
  };
}

export default function DetailsDrawer({
  rootName, rootId, path, canWrite, userId, isAdmin, isFavorite, revealPath, onClose, onDownload, onPreview, onRename, onDelete, onMove, onCopy, onShare, onFavorite, onEdit, onShowVersions,
}: DetailsDrawerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [checksum, setChecksum] = useState<string | null>(null);
  const [checksumLoading, setChecksumLoading] = useState(false);
  const pushToast = useUI((s) => s.pushToast);
  const qc = useQueryClient();
  const doCopy = useCopyToast();

  const { data: stat, isLoading, isError, refetch } = useQuery({
    queryKey: ["stat", rootId, path],
    queryFn: () => filesApi.stat(rootId, path),
    enabled: !!path,
  });

  // Rich metadata (dimensions, editable)
  const { data: meta } = useQuery({
    queryKey: ["metadata", rootId, path],
    queryFn: () => filesApi.metadata(rootId, path),
    enabled: !!stat && !stat.is_dir,
    staleTime: 60_000,
  });

  // Folder stats (counts + total size)
  const { data: folderInfo } = useQuery({
    queryKey: ["folder-stats", rootId, path],
    queryFn: async () => {
      const res = await filesApi.list({ root: rootId, path, limit: 1000 });
      const items = res.items || [];
      const totalSize = items.reduce((a: number, c: any) => a + (c.size || 0), 0);
      const files = items.filter((i: any) => !i.is_dir).length;
      const folders = items.filter((i: any) => i.is_dir).length;
      return { count: items.length, totalSize, files, folders };
    },
    enabled: !!stat?.is_dir && !!path,
    staleTime: 30_000,
  });

  // Tags for this exact path (via parent listing — cheapest way without new endpoint)
  const { data: fileTags } = useQuery({
    queryKey: ["file-tags-single", rootId, path],
    queryFn: async () => {
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const res = await filesApi.list({ root: rootId, path: parent, limit: 5000 });
      const match = (res.items || []).find((i: any) => i.path === path);
      return (match?.tags || []) as any[];
    },
    enabled: !!path && !!rootId,
    staleTime: 15_000,
  });

  // Tab badge counts — always enabled so the pill shows accurate numbers without opening the tab first
  const { data: sharesData } = useQuery({
    queryKey: ["shares", rootId, path],
    queryFn: () => sharesApi.list({ root: rootId, path }) as any,
    enabled: !!path,
  });
  const { data: commentsData } = useQuery({
    queryKey: ["comments", rootId, path],
    queryFn: () => filesApi.comments.list(rootId, path),
    enabled: !!path,
  });
  const { data: activityData } = useQuery({
    queryKey: ["activity", rootId, path],
    queryFn: () => activityApi.list(rootId, path),
    enabled: !!path,
  });

  const sharesCount = sharesData?.items?.length ?? 0;
  const commentsCount = commentsData?.items?.length ?? 0;
  const activityCount = activityData?.items?.length ?? 0;

  const handleDelete = async () => {
    if (!stat) return;
    setDeleting(true);
    try {
      await filesApi.delete(rootId, stat.path);
      pushToast("success", "Moved to trash");
      onClose();
      qc?.invalidateQueries({ queryKey: ["files", rootId] });
      qc?.invalidateQueries({ queryKey: ["trash"] });
    } catch (e: any) {
      pushToast("error", e.message);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const fetchChecksum = async () => {
    if (!stat || stat.is_dir) return;
    setChecksumLoading(true);
    try {
      const res = await filesApi.checksum(rootId, path);
      setChecksum((res as any).checksum || (res as any).hash || null);
    } catch (e: any) {
      pushToast("error", e.message || "Could not compute checksum");
    } finally { setChecksumLoading(false); }
  };

  const isDir = !!stat?.is_dir;
  const kind = useMemo(() => stat ? kindLabel(stat.mime || meta?.mime || "", stat.extension || meta?.extension || "", isDir) : "", [stat, meta, isDir]);
  const sizeLabel = useMemo(() => stat ? (isDir ? (folderInfo ? formatBytes(folderInfo.totalSize) : "—") : formatBytes(stat.size)) : "", [stat, isDir, folderInfo]);
  const exactSize = !isDir && stat ? `${stat.size.toLocaleString()} bytes` : "";
  const modifiedRel = stat?.modified ? formatRelative(stat.modified) : "";
  const modifiedAbs = stat?.modified ? formatDate(stat.modified) : "—";

  return (
    <Sheet open={!!path} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent showCloseButton={false} className="w-full sm:w-[420px] p-0 flex flex-col overflow-hidden bg-popover border-l border-border/40">
        {/* Header */}
        <SheetHeader className="h-[54px] flex-row items-center justify-between px-4 sm:px-5 border-b border-border/40 shrink-0 space-y-0 bg-surface/40 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-accent/10 border border-accent/10 grid place-items-center">
              <Layers className="h-4 w-4 text-accent" />
            </div>
            <div className="flex flex-col">
              <SheetTitle className="font-semibold text-[13px] tracking-tight leading-none">Properties</SheetTitle>
              <span className="text-[11px] text-content-muted font-medium">{isDir ? "Folder details" : "File details"}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {revealPath && (
              <button onClick={() => revealInFileManager(revealPath)} title="Reveal in file manager" className="hidden sm:grid h-8 w-8 place-items-center rounded-xl glass-hover border border-border/40 text-content-muted hover:text-content transition-colors">
                <FolderOpen className="h-4 w-4" />
              </button>
            )}
            <SheetClose className="h-8 w-8 grid place-items-center rounded-xl glass-hover border border-border/40 text-content-muted hover:text-content transition-colors">
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
        </SheetHeader>

        {!path ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="h-16 w-16 rounded-2xl bg-accent/8 border border-accent/10 grid place-items-center mb-4">
              <Info className="h-7 w-7 text-accent/60" />
            </div>
            <p className="text-sm font-semibold">No selection</p>
            <p className="text-xs text-content-muted mt-1 max-w-[240px]">Select a file or folder to view its properties, sharing and activity.</p>
          </div>
        ) : isLoading ? (
          <div className="flex-1 overflow-hidden">
            <div className="p-6 flex flex-col items-center gap-4 bg-gradient-to-b from-accent/[0.04] to-transparent border-b border-border/20">
              <div className="skeleton w-[88px] h-[88px] rounded-[20px]" />
              <div className="skeleton h-5 w-40 rounded-lg" />
              <div className="skeleton h-3 w-28 rounded" />
            </div>
            <div className="p-4 space-y-3">
              <div className="skeleton h-24 rounded-2xl" />
              <div className="skeleton h-28 rounded-2xl" />
              <div className="skeleton h-20 rounded-2xl" />
            </div>
          </div>
        ) : isError ? (
          <div className="flex-1">
            <QueryError message="Could not load properties." onRetry={() => refetch()} />
          </div>
        ) : stat ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Hero / Preview */}
            <div className="relative px-6 pt-6 pb-5 bg-gradient-to-b from-accent/[0.07] via-accent/[0.025] to-transparent border-b border-border/30">
              {/* subtle grid */}
              <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`, backgroundSize: '16px 16px' }} />
              <div className="relative flex flex-col items-center text-center">
                <div className="relative">
                  <div className="w-[92px] h-[92px] rounded-[22px] bg-surface border border-border/50 shadow-[0_8px_24px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)] overflow-hidden flex items-center justify-center">
                    {stat.is_dir ? (
                      <img src="/folder.png" alt="folder" width={64} height={64} className="drop-shadow-sm" />
                    ) : (
                      <FileThumb it={{ ...stat, root_id: rootId } as any} large fill />
                    )}
                  </div>
                  {stat.is_favorite || isFavorite ? (
                    <div className="absolute -top-1.5 -right-1.5 h-7 w-7 rounded-full bg-amber-400 border-[3px] border-background shadow-lg grid place-items-center">
                      <Star className="h-3.5 w-3.5 fill-white text-white" />
                    </div>
                  ) : null}
                  {/* type badge */}
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-popover border border-border/50 shadow-md flex items-center gap-1">
                    {isDir ? <Folder className="h-3 w-3 text-blue-500" /> : stat.mime?.startsWith("image/") ? <ImageIcon className="h-3 w-3 text-emerald-500" /> : stat.mime?.startsWith("video/") ? <VideoIcon className="h-3 w-3 text-purple-500" /> : stat.mime?.startsWith("audio/") ? <MusicIcon className="h-3 w-3 text-pink-500" /> : <FileGeneric className="h-3 w-3 text-slate-500" />}
                    <span className="text-[10px] font-bold tracking-wider uppercase text-content-muted">{stat.extension?.toUpperCase() || (isDir ? "FOLDER" : "FILE")}</span>
                  </div>
                </div>

                <h3 className="mt-5 text-[15px] font-semibold leading-tight break-all line-clamp-2 max-w-[280px] tracking-tight" title={stat.name}>
                  {stat.name}
                </h3>
                <div className="mt-1.5 flex items-center justify-center gap-2 flex-wrap text-xs">
                  <span className="text-content-muted font-medium">{kind}</span>
                  <span className="h-1 w-1 rounded-full bg-border" />
                  <span className="font-medium">{isDir ? `${folderInfo?.count ?? "—"} items` : sizeLabel}</span>
                  {!isDir && meta?.width ? <><span className="h-1 w-1 rounded-full bg-border" /><span className="text-content-muted">{meta.width} × {meta.height}</span></> : null}
                  {!canWrite && <><span className="h-1 w-1 rounded-full bg-border" /><span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/15 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"><Lock className="h-3 w-3" /> Read only</span></>}
                  {canWrite && <><span className="h-1 w-1 rounded-full bg-border" /><span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/15 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"><Globe className="h-3 w-3" /> Read & write</span></>}
                </div>

                {/* Quick Actions */}
                <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
                  <QuickAction icon={<Download className="h-4 w-4" />} label="Download" onClick={onDownload} primary />
                  {!isDir && (
                    <QuickAction icon={<Eye className="h-4 w-4" />} label="Preview" onClick={onPreview} />
                  )}
                  {isDir && (
                    <QuickAction icon={<FolderOpen className="h-4 w-4" />} label="Open" onClick={onPreview} />
                  )}
                  <QuickAction icon={<Share2 className="h-4 w-4" />} label="Share" onClick={() => onShare()} />
                  <QuickAction icon={<Star className={cn("h-4 w-4", isFavorite && "fill-amber-400 text-amber-400")} />} label={isFavorite ? "Unstar" : "Star"} onClick={onFavorite} active={isFavorite} />
                  <div className="relative">
                    <button onClick={() => setShowMore(v => !v)} className={cn("h-8 w-8 rounded-full border bg-surface hover:bg-surface-elevated text-content-muted hover:text-content grid place-items-center transition-all shadow-sm", showMore ? "border-accent/30 bg-accent/10 text-accent" : "border-border/60")}>
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    <AnimatePresence>
                      {showMore && (
                        <motion.div initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }} transition={{ duration: 0.16 }} className="absolute right-0 top-10 w-56 rounded-2xl border border-border/50 bg-popover/95 backdrop-blur-xl shadow-xl overflow-hidden z-20">
                          <div className="p-1.5 space-y-0.5">
                            {!isDir && canWrite && <MenuAction icon={<Edit3 className="h-4 w-4" />} label="Edit" onClick={() => { setShowMore(false); onEdit(); }} />}
                            {canWrite && <MenuAction icon={<Pencil className="h-4 w-4" />} label="Rename" onClick={() => { setShowMore(false); onRename(); }} />}
                            {canWrite && <MenuAction icon={<Scissors className="h-4 w-4" />} label="Move" onClick={() => { setShowMore(false); onMove(); }} />}
                            <MenuAction icon={<Copy className="h-4 w-4" />} label="Copy" onClick={() => { setShowMore(false); onCopy(); }} />
                            {!isDir && onShowVersions && <MenuAction icon={<History className="h-4 w-4" />} label="Version history" onClick={() => { setShowMore(false); onShowVersions(); }} />}
                            {revealPath && <MenuAction icon={<ExternalLink className="h-4 w-4" />} label="Reveal in manager" onClick={() => { setShowMore(false); revealInFileManager(revealPath); }} />}
                            {canWrite && <div className="h-px bg-border/40 my-1" />}
                            {canWrite && <MenuAction icon={<Trash2 className="h-4 w-4" />} label="Move to trash" danger onClick={() => { setShowMore(false); setConfirmDelete(true); }} />}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs — pill segmented control */}
            <div className="sticky top-0 z-10 bg-popover/80 backdrop-blur-xl border-b border-border/30 px-3 py-2.5">
              <div className="flex p-1 bg-surface-muted/70 rounded-xl border border-border/30 gap-1">
                <TabButton active={activeTab === "details"} onClick={() => setActiveTab("details")} icon={<FileText className="h-3.5 w-3.5" />} label="Overview" />
                <TabButton active={activeTab === "activity"} onClick={() => setActiveTab("activity")} icon={<Activity className="h-3.5 w-3.5" />} label="Activity" count={activityCount} />
                <TabButton active={activeTab === "shares"} onClick={() => setActiveTab("shares")} icon={<Share className="h-3.5 w-3.5" />} label="Sharing" count={sharesCount} />
                <TabButton active={activeTab === "comments"} onClick={() => setActiveTab("comments")} icon={<MessageSquare className="h-3.5 w-3.5" />} label="Notes" count={commentsCount} />
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface-muted/20">
              <AnimatePresence mode="wait">
                {activeTab === "details" && (
                  <motion.div key="details" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="p-4 space-y-4">
                    {/* Details card */}
                    <SectionCard
                      title={isDir ? "Folder overview" : "Details"}
                      icon={isDir ? <Folder className="h-4 w-4" /> : <HardDrive className="h-4 w-4" />}
                      color="accent"
                    >
                      <div className="grid grid-cols-2 gap-2.5">
                        <StatTile icon={<FileType className="h-3.5 w-3.5 text-violet-500" />} label="Kind" value={kind} sub={stat.mime || "—"} mono={false} />
                        <StatTile icon={<HardDrive className="h-3.5 w-3.5 text-blue-500" />} label="Size" value={sizeLabel} sub={isDir ? `${folderInfo?.files ?? 0} files · ${folderInfo?.folders ?? 0} folders` : exactSize} />
                        <StatTile icon={<Calendar className="h-3.5 w-3.5 text-emerald-500" />} label="Modified" value={modifiedRel || "—"} sub={modifiedAbs} />
                        <StatTile icon={<Clock className="h-3.5 w-3.5 text-amber-500" />} label={isDir ? "Items" : "Type"} value={isDir ? `${folderInfo?.count ?? "—"} items` : (stat.extension ? `.${stat.extension.toLowerCase()}` : "—")} sub={isDir ? `${folderInfo?.totalSize ? formatBytes(folderInfo.totalSize) + " total" : ""}` : (stat.mime || "application/octet-stream")} mono />
                      </div>

                      {/* dimensions / extra meta for files */}
                      {!isDir && (meta?.width || stat?.width) && (
                        <div className="mt-3 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-accent/5 border border-accent/10">
                          <div className="h-8 w-8 rounded-lg bg-accent/10 grid place-items-center shrink-0">
                            <Ruler className="h-4 w-4 text-accent" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold">Dimensions</p>
                            <p className="text-xs text-content-muted font-mono">{meta?.width || (stat as any)?.width} × {meta?.height || (stat as any)?.height} px</p>
                          </div>
                          {meta?.editable !== undefined && (
                            <span className={cn("px-2 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase border", meta.editable ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-surface border-border/50 text-content-muted")}>
                              {meta.editable ? "Editable" : "Binary"}
                            </span>
                          )}
                        </div>
                      )}

                      {/* media hint */}
                      {!isDir && (stat as any)?.media && (
                        <div className="mt-3 px-3 py-2.5 rounded-xl bg-violet-500/5 border border-violet-500/10 flex items-center gap-2">
                          <Hash className="h-4 w-4 text-violet-500" />
                          <span className="text-xs font-medium">Duration: {(stat as any).media.duration}s • {(stat as any).media.width}×{(stat as any).media.height}</span>
                        </div>
                      )}
                    </SectionCard>

                    {/* Location card */}
                    <SectionCard title="Location" icon={<FolderOpen className="h-4 w-4" />} color="blue" action={
                      <button onClick={() => doCopy(`${rootName} / ${stat.path}`, "Path copied")} className="h-7 px-2.5 rounded-lg bg-surface border border-border/40 text-xs font-medium flex items-center gap-1 hover:border-accent/30 hover:text-accent transition-colors">
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    }>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="px-2 py-1 rounded-full bg-accent/10 text-accent border border-accent/15 font-semibold text-[11px] tracking-wide">{rootName}</span>
                          <ChevronRight className="h-3 w-3 text-content-muted/60" />
                          <span className="text-content-muted truncate flex-1 font-medium">/</span>
                          {canWrite ? <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-500/10 border border-emerald-500/15 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase"><CheckCircle2 className="h-3 w-3" /> Writable</span> : <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-500/10 border border-amber-500/15 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase"><Lock className="h-3 w-3" /> Read-only</span>}
                        </div>
                        <div className="group relative rounded-xl bg-surface border border-border/40 px-3 py-2.5 flex items-start gap-2.5">
                          <div className="h-7 w-7 rounded-lg bg-surface-muted border border-border/30 grid place-items-center shrink-0 mt-0.5">
                            <Link className="h-3.5 w-3.5 text-content-muted" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-content-muted mb-1">Full path</p>
                            <p className="text-xs font-mono break-all leading-relaxed text-content">{stat.path || "/"}</p>
                          </div>
                          <button onClick={() => doCopy(stat.path || "/", "Path copied")} className="shrink-0 h-7 w-7 rounded-lg bg-surface-muted border border-border/40 grid place-items-center text-content-muted hover:text-accent hover:border-accent/30 transition-colors">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {revealPath && (
                          <button onClick={() => revealInFileManager(revealPath)} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-surface border border-border/40 text-xs font-medium hover:border-accent/30 hover:text-accent transition-colors">
                            <ExternalLink className="h-3.5 w-3.5" /> Reveal in file manager
                          </button>
                        )}
                      </div>
                    </SectionCard>

                    {/* Tags card */}
                    <SectionCard title="Tags" icon={<TagIcon className="h-4 w-4" />} color="amber" action={
                      <span className="text-[11px] text-content-muted font-medium">{fileTags?.length ? `${fileTags.length} tag${fileTags.length === 1 ? "" : "s"}` : "No tags"}</span>
                    }>
                      {fileTags && fileTags.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {fileTags.map((t: any) => (
                            <span key={t.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border" style={{ backgroundColor: `${t.color}14`, color: t.color, borderColor: `${t.color}22` }}>
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                              {t.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-4 text-center rounded-xl border border-dashed border-border/40 bg-surface/30">
                          <TagIcon className="h-6 w-6 text-content-muted/40 mb-2" />
                          <p className="text-xs font-medium text-content-muted">No tags assigned</p>
                          <p className="text-[11px] text-content-muted/70 mt-0.5">Right-click the item → Tags… to add</p>
                        </div>
                      )}
                    </SectionCard>

                    {/* Integrity / Security card – files only */}
                    {!isDir && (
                      <SectionCard title="Integrity" icon={<ShieldCheck className="h-4 w-4" />} color="emerald" action={
                        checksum ? <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/15">SHA-256</span> : null
                      }>
                        {checksum ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 rounded-xl bg-surface border border-border/40 px-3 py-2">
                              <Hash className="h-4 w-4 text-content-muted shrink-0" />
                              <code className="flex-1 text-[11px] font-mono break-all leading-relaxed">{checksum}</code>
                              <button onClick={() => doCopy(checksum, "Checksum copied")} className="h-7 w-7 rounded-lg bg-accent text-white grid place-items-center hover:bg-accent/90 transition-colors shrink-0">
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <p className="text-[11px] text-content-muted flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Verified SHA-256 checksum of current version</p>
                          </div>
                        ) : (stat as any)?.checksum ? (
                          <div className="flex items-center gap-2 rounded-xl bg-surface border border-border/40 px-3 py-2">
                            <code className="flex-1 text-xs font-mono break-all bg-surface-muted px-2 py-1.5 rounded-lg border border-border/30">{(stat as any).checksum}</code>
                            <button onClick={() => doCopy((stat as any).checksum, "Checksum copied")} className="h-7 w-7 rounded-lg bg-surface-muted border border-border/40 grid place-items-center hover:border-accent/30 hover:text-accent transition-colors">
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface border border-border/40 p-3">
                            <div className="flex items-center gap-2.5">
                              <div className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/15 grid place-items-center">
                                <AlertCircle className="h-4 w-4 text-amber-500" />
                              </div>
                              <div>
                                <p className="text-xs font-semibold">Checksum not computed</p>
                                <p className="text-[11px] text-content-muted">Verify file integrity with SHA-256</p>
                              </div>
                            </div>
                            <Button size="sm" variant="secondary" onClick={fetchChecksum} disabled={checksumLoading} className="shrink-0">
                              {checksumLoading ? "Computing…" : "Compute"}
                            </Button>
                          </div>
                        )}
                      </SectionCard>
                    )}

                    {/* Versions shortcut — files only */}
                    {!isDir && onShowVersions && (
                      <button onClick={onShowVersions} className="w-full group flex items-center gap-3 p-3.5 rounded-2xl bg-gradient-to-r from-accent/10 via-violet-500/5 to-transparent border border-accent/15 hover:border-accent/25 hover:from-accent/15 transition-all text-left">
                        <div className="h-10 w-10 rounded-xl bg-accent/15 border border-accent/20 grid place-items-center shrink-0 group-hover:scale-105 transition-transform">
                          <History className="h-5 w-5 text-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold">Version history</p>
                          <p className="text-xs text-content-muted">Snapshots, restore & download</p>
                        </div>
                        <ArrowUpRight className="h-4 w-4 text-content-muted group-hover:text-accent group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                      </button>
                    )}

                    <p className="flex items-start gap-2 text-[11px] leading-relaxed text-content-muted bg-surface/40 border border-border/30 rounded-xl px-3 py-2.5">
                      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-accent/60" />
                      <span>Metadata such as EXIF, ID3 tags and dimensions are computed on demand and may take a moment to appear.</span>
                    </p>
                  </motion.div>
                )}

                {activeTab === "activity" && (
                  <motion.div key="activity" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="p-4">
                    <ActivityFeed rootId={rootId} path={stat.path} />
                  </motion.div>
                )}
                {activeTab === "shares" && (
                  <motion.div key="shares" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="p-4">
                    <SharesList rootId={rootId} path={stat.path} />
                  </motion.div>
                )}
                {activeTab === "comments" && (
                  <motion.div key="comments" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                    <FileComments rootId={rootId} path={stat.path} currentUserId={userId} isAdmin={isAdmin} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer — subtle bar for destructive / meta */}
            <div className="shrink-0 px-4 py-3 border-t border-border/30 bg-surface/40 backdrop-blur-xl flex items-center justify-between gap-2">
              <span className="text-[11px] text-content-muted font-medium flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Synced
              </span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => doCopy(`${window.location.origin}/files/${rootId}/${stat.path}`, "Link copied")} className="h-7 px-2.5 rounded-lg bg-surface border border-border/40 text-xs font-medium flex items-center gap-1.5 hover:border-accent/30 hover:text-accent transition-colors">
                  <Link className="h-3 w-3" /> Copy link
                </button>
                {canWrite && (
                  <button onClick={() => setConfirmDelete(true)} className="h-7 px-2.5 rounded-lg bg-red-500/10 border border-red-500/15 text-red-600 dark:text-red-400 text-xs font-semibold flex items-center gap-1 hover:bg-red-500/15 transition-colors">
                    <Trash2 className="h-3 w-3" /> Trash
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
      <ConfirmDialog
        open={confirmDelete}
        title="Move to trash?"
        description={stat ? `"${stat.name}" will be moved to trash. You can restore it later.` : ""}
        confirmLabel="Move to trash"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </Sheet>
  );
}

// ---------- subcomponents ----------
function QuickAction({ icon, label, onClick, primary, active }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean; active?: boolean }) {
  return (
    <button onClick={onClick} title={label} className={cn(
      "h-8 px-3 rounded-full border text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm",
      primary ? "bg-accent text-white border-accent shadow-[0_4px_12px_var(--color-accent-glow)] hover:opacity-95 hover:shadow-[0_6px_18px_var(--color-accent-glow)]" :
        active ? "bg-amber-400 text-white border-amber-400 shadow-md" :
          "bg-surface border-border/60 text-content hover:border-accent/30 hover:text-accent hover:bg-accent/5"
    )}>
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function MenuAction({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-medium transition-colors text-left", danger ? "text-red-600 hover:bg-red-500/10 dark:text-red-400" : "hover:bg-surface-muted text-content")}>
      <span className={cn("h-7 w-7 rounded-lg grid place-items-center border", danger ? "bg-red-500/10 border-red-500/15 text-red-500" : "bg-surface border-border/40 text-content-muted")}>{icon}</span>
      {label}
    </button>
  );
}

function TabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick}
      className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-semibold rounded-lg transition-all relative",
        active ? "bg-surface shadow-sm border border-border/50 text-content" : "text-content-muted hover:text-content hover:bg-surface/60 border border-transparent"
      )}>
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{label.slice(0, 4)}</span>
      {count !== undefined && count > 0 && (
        <span className={cn("ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none", active ? "bg-accent text-white" : "bg-surface-muted text-content-muted border border-border/40")}>{count}</span>
      )}
    </button>
  );
}

function SectionCard({ title, icon, color, action, children }: { title: string; icon: React.ReactNode; color: "accent" | "blue" | "amber" | "emerald"; action?: React.ReactNode; children: React.ReactNode }) {
  const colorMap = {
    accent: "bg-accent/10 border-accent/15 text-accent",
    blue: "bg-blue-500/10 border-blue-500/15 text-blue-500",
    amber: "bg-amber-500/10 border-amber-500/15 text-amber-500",
    emerald: "bg-emerald-500/10 border-emerald-500/15 text-emerald-500",
  } as const;
  return (
    <div className="rounded-2xl border border-border/40 bg-surface/60 backdrop-blur-sm overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/30 bg-surface-muted/30">
        <div className="flex items-center gap-2.5">
          <div className={cn("h-7 w-7 rounded-lg border grid place-items-center", colorMap[color])}>
            {icon}
          </div>
          <span className="text-xs font-bold tracking-wide uppercase text-content">{title}</span>
        </div>
        {action}
      </div>
      <div className="p-3.5">
        {children}
      </div>
    </div>
  );
}

function StatTile({ icon, label, value, sub, mono }: { icon: React.ReactNode; label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-surface border border-border/40 p-3 hover:border-border/60 transition-colors">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">{label}</span>
      </div>
      <p className={cn("text-[13px] font-semibold leading-tight truncate", mono && "font-mono text-xs")}>{value}</p>
      {sub && <p className="text-[11px] text-content-muted truncate mt-1 font-mono">{sub}</p>}
    </div>
  );
}

function ActivityFeed({ rootId, path }: { rootId: string; path: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["activity", rootId, path],
    queryFn: () => activityApi.list(rootId, path),
    enabled: !!path,
  });

  const activity = (data?.items || []).map((a: any) => ({
    id: a.id, action: a.action, user: a.user_name || "Unknown",
    time: formatDate(a.created_at), rel: formatRelative(a.created_at), detail: a.detail,
  }));

  if (isError) return <QueryError message="Could not load activity." onRetry={() => refetch()} />;
  if (isLoading) return <div className="space-y-2.5">{[1, 2, 3].map(i => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>;
  if (!activity.length) return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="h-12 w-12 rounded-2xl bg-surface border border-border/40 grid place-items-center mb-3">
        <Activity className="h-6 w-6 text-content-muted/60" />
      </div>
      <p className="text-sm font-semibold">No activity yet</p>
      <p className="text-xs text-content-muted mt-1 max-w-[220px]">Edits, shares and moves for this item will appear here.</p>
    </div>
  );

  return (
    <div className="relative">
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border/40 hidden sm:block" />
      <div className="space-y-3">
        {activity.map((a: any) => (
          <div key={a.id} className="relative flex gap-3 p-3 rounded-xl bg-surface border border-border/40 hover:border-border/60 transition-colors">
            <div className="hidden sm:grid h-8 w-8 rounded-full bg-accent/10 border border-accent/15 place-items-center shrink-0 relative z-10">
              <Activity className="h-4 w-4 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold capitalize">{a.action?.replace(/_/g, " ") || "Activity"}</p>
              <p className="text-xs text-content-muted flex items-center gap-1.5 mt-0.5">
                <span className="font-medium text-content">{a.user}</span>
                <span>•</span>
                <span title={a.time} className="flex items-center gap-1"><Clock className="h-3 w-3" />{a.rel}</span>
              </p>
              {a.detail && <p className="text-xs text-content-muted/90 mt-1.5 line-clamp-2 bg-surface-muted/50 border border-border/20 rounded-lg px-2 py-1.5">{a.detail}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SharesList({ rootId, path }: { rootId: string; path: string }) {
  const [creating, setCreating] = useState(false);
  const pushToast = useUI((s) => s.pushToast);
  const qc = useQueryClient();
  const shareKey = ["shares", rootId, path];

  const { data: shares, isLoading, isError, refetch } = useQuery({
    queryKey: shareKey,
    queryFn: () => sharesApi.list({ root: rootId, path }) as any,
    enabled: !!path,
  });

  const createShare = async () => {
    setCreating(true);
    try {
      await sharesApi.create({ root: rootId, path, scope: "preview", expires_in_hours: 0, max_downloads: 0 });
      pushToast("success", "Share link created");
      qc.invalidateQueries({ queryKey: shareKey });
    } catch (e: any) { pushToast("error", e.message); }
    setCreating(false);
  };

  const deleteShare = async (id: string) => {
    try {
      await sharesApi.delete(id);
      pushToast("success", "Share removed");
      qc.invalidateQueries({ queryKey: shareKey });
    } catch (e: any) { pushToast("error", e.message); }
  };

  const items = shares?.items || [];
  if (isError) return <QueryError message="Could not load shares." onRetry={() => refetch()} />;
  if (isLoading) return <div className="space-y-2.5">{[1, 2].map(i => <div key={i} className="skeleton h-24 rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
        <div className="h-8 w-8 rounded-lg bg-blue-500/10 border border-blue-500/15 grid place-items-center shrink-0">
          <Share2 className="h-4 w-4 text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold">Share this item</p>
          <p className="text-[11px] text-content-muted">Anyone with the link can preview or download</p>
        </div>
      </div>

      {items.length === 0 ? (
        <button onClick={createShare} disabled={creating}
          className="w-full p-5 rounded-2xl bg-surface border-2 border-dashed border-border/40 flex flex-col items-center justify-center gap-2 text-content-muted hover:text-content hover:border-accent/30 hover:bg-accent/5 transition-all group">
          <div className="h-10 w-10 rounded-xl bg-accent/10 border border-accent/15 grid place-items-center group-hover:scale-105 transition-transform">
            <Share2 className="h-5 w-5 text-accent" />
          </div>
          <span className="font-semibold text-sm">{creating ? "Creating…" : "Create share link"}</span>
          <span className="text-xs">Generate a secure, expiring link</span>
        </button>
      ) : (
        <div className="space-y-3">
          {items.map((s: any) => (
            <div key={s.id} className="p-3.5 rounded-2xl bg-surface border border-border/40 shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-7 w-7 rounded-lg bg-accent/10 border border-accent/15 grid place-items-center shrink-0">
                    <Link className="h-3.5 w-3.5 text-accent" />
                  </div>
                  <span className="text-xs font-mono font-medium truncate">/s/{s.token}</span>
                  <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/15 text-[10px] font-bold uppercase">Active</span>
                </div>
                <button onClick={async () => { try { await navigator.clipboard.writeText(new URL(`/s/${s.token}`, window.location.origin).toString()); pushToast("success", "Link copied"); } catch { pushToast("error", "Could not copy link"); } }}
                  className="h-7 px-2.5 rounded-lg bg-accent text-white text-xs font-semibold flex items-center gap-1 hover:bg-accent/90 transition-colors shrink-0">
                  <Copy className="h-3 w-3" /> Copy
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-muted border border-border/30 text-content-muted"><Clock className="h-3 w-3" />{s.expires_at ? formatDate(s.expires_at) : "No expiry"}</span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-muted border border-border/30 text-content-muted"><Activity className="h-3 w-3" />{s.downloads ?? s.download_count ?? 0} / {s.max_downloads ? s.max_downloads : "∞"} downloads</span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-muted border border-border/30 text-content-muted capitalize"><ShieldCheck className="h-3 w-3" />{s.scope}</span>
              </div>
              <button onClick={() => deleteShare(s.id)}
                className="w-full mt-3 py-2 rounded-xl bg-red-500/8 border border-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/12 text-xs font-semibold transition-colors">Revoke link</button>
            </div>
          ))}
          <button onClick={createShare} disabled={creating} className="w-full py-2.5 rounded-xl bg-surface border border-border/40 text-sm font-medium hover:border-accent/30 hover:text-accent transition-colors flex items-center justify-center gap-2">
            <Share2 className="h-4 w-4" /> {creating ? "Creating…" : "New link"}
          </button>
        </div>
      )}
    </div>
  );
}

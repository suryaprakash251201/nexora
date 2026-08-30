import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import {
  X, Plus, Search, Download, Eye, Pencil, Trash2, Scissors, Copy, Info, Star, Share2, Activity, Clock, Link, FolderOpen, MessageSquare, History,
  HardDrive, Calendar, Tag as TagIcon, ShieldCheck, Hash, FileType, Image as ImageIcon, MoreHorizontal, Edit3, ExternalLink, Lock, CheckCircle2, AlertCircle, Layers,
  ChevronRight, ImageOff, Check, Video as VideoIcon,
} from "lucide-react";
import { filesApi, sharesApi, activityApi, tagsApi, versionsApi } from "../api/endpoints";
import { formatBytes, formatDate, formatRelative } from "../lib/format";
import { useUI } from "../store";
import { FileThumb } from "./FileThumb";
import { TagChip, TagDot, TAG_COLORS } from "./TagManager";
import { VersionTimeline } from "./VersionTimeline";
import { Button } from "./ui/Button";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { QueryError } from "./ui/QueryError";
import { Sheet, SheetContent } from "./ui/sheet";
import { Accordion, MetaRow, AccordionDivider } from "./ui/Accordion";
import { revealInFileManager } from "../lib/desktop";
import { FileComments } from "./FileComments";
import { cn } from "@/lib/utils";

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

/** Icon for the hero tile, chosen by kind. Used only when no real thumbnail exists. */
/** Human-readable mime, or null when the raw value would look like noise. */
function friendlyMime(mime: string | undefined, ext: string, isDir: boolean): string | null {
  if (isDir || !mime) return null;
  if (mime === "application/octet-stream") return null;
  // Already implied by the kind label — don't repeat "image/jpeg" under
  // "JPEG Image".
  if (ext && mime.startsWith(`${ext.toLowerCase()}/`)) return null;
  return mime;
}

/** Split a path into (rootName, segments[]) for the breadcrumb. */
function pathSegments(path: string): string[] {
  return (path || "").split("/").filter(Boolean);
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [checksum, setChecksum] = useState<string | null>(null);
  const [checksumLoading, setChecksumLoading] = useState(false);
  const pushToast = useUI((s) => s.pushToast);
  const qc = useQueryClient();
  const doCopy = useCopyToast();
  const navigate = useNavigate();

  // Close the overflow menu on Escape (the Sheet handles Escape for itself,
  // but this inner popover is plain state — give it the same affordance).
  useEffect(() => {
    if (!showMore) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowMore(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showMore]);

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

  // Badge counts are cheap and always-on so the section headers can show
  // them without opening each section.
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
  const { data: versionsData } = useQuery({
    queryKey: ["file-versions", rootId, path],
    queryFn: () => versionsApi.list(rootId, path),
    enabled: !!path && !stat?.is_dir,
  });

  const sharesCount = sharesData?.items?.length ?? 0;
  const commentsCount = commentsData?.items?.length ?? 0;
  const activityCount = activityData?.items?.length ?? 0;
  const versionsCount = !stat?.is_dir ? (versionsData?.versions?.length ?? 0) : 0;

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
  const mimeSub = useMemo(() => friendlyMime(stat?.mime, stat?.extension || "", isDir), [stat, isDir]);

  // Breadcrumb: rootName / a / b / file
  const crumbs = useMemo(() => pathSegments(stat?.path || ""), [stat?.path]);
  // Navigate the file browser to a folder path and close the drawer.
  const openFolder = (folderPath: string) => {
    navigate(`/files/${rootId}${folderPath ? "/" + folderPath : ""}`);
    onClose();
  };

  const hasMedia = !isDir && (!!meta?.width || !!(stat as any)?.width || !!(stat as any)?.media);

  return (
    <Sheet open={!!path} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent showCloseButton={false} className="w-full sm:w-[440px] p-0 flex flex-col overflow-hidden bg-popover border-l border-border/40">
        {/* ─── Hero ─── */}
        <div className="relative shrink-0 border-b border-border/40 bg-surface-muted/20">
          {/* Row 1: close / reveal */}
          <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1">
            {revealPath && (
              <button onClick={() => revealInFileManager(revealPath)} title="Reveal in file manager" className="hidden sm:grid h-8 w-8 place-items-center rounded-xl hover:bg-glass-bg border border-transparent hover:border-border/40 text-content-muted hover:text-content transition-colors">
                <FolderOpen className="h-4 w-4" />
              </button>
            )}
            <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-xl hover:bg-glass-bg border border-transparent hover:border-border/40 text-content-muted hover:text-content transition-colors" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tile + name + kind */}
          <div className="px-4 sm:px-5 pt-5 pb-3 flex items-start gap-3.5">
            <div className="relative shrink-0">
              <div className="h-16 w-16 rounded-2xl bg-surface border border-border/50 shadow-sm overflow-hidden grid place-items-center">
                {stat?.is_dir ? (
                  <img src="/folder.png" alt="" width={56} height={56} className="drop-shadow-sm" />
                ) : stat ? (
                  <FileThumb it={{ ...stat, root_id: rootId } as any} fill />
                ) : (
                  <Layers className="h-6 w-6 text-accent" />
                )}
              </div>
              {stat?.is_favorite || isFavorite ? (
                <div className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-amber-400 border-2 border-background grid place-items-center">
                  <Star className="h-2.5 w-2.5 fill-white text-white" />
                </div>
              ) : null}
            </div>
            <div className="flex-1 min-w-0 pr-16">
              <h2 className="text-[15px] font-semibold leading-snug break-all" title={stat?.name}>{stat?.name || "Select an item"}</h2>
              <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                {kind && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/15 text-accent text-[10px] font-bold uppercase tracking-wide">
                    <FileType className="h-3 w-3" /> {kind}
                  </span>
                )}
                {stat && !isDir && (
                  <span className="text-[11px] text-content-muted font-medium">{sizeLabel}</span>
                )}
              </div>
            </div>
          </div>

          {/* Breadcrumb — click any segment to jump there */}
          {stat && crumbs.length > 0 && (
            <div className="px-4 sm:px-5 pb-3 -mt-1">
              <nav aria-label="Location" className="flex items-center gap-0.5 text-[11px] font-medium overflow-x-auto no-scrollbar mask-edges py-1">
                <button
                  onClick={() => openFolder("")}
                  title={`Open ${rootName}`}
                  className="shrink-0 px-1.5 py-0.5 rounded-md bg-accent/10 text-accent border border-accent/15 hover:bg-accent/15 transition-colors font-semibold"
                >
                  {rootName}
                </button>
                {crumbs.map((c, i) => {
                  const isLast = i === crumbs.length - 1;
                  const target = crumbs.slice(0, i + 1).join("/");
                  return (
                    <span key={target} className="flex items-center min-w-0">
                      <ChevronRight className="h-3 w-3 text-content-muted/50 shrink-0" />
                      {isLast ? (
                        <span className="px-1.5 py-0.5 truncate text-content font-semibold" title={stat.path}>{c}</span>
                      ) : (
                        <button
                          onClick={() => openFolder(target)}
                          title={`Open ${rootName}/${target}`}
                          className="px-1 py-0.5 rounded-md truncate text-content-muted hover:text-content hover:bg-glass-bg transition-colors"
                        >
                          {c}
                        </button>
                      )}
                    </span>
                  );
                })}
              </nav>
            </div>
          )}

          {/* Quick Action Bar — always visible, wraps on narrow widths */}
          {stat && (
            <div className="px-4 sm:px-5 pb-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                <QuickAction icon={<Download className="h-4 w-4" />} label="Download" onClick={onDownload} primary />
                <QuickAction icon={!isDir ? <Eye className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />} label={!isDir ? "Preview" : "Open"} onClick={onPreview} />
                <QuickAction icon={<Share2 className="h-4 w-4" />} label="Share" onClick={onShare} />
                <QuickAction
                  icon={isFavorite ? <Star className="h-4 w-4 fill-current" /> : <Star className="h-4 w-4" />}
                  label={isFavorite ? "Starred" : "Star"}
                  onClick={onFavorite}
                  active={isFavorite}
                />
                <div className="relative">
                  <button
                    onClick={() => setShowMore(v => !v)}
                    aria-expanded={showMore}
                    aria-label="More actions"
                    className={cn("h-8 w-8 grid place-items-center rounded-full border text-xs font-semibold transition-all",
                      showMore ? "border-accent/30 bg-accent/10 text-accent" : "border-border/60 bg-surface text-content-muted hover:text-content hover:border-accent/30")}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  <AnimatePresence>
                    {showMore && (
                      <>
                        {/* click-away layer */}
                        <div className="fixed inset-0 z-10" onClick={() => setShowMore(false)} aria-hidden />
                        <motion.div
                          initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }}
                          transition={{ duration: 0.16 }}
                          className="absolute right-0 top-10 w-52 rounded-2xl border border-border/50 bg-popover/95 backdrop-blur-xl shadow-xl overflow-hidden z-20"
                        >
                          <div className="p-1.5 space-y-0.5">
                            <MenuAction icon={<Pencil className="h-4 w-4" />} label="Rename" onClick={() => { setShowMore(false); onRename(); }} />
                            {!isDir && canWrite && <MenuAction icon={<Edit3 className="h-4 w-4" />} label="Edit" onClick={() => { setShowMore(false); onEdit(); }} />}
                            <MenuAction icon={<Scissors className="h-4 w-4" />} label="Move" onClick={() => { setShowMore(false); onMove(); }} />
                            <MenuAction icon={<Copy className="h-4 w-4" />} label="Copy" onClick={() => { setShowMore(false); onCopy(); }} />
                            {!isDir && onShowVersions && <MenuAction icon={<History className="h-4 w-4" />} label="Version history" onClick={() => { setShowMore(false); onShowVersions(); }} />}
                            <MenuAction icon={<Link className="h-4 w-4" />} label="Copy link" onClick={() => { setShowMore(false); doCopy(`${window.location.origin}/files/${rootId}/${stat.path}`, "Link copied"); }} />
                            {canWrite && <div className="h-px bg-border/40 my-1" />}
                            {canWrite && <MenuAction icon={<Trash2 className="h-4 w-4" />} label="Move to trash" danger onClick={() => { setShowMore(false); setConfirmDelete(true); }} />}
                          </div>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── Empty / Loading / Error states ─── */}
        {!path ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="h-16 w-16 rounded-2xl bg-accent/8 border border-accent/10 grid place-items-center mb-4">
              <Info className="h-7 w-7 text-accent/60" />
            </div>
            <p className="text-sm font-semibold">Nothing selected</p>
            <p className="text-xs text-content-muted mt-1 max-w-[240px]">Right-click any file or folder and choose <span className="font-semibold text-content">Properties</span> to see its details here.</p>
          </div>
        ) : isLoading ? (
          <div className="flex-1 overflow-hidden p-4 space-y-3">
            <div className="skeleton h-28 rounded-2xl" />
            <div className="skeleton h-20 rounded-2xl" />
            <div className="skeleton h-24 rounded-2xl" />
            <div className="skeleton h-20 rounded-2xl" />
          </div>
        ) : isError ? (
          <div className="flex-1">
            <QueryError message="Could not load details." onRetry={() => refetch()} />
          </div>
        ) : stat ? (
          /* ─── Scrollable Content ─── */
          <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface-muted/20">
            <div className="p-3.5 space-y-3">
              {/* ── Basic ── */}
              <Accordion title="Details" icon={<Info className="h-4 w-4" />} color="accent" persistKey="inspect-basic">
                <MetaRow icon={<FileType className="h-4 w-4 text-violet-500" />} label="Kind" value={kind} sub={mimeSub || undefined} />
                <AccordionDivider />
                <MetaRow
                  icon={<HardDrive className="h-4 w-4 text-blue-500" />}
                  label={isDir ? "Total size" : "Size"}
                  value={sizeLabel}
                  sub={isDir ? undefined : exactSize}
                />
                <AccordionDivider />
                <MetaRow icon={<Calendar className="h-4 w-4 text-emerald-500" />} label="Modified" value={modifiedRel || "—"} sub={modifiedAbs} />
                <AccordionDivider />
                {isDir ? (
                  <MetaRow
                    icon={<FolderOpen className="h-4 w-4 text-amber-500" />}
                    label="Contents"
                    value={folderInfo ? `${folderInfo.count} item${folderInfo.count === 1 ? "" : "s"}` : "—"}
                    sub={folderInfo ? `${folderInfo.files} file${folderInfo.files === 1 ? "" : "s"} · ${folderInfo.folders} folder${folderInfo.folders === 1 ? "" : "s"}` : undefined}
                  />
                ) : (
                  <MetaRow
                    icon={<Hash className="h-4 w-4 text-amber-500" />}
                    label="Extension"
                    value={stat.extension ? `.${stat.extension.toLowerCase()}` : "— none —"}
                    sub={mimeSub || undefined}
                  />
                )}
                <AccordionDivider />
                <div className="flex items-center gap-3 py-1.5">
                  <div className="h-8 w-8 rounded-lg bg-white/[0.03] border border-white/[0.05] grid place-items-center shrink-0">
                    {canWrite ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Lock className="h-4 w-4 text-amber-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-content-muted">Access</p>
                    <p className="text-sm font-medium leading-tight">{canWrite ? "Read & write" : "Read only"}</p>
                  </div>
                  {!canWrite && (
                    <span className="text-[10px] text-content-muted bg-surface-muted border border-border/40 px-2 py-0.5 rounded-full shrink-0">locked</span>
                  )}
                </div>
              </Accordion>

              {/* ── Media (conditional) ── */}
              {hasMedia && (
                <Accordion title="Media" icon={<ImageIcon className="h-4 w-4" />} color="violet" defaultOpen={false} persistKey="inspect-media">
                  {(meta?.width || (stat as any)?.width) && (
                    <>
                      <MetaRow
                        icon={<ImageIcon className="h-4 w-4 text-violet-500" />}
                        label="Dimensions"
                        value={`${meta?.width || (stat as any)?.width} × ${meta?.height || (stat as any)?.height} px`}
                        mono
                      />
                      {meta?.editable !== undefined && <AccordionDivider />}
                      {meta?.editable !== undefined && (
                        <div className="flex items-center gap-3 py-1.5">
                          <div className="h-8 w-8 rounded-lg bg-white/[0.03] border border-white/[0.05] grid place-items-center shrink-0">
                            {meta.editable ? <Edit3 className="h-4 w-4 text-emerald-400" /> : <ImageOff className="h-4 w-4 text-content-muted" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-content-muted">Editable</p>
                            <p className="text-sm font-medium leading-tight">{meta.editable ? "Yes — text-based" : "Binary"}</p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {(stat as any)?.media && (
                    <>
                      {(meta?.width || (stat as any)?.width) && <AccordionDivider />}
                      <MetaRow
                        icon={<VideoIcon className="h-4 w-4 text-pink-500" />}
                        label="Video"
                        value={`${Math.round(((stat as any).media.duration || 0))}s`}
                        sub={`${(stat as any).media.width}×${(stat as any).media.height}`}
                        mono
                      />
                    </>
                  )}
                </Accordion>
              )}

              {/* ── Location ── */}
              <Accordion title="Location" icon={<FolderOpen className="h-4 w-4" />} color="blue" defaultOpen={false} persistKey="inspect-location">
                <MetaRow
                  icon={<Layers className="h-4 w-4 text-blue-500" />}
                  label="Storage root"
                  value={rootName}
                />
                <AccordionDivider />
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-white/[0.03] border border-white/[0.05] grid place-items-center shrink-0">
                    <Link className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-content-muted">Full path</p>
                    <code className="block text-xs font-mono break-all text-content-secondary leading-relaxed mt-0.5">{stat.path || "/"}</code>
                  </div>
                  <button
                    onClick={() => doCopy(stat.path || "/", "Path copied")}
                    className="shrink-0 h-7 w-7 rounded-lg bg-surface-muted border border-border/40 grid place-items-center text-content-muted hover:text-accent hover:border-accent/30 transition-colors"
                    title="Copy path"
                    aria-label="Copy path"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => openFolder(crumbs.slice(0, -1).join("/"))}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-surface border border-border/40 text-xs font-medium hover:border-accent/30 hover:text-accent transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5" /> Open folder
                  </button>
                  {revealPath && (
                    <button
                      onClick={() => revealInFileManager(revealPath)}
                      className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-surface border border-border/40 text-xs font-medium hover:border-accent/30 hover:text-accent transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Reveal
                    </button>
                  )}
                </div>
              </Accordion>

              {/* ── Tags ── */}
              <Accordion
                title="Tags"
                icon={<TagIcon className="h-4 w-4" />}
                color="amber"
                persistKey="inspect-tags"
                action={
                  fileTags?.length ? <CountBadge n={fileTags.length} tone="amber" /> : null
                }
              >
                <TagsEditor rootId={rootId} path={stat.path} />
              </Accordion>

              {/* ── Integrity (files only) ── */}
              {!isDir && (
                <Accordion title="Integrity" icon={<ShieldCheck className="h-4 w-4" />} color="emerald" defaultOpen={false} persistKey="inspect-integrity">
                  {checksum ? (
                    <div className="space-y-2">
                      <div className="flex items-start gap-2 rounded-xl bg-surface border border-border/40 px-3 py-2">
                        <code className="flex-1 text-[11px] font-mono break-all leading-relaxed text-content-secondary">{checksum}</code>
                        <button onClick={() => doCopy(checksum, "Checksum copied")} className="h-7 w-7 rounded-lg bg-surface-muted border border-border/40 grid place-items-center hover:text-accent hover:border-accent/30 transition-colors shrink-0" title="Copy checksum" aria-label="Copy checksum">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="text-[11px] text-content-muted flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> SHA-256 · {formatBytes(stat.size)} hashed</p>
                    </div>
                  ) : (stat as any)?.checksum ? (
                    <div className="flex items-start gap-2 rounded-xl bg-surface border border-border/40 px-3 py-2">
                      <code className="flex-1 text-[11px] font-mono break-all leading-relaxed bg-surface-muted px-2 py-1.5 rounded-lg border border-border/30">{(stat as any).checksum}</code>
                      <button onClick={() => doCopy((stat as any).checksum, "Checksum copied")} className="h-7 w-7 rounded-lg bg-surface-muted border border-border/40 grid place-items-center hover:border-accent/30 hover:text-accent transition-colors shrink-0" title="Copy checksum" aria-label="Copy checksum">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface border border-border/40 p-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/15 grid place-items-center shrink-0">
                          <AlertCircle className="h-4 w-4 text-amber-500" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold">Not computed</p>
                          <p className="text-[11px] text-content-muted">Verify integrity with SHA-256</p>
                        </div>
                      </div>
                      <Button size="sm" variant="secondary" onClick={fetchChecksum} disabled={checksumLoading} className="shrink-0">
                        {checksumLoading ? "Hashing…" : "Compute"}
                      </Button>
                    </div>
                  )}
                </Accordion>
              )}

              {/* ── Versions (files only, inline preview) ── */}
              {!isDir && versionsCount > 0 && (
                <Accordion
                  title="Versions"
                  icon={<History className="h-4 w-4" />}
                  color="violet"
                  persistKey="inspect-versions"
                  action={onShowVersions ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onShowVersions(); }}
                      className="text-[10px] font-semibold text-content-muted hover:text-accent transition-colors px-1.5 py-0.5 rounded-lg hover:bg-accent/10"
                    >
                      View all →
                    </button>
                  ) : null}
                >
                  <VersionTimeline rootId={rootId} path={stat.path} actions={false} />
                </Accordion>
              )}

              {/* ── Activity ── */}
              <Accordion
                title="Activity"
                icon={<Activity className="h-4 w-4" />}
                color="blue"
                defaultOpen={false}
                persistKey="inspect-activity"
                action={activityCount > 0 ? <CountBadge n={activityCount} tone="blue" /> : null}
              >
                <ActivityFeed rootId={rootId} path={stat.path} />
              </Accordion>

              {/* ── Sharing ── */}
              <Accordion
                title="Sharing"
                icon={<Share2 className="h-4 w-4" />}
                color="blue"
                defaultOpen={false}
                persistKey="inspect-sharing"
                action={sharesCount > 0 ? <CountBadge n={sharesCount} tone="blue" /> : null}
              >
                <SharesList rootId={rootId} path={stat.path} />
              </Accordion>

              {/* ── Notes ── */}
              <Accordion
                title="Notes"
                icon={<MessageSquare className="h-4 w-4" />}
                color="slate"
                defaultOpen={false}
                persistKey="inspect-notes"
                action={commentsCount > 0 ? <CountBadge n={commentsCount} tone="slate" /> : null}
              >
                <FileComments rootId={rootId} path={stat.path} currentUserId={userId} isAdmin={isAdmin} />
              </Accordion>
            </div>
          </div>
        ) : null}
      </SheetContent>

      {/* ─── Delete Confirmation ─── */}
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
    <button onClick={onClick} title={label} aria-pressed={active} className={cn(
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

/** Small count badge used in accordion headers. */
function CountBadge({ n, tone = "blue" }: { n: number; tone?: "blue" | "amber" | "slate" }) {
  const tones = {
    blue: "text-blue-400 bg-blue-500/15 border-blue-500/20",
    amber: "text-amber-400 bg-amber-500/15 border-amber-500/20",
    slate: "text-content-muted bg-white/[0.06] border-border/40",
  } as const;
  return <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full border", tones[tone])}>{n}</span>;
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
    <div className="flex flex-col items-center justify-center py-10 text-center">
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
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

  const copyLink = async (id: string, token: string) => {
    try {
      await navigator.clipboard.writeText(new URL(`/s/${token}`, window.location.origin).toString());
      pushToast("success", "Link copied");
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch { pushToast("error", "Could not copy link"); }
  };

  const items = shares?.items || [];
  if (isError) return <QueryError message="Could not load shares." onRetry={() => refetch()} />;
  if (isLoading) return <div className="space-y-2.5">{[1, 2].map(i => <div key={i} className="skeleton h-24 rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <button onClick={createShare} disabled={creating}
          className="w-full p-5 rounded-2xl bg-surface border-2 border-dashed border-border/40 flex flex-col items-center justify-center gap-2 text-content-muted hover:text-content hover:border-accent/30 hover:bg-accent/5 transition-all group">
          <div className="h-10 w-10 rounded-xl bg-accent/10 border border-accent/15 grid place-items-center group-hover:scale-105 transition-transform">
            <Share2 className="h-5 w-5 text-accent" />
          </div>
          <span className="font-semibold text-sm">{creating ? "Creating…" : "Create share link"}</span>
          <span className="text-xs">Anyone with the link can preview or download</span>
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
                  <span className="text-xs font-mono font-medium truncate">/s/{s.token.slice(0, 10)}…</span>
                </div>
                <button onClick={() => copyLink(s.id, s.token)}
                  className="h-7 px-2.5 rounded-lg bg-accent text-white text-xs font-semibold flex items-center gap-1 hover:bg-accent/90 transition-colors shrink-0">
                  {copiedId === s.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedId === s.id ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-muted border border-border/30 text-content-muted"><Clock className="h-3 w-3" />{s.expires_at ? formatDate(s.expires_at) : "No expiry"}</span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-muted border border-border/30 text-content-muted"><Download className="h-3 w-3" />{s.downloads ?? s.download_count ?? 0}{s.max_downloads ? ` / ${s.max_downloads}` : ""}</span>
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

/**
 * TagsEditor — inline tag management for a single file/folder, rendered inside
 * the Properties → Tags card. Reuses the shared ["file-tags-single"] query so it
 * stays in sync with the drawer's own tag fetch.
 */
function TagsEditor({ rootId, path }: { rootId: string; path: string }) {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[6].value);

  const all = useQuery({ queryKey: ["tags"], queryFn: () => tagsApi.listRaw().then((d) => d.tags || []) });
  const mine = useQuery({
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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["file-tags-single", rootId, path] });
    qc.invalidateQueries({ queryKey: ["file-tags"] });
  };

  const apply = useMutation({
    mutationFn: (id: string) => tagsApi.tagFile({ tag_id: id, root_id: rootId, paths: [path] }),
    onSuccess: invalidate,
    onError: (e: any) => pushToast("error", e.message || "Failed to add tag"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => tagsApi.untagFile({ tag_id: id, root_id: rootId, paths: path }),
    onSuccess: invalidate,
    onError: (e: any) => pushToast("error", e.message || "Failed to remove tag"),
  });
  const create = useMutation({
    mutationFn: (data: { name: string; color: string }) => tagsApi.create(data as any),
    onSuccess: async (tag: any) => {
      try { await tagsApi.tagFile({ tag_id: tag.id, root_id: rootId, paths: [path] }); } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ["tags"] });
      invalidate();
      setNewName("");
      pushToast("success", "Tag added");
    },
    onError: (e: any) => pushToast("error", e.message || "Failed to create tag"),
  });

  const mineIds = new Set((mine.data || []).map((t: any) => t.id));
  const unapplied = (all.data || []).filter((t) => !mineIds.has(t.id) && t.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-2.5">
      {mine.isLoading ? (
        <div className="flex gap-1.5">
          <div className="skeleton h-6 w-20 rounded-full" />
          <div className="skeleton h-6 w-16 rounded-full" />
        </div>
      ) : mine.data && mine.data.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {mine.data.map((t: any) => (
            <TagChip key={t.id} tag={t} onRemove={() => remove.mutate(t.id)} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-content-muted">No tags yet — add one below to find this faster.</p>
      )}

      <AnimatePresence initial={false}>
        {adding ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden space-y-2"
          >
            <div className="flex items-center gap-2 rounded-lg glass-input px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-content-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find or create…"
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-content-muted"
                autoFocus
              />
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
              {unapplied.map((t) => (
                <button
                  key={t.id}
                  onClick={() => apply.mutate(t.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-transparent text-content-secondary hover:bg-white/[0.04] transition-colors"
                >
                  <TagDot color={t.color} />
                  {t.name}
                  <Plus className="h-3 w-3 text-content-muted" />
                </button>
              ))}
              {unapplied.length === 0 && !q && <span className="text-xs text-content-muted">All tags applied.</span>}
              {unapplied.length === 0 && q && <span className="text-xs text-content-muted">No matching tags — create one below.</span>}
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-surface/40 p-2.5 space-y-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New tag name…"
                className="w-full rounded-lg glass-input px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent/50"
                onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) create.mutate({ name: newName.trim(), color: newColor }); }}
              />
              <div className="flex items-center gap-2">
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {TAG_COLORS.map((c: { name: string; value: string }) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setNewColor(c.value)}
                      className={cn("h-4 w-4 rounded-full transition-all", newColor === c.value ? "ring-2 ring-offset-2 ring-offset-transparent scale-110" : "hover:scale-110")}
                      style={{ background: c.value, boxShadow: newColor === c.value ? `0 0 10px ${c.value}` : "none", "--tw-ring-color": c.value } as React.CSSProperties}
                      aria-label={`Use color ${c.name}`}
                    />
                  ))}
                </div>
                <button
                  onClick={() => newName.trim() && create.mutate({ name: newName.trim(), color: newColor })}
                  disabled={!newName.trim() || create.isPending}
                  className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium disabled:opacity-40 transition-colors"
                >
                  {create.isPending ? "…" : "Create"}
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-border/40 text-xs font-medium text-content-muted hover:text-content hover:border-accent/30 hover:bg-accent/5 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add tag
          </button>
        )}
      </AnimatePresence>
    </div>
  );
}

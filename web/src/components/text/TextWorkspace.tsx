/**
 * TextWorkspace — premium document viewing/editing surface for text-ish files
 * (txt, md, json, yaml, csv, logs, code…). Replaces the old modal-editor with
 * a two-mode workspace: Preview (reading) ⇄ Edit (writing), sharing one
 * document surface, a quiet status bar, a File-details popover and a More
 * actions menu.
 *
 * Used by:
 *   - Editor.tsx            (edit-first entry from the file browser)
 *   - PreviewModal.tsx      (preview-first entry for text/markdown kinds)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X, Save, Loader2, AlertTriangle, FileText, Pencil, Eye, Download, Share2,
  Maximize, Minimize, Info, Check, ChevronDown, Copy,
  Captions,
} from "lucide-react";
import { motion } from "framer-motion";
import { filesApi } from "../../api/endpoints";
import { useUI } from "../../store";
import type { FileItem } from "../../api/types";
import { codeLanguage } from "../../lib/preview";
import { startDownload } from "../../lib/transfer";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import { formatBytes, formatDate } from "../../lib/format";
import TextEditor from "./TextEditor";
import TextPreview, { pickFlavor } from "./TextPreview";

type Mode = "preview" | "edit";
type SaveState = "saved" | "dirty" | "saving" | "error";

export interface TextWorkspaceProps {
  item: FileItem;
  rootId: string;
  /** Which mode opens first. Default: preview. */
  initialMode?: Mode;
  canWrite?: boolean;
  onClose: () => void;
  /** Fired after a successful save so parents can refresh listings. */
  onSaved?: () => void;
  onShare?: (item: FileItem) => void;
}

export default function TextWorkspace({
  item, rootId, initialMode = "preview", canWrite, onClose, onSaved, onShare,
}: TextWorkspaceProps) {
  const pushToast = useUI((s) => s.pushToast);
  const focusRef = useFocusTrap(true);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [version, setVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [wrap, setWrap] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [caret, setCaret] = useState({ line: 1, col: 1 });

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollMemory = useRef<{ preview?: number; edit?: number }>({});
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const ext = (item.extension || "").toLowerCase();
  const lang = codeLanguage(ext);
  const flavor = useMemo(() => pickFlavor(ext, content), [ext, content]);
  const dirty = mode === "edit" && content !== original;
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;

  /* ── load ── */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    filesApi.content(rootId, item.path)
      .then((r) => {
        if (!alive) return;
        setContent(r.content);
        setOriginal(r.content);
        setVersion(r.version ?? "");
      })
      .catch((e: any) => alive && setLoadError(e.message || "Could not open file"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [rootId, item.path]);

  /* ── save ── */
  const save = useCallback(async (force = false) => {
    if (saveState === "saving") return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await filesApi.save(rootId, item.path, content, force ? "" : version);
      setVersion(res.version);
      setOriginal(content);
      setSaveState("saved");
      onSaved?.();
      // Optimistic quiet confirmation lives in the status bar; no toast spam.
    } catch (e: any) {
      if (e.code === "version_conflict") {
        setConflictOpen(true);
        setSaveState("dirty");
      } else {
        setSaveState("error");
        setSaveError(e.message || "Save failed");
      }
    }
  }, [content, rootId, item.path, saveState, version, onSaved]);

  /* ── keyboard layer ── */
  const tryClose = useCallback(() => {
    if (dirty) { setCloseConfirm(true); return; }
    onClose();
  }, [dirty, onClose]);
  const saveRef = useRef(save);
  const closeRef = useRef(tryClose);
  const fsRef = useRef(setFullscreen);
  saveRef.current = save;
  closeRef.current = tryClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void saveRef.current(); }
      else if (mod && e.key.toLowerCase() === "f") { /* editor handles its own */ }
      else if (e.key === "F11") { e.preventDefault(); fsRef.current((f) => !f); }
      else if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  /* ── mode switching preserves scroll ── */
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    const el = surfaceRef.current;
    if (el) scrollMemory.current[mode] = el.scrollTop;
    setMode(next);
    requestAnimationFrame(() => {
      const target = surfaceRef.current;
      if (target) target.scrollTop = scrollMemory.current[next] ?? 0;
      if (next === "edit") taRef.current?.focus({ preventScroll: true });
    });
  };

  /* ── actions ── */
  const download = () => startDownload(rootId, item.path, item.name);
  const copyPath = async () => {
    try { await navigator.clipboard.writeText(item.path); setCopiedPath(true); setTimeout(() => setCopiedPath(false), 1200); }
    catch { pushToast("error", "Clipboard unavailable"); }
  };

  // Synced-lyrics (.lrc) cue inserter — preserved from the legacy editor.
  const isLrc = (item.extension || "").toLowerCase() === "lrc";
  const insertTimestamp = () => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const stamp = "[00:00.00] ";
    setContent(content.slice(0, start) + stamp + content.slice(end));
    setSaveState("dirty");
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + stamp.length;
    });
  };

  /* ── status bar model ── */
  const langLabel = lang === "plain" && flavor === "markdown" ? "Markdown"
    : lang === "plain" ? (flavor === "csv" ? "CSV" : flavor === "log" ? "Log" : "Plain Text")
    : lang.toUpperCase();

  return (
    <div
      ref={focusRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${item.name} workspace`}
      tabIndex={-1}
      onMouseDown={(e) => { if (e.target === e.currentTarget) tryClose(); }}
      className={cn(
        "fixed z-[var(--z-modal)] flex flex-col bg-surface text-content shadow-2xl outline-none",
        fullscreen
          ? "inset-0 animate-fade-in"
          : "inset-2 md:inset-6 lg:inset-x-auto lg:left-1/2 lg:-translate-x-1/2 lg:w-full lg:max-w-6xl lg:inset-y-6 rounded-2xl border border-border/70 overflow-hidden animate-scale-in"
      )}
    >
      {/* ── DocumentHeader ─────────────────────────────────────────── */}
      <header
        className={cn(
          "relative flex shrink-0 items-center gap-3 border-b border-border/50 bg-surface-elevated/60 px-4 py-3",
          fullscreen && "px-5 py-2.5"
        )}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 ring-1 ring-accent/20">
          <FileText className="h-4.5 w-4.5 text-accent" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold tracking-tight md:text-base">{item.name}</h2>
            <span className="hidden shrink-0 rounded-md border border-border/50 bg-surface-muted px-1.5 py-px font-mono text-[10px] font-bold uppercase tracking-wider text-content-muted sm:inline">
              {(ext || "txt").toUpperCase()}
            </span>
          </div>
          <p className="truncate text-[11px] leading-4 text-content-muted">
            {langLabel} · {lineCount.toLocaleString()} line{lineCount === 1 ? "" : "s"} ·{" "}
            {formatBytes(content.length)}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          {/* Primary action */}
          {canWrite !== false && (
            <>
              {mode === "preview" ? (
                <Button variant="primary" size="sm" onClick={() => switchMode("edit")}
                  icon={<Pencil className="h-3.5 w-3.5" />}>
                  Edit
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => void save()} disabled={saveState === "saving" || !dirty}
                  icon={saveState === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}>
                  <span className="hidden sm:inline">Save</span>
                </Button>
              )}
              <Sep />
            </>
          )}

          {/* Secondary icon actions */}
          {mode === "edit" && isLrc && (
            <IconAction label="Insert [mm:ss.xx] cue at cursor" onClick={insertTimestamp}>
              <Captions className="h-4 w-4" />
            </IconAction>
          )}
          <IconAction label={copiedPath ? "Copied!" : "Copy path"} onClick={copyPath}>
            {copiedPath ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </IconAction>
          <IconAction label="Download" onClick={download}><Download className="h-4 w-4" /></IconAction>
          {onShare && (
            <IconAction label="Share" onClick={() => onShare(item)} className="hidden sm:grid">
              <Share2 className="h-4 w-4" />
            </IconAction>
          )}
          <IconAction label="File details" active={detailsOpen} onClick={() => setDetailsOpen((o) => !o)} className="hidden sm:grid">
            <Info className="h-4 w-4" />
          </IconAction>

          {/* More menu */}
          <div className="relative hidden sm:block">
            <IconAction label="More actions" active={moreOpen} onClick={() => setMoreOpen((o) => !o)} aria-haspopup="menu">
              <ChevronDown className="h-4 w-4" />
            </IconAction>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} aria-hidden />
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full z-20 mt-1.5 w-52 overflow-hidden rounded-xl border border-border/60 bg-surface-elevated p-1 shadow-lg"
                >
                  <MenuItem icon={<Download className="h-4 w-4" />} onClick={() => { setMoreOpen(false); download(); }}>Download</MenuItem>
                  <MenuItem icon={<Copy className="h-4 w-4" />} onClick={() => { setMoreOpen(false); void copyPath(); }}>
                    {copiedPath ? "Path copied!" : "Copy path"}
                  </MenuItem>
                  {onShare && (
                    <MenuItem icon={<Share2 className="h-4 w-4" />} onClick={() => { setMoreOpen(false); onShare(item); }}>Share</MenuItem>
                  )}
                  <MenuItem icon={<Info className="h-4 w-4" />} onClick={() => { setMoreOpen(false); setDetailsOpen(true); }}>File details</MenuItem>
                </motion.div>
              </>
            )}
          </div>

          <Sep />

          <IconAction label={fullscreen ? "Exit fullscreen (F11)" : "Fullscreen (F11)"}
            onClick={() => setFullscreen((f) => !f)} className="hidden sm:grid">
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </IconAction>
          <IconAction label="Close" onClick={tryClose}><X className="h-5 w-5" /></IconAction>
        </div>

        {/* File details popover */}
        {detailsOpen && (
          <DetailsPopover
        rootId={rootId}
            item={item}
            lines={lineCount}
            encoding="UTF-8"
            onClose={() => setDetailsOpen(false)}
          />
        )}
      </header>

      {/* ── ModeSwitcher (floating over the surface, top-right) ────── */}
      {canWrite !== false && !loading && !loadError && (
        <div className="pointer-events-none absolute right-4 top-[68px] z-20 md:right-6">
          <div
            role="tablist"
            aria-label="View mode"
            className="pointer-events-auto inline-flex items-center rounded-lg border border-border/60 bg-surface-muted/80 p-0.5 backdrop-blur-sm"
          >
            {(["preview", "edit"] as Mode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium capitalize transition-all duration-150",
                  mode === m ? "bg-accent text-white shadow-sm" : "text-content-muted hover:text-content"
                )}
              >
                {m === "preview" ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                {m === "preview" ? "Preview" : "Edit"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── DocumentSurface ────────────────────────────────────────── */}
      <div ref={surfaceRef} className="min-h-0 flex-1 overflow-hidden bg-surface-muted/25">
        {loading ? (
          <Center><Loader2 className="mb-3 h-7 w-7 animate-spin text-accent" /><p className="font-mono text-xs text-content-muted">Loading…</p></Center>
        ) : loadError ? (
          <Center>
            <AlertTriangle className="mb-3 h-8 w-8 text-danger/80" />
            <p className="text-sm font-medium text-danger">{loadError}</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => window.location.reload()}>Retry</Button>
          </Center>
        ) : mode === "edit" && canWrite !== false ? (
          <TextEditor
            value={content}
            onChange={(v) => { setContent(v); setSaveState("dirty"); }}
            language={lang}
            wrap={wrap}
            onWrapChange={setWrap}
            textareaRef={taRef}
            onCaret={(line, col) => setCaret({ line, col })}
          />
        ) : content.trim().length === 0 ? (
          <EmptyDoc name={item.name} />
        ) : (
          <TextPreview content={content} flavor={flavor} />
        )}
      </div>

      {/* ── DocumentStatusBar ──────────────────────────────────────── */}
      <footer className="flex h-7 shrink-0 items-center justify-between gap-3 overflow-hidden border-t border-border/50 bg-surface-elevated/60 px-4 font-mono text-[11px] text-content-muted">
        <div className="flex min-w-0 items-center gap-3">
          <SaveStateChip state={saveState} error={saveError} onRetry={() => void save()} />
          <span>UTF-8</span>
          <Dot />
          <span>{content.includes("\r\n") ? "CRLF" : "LF"}</span>
          <Dot />
          <span className="truncate">{langLabel}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {mode === "edit" && caret.line > 0 && (
            <span className="tabular-nums">Ln {caret.line}, Col {caret.col}</span>
          )}
          <span className="hidden sm:inline">{lineCount.toLocaleString()} ln</span>
          <span className="hidden sm:inline">{formatBytes(content.length)}</span>
        </div>
      </footer>

      {/* Dialogs */}
      <ConfirmDialog
        open={conflictOpen}
        title="File changed on disk"
        description="This file was modified since you opened it. Overwrite it with your version?"
        confirmLabel="Overwrite"
        danger
        loading={saveState === "saving"}
        onConfirm={() => { setConflictOpen(false); void save(true); }}
        onCancel={() => { setConflictOpen(false); }}
      />
      <ConfirmDialog
        open={closeConfirm}
        title="Discard unsaved changes?"
        description="You have unsaved edits that will be lost if you close now."
        confirmLabel="Discard changes"
        danger
        onConfirm={() => { setCloseConfirm(false); onClose(); }}
        onCancel={() => setCloseConfirm(false)}
      />
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function Sep() { return <span className="mx-0.5 h-5 w-px bg-border/50" aria-hidden />; }
function Dot() { return <span aria-hidden className="select-none opacity-40">•</span>; }

function IconAction({
  children, label, onClick, active, className,
}: {
  children: React.ReactNode; label: string; onClick: () => void; active?: boolean; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-content-muted transition-colors hover:bg-glass-bg hover:text-content focus-visible:ring-2 focus-visible:ring-accent/60",
        active && "bg-accent/15 text-accent",
        className
      )}
    >
      {children}
    </button>
  );
}

function MenuItem({ children, icon, onClick }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-sm text-content/90 transition-colors hover:bg-glass-bg-subtle hover:text-content"
    >
      <span className="text-content-muted">{icon}</span>
      {children}
    </button>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center p-8 text-center">{<div>{children}</div>}</div>;
}

function EmptyDoc({ name }: { name: string }) {
  return (
    <Center>
      <FileText className="mb-3 h-8 w-8 text-content-muted/40" />
      <p className="text-sm font-medium text-content-secondary">{name} is empty</p>
      <p className="mt-1 text-xs text-content-muted">Switch to Edit and start typing.</p>
    </Center>
  );
}

function SaveStateChip({ state, error, onRetry }: { state: SaveState; error: string | null; onRetry: () => void }) {
  if (state === "saving") {
    return <span className="flex items-center gap-1.5 text-info"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>;
  }
  if (state === "error") {
    return (
      <button onClick={onRetry} className="flex items-center gap-1.5 text-danger hover:underline" title={`${error} — click to retry`}>
        <AlertTriangle className="h-3 w-3" /> Save failed — retry
      </button>
    );
  }
  if (state === "dirty") {
    return <span className="flex items-center gap-1.5 text-warning"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" /> Unsaved changes</span>;
  }
  return (
    <span className="flex items-center gap-1.5 opacity-70">
      <Check className="h-3 w-3 text-success" /> Saved
    </span>
  );
}

function DetailsPopover({
  item, rootId, lines, encoding, onClose,
}: {
  item: FileItem; rootId: string; lines: number; encoding: string; onClose: () => void;
}) {
  const [stat, setStat] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    filesApi.stat(rootId, item.path).then((st: any) => alive && setStat(st)).catch(() => {});
    return () => { alive = false; };
  }, [rootId, item.path]);

  const rows: [string, React.ReactNode][] = [
    ["Name", item.name],
    ["Type", (item.extension || "txt").toUpperCase()],
    ["Size", formatBytes(stat?.size ?? item.size)],
    ["Location", `/${item.path}`],
    ["Lines", lines.toLocaleString()],
    ["Encoding", encoding],
    ...(stat?.modified ? [["Modified", formatDate(stat.modified)] as [string, React.ReactNode]] : []),
    ...(stat?.created_at ? [["Created", formatDate(stat.created_at)] as [string, React.ReactNode]] : []),
    ...(stat?.permissions ? [["Permissions", String(stat.permissions)] as [string, React.ReactNode]] : []),
  ];

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: -6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.16 }}
        role="dialog"
        aria-label="File details"
        className="absolute right-3 top-full z-20 mt-1 w-72 overflow-hidden rounded-xl border border-border/60 bg-surface-elevated p-3 shadow-lg"
      >
        <dl className="space-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-3 text-xs">
              <dt className="w-20 shrink-0 text-content-muted">{k}</dt>
              <dd className="min-w-0 flex-1 break-all text-content/90">{v}</dd>
            </div>
          ))}
        </dl>
      </motion.div>
    </>
  );
}

/* Local helpers removed — formatSize/formatDate now come from @nexora/core
   (re-exported via lib/format), the single source of truth shared with mobile. */

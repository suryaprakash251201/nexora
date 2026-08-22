import { useState, useEffect } from "react";
import {
  Upload, Download, X, CheckCircle2, AlertCircle, Clock, ChevronDown, ListX, ArrowDownToDot,
} from "lucide-react";
import { useTransfers, type Transfer } from "../store/transfers";
import { cancelTransfer, isCancellable, speedLabel } from "../lib/transfer";
import { formatBytes } from "../lib/format";

function pct(t: Transfer): number {
  if (t.total > 0) return Math.min(100, (t.loaded / t.total) * 100);
  return t.status === "done" ? 100 : 0;
}

function ProgressRing({ progress, active }: { progress: number; active: boolean }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <svg className="h-9 w-9 -rotate-90" viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3" className="stroke-surface-muted" />
      <circle
        cx="16" cy="16" r={r} fill="none" strokeWidth="3" strokeLinecap="round"
        className={active ? "stroke-accent" : "stroke-success"}
        strokeDasharray={c}
        strokeDashoffset={c - (c * progress) / 100}
        style={{ transition: "stroke-dashoffset 0.3s ease-out" }}
      />
    </svg>
  );
}

// Google Drive style transfer row: icon · filename · thin progress bar + % · speed · X (cancel/dismiss).
function Row({ t }: { t: Transfer }) {
  const remove = useTransfers((s) => s.remove);

  const progress = pct(t);
  const isQueued = t.status === "queued";
  const isDone = t.status === "done";
  const isError = t.status === "error";
  const finished = isDone || isError;
  const cancellable = !finished && isCancellable(t.id);

  const handleX = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cancellable) cancelTransfer(t.id);
    else remove(t.id);
  };

  return (
    <div
      className={`group relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 border transition-colors ${
        finished
          ? "bg-surface/35 border-border/25"
          : isQueued
            ? "bg-surface/35 border-border/30 opacity-75"
            : "bg-surface/50 border-accent/20 hover:border-accent/35"
      }`}
    >
      {/* Status icon */}
      <div
        className={`shrink-0 h-8 w-8 rounded-lg flex items-center justify-center ${
          isDone
            ? "bg-success/10 text-success"
            : isError
              ? "bg-danger/10 text-danger"
              : isQueued
                ? "bg-surface-muted text-content-muted"
                : "bg-accent/10 text-accent"
        }`}
      >
        {isDone ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : isError ? (
          <AlertCircle className="h-4 w-4" />
        ) : isQueued ? (
          <Clock className="h-4 w-4" />
        ) : t.kind === "upload" ? (
          <Upload className="h-4 w-4" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </div>

      {/* Filename + progress */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="flex-1 truncate text-xs font-medium text-content leading-tight">{t.name}</p>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-surface-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ease-out ${
                isError ? "bg-danger" : isDone ? "bg-success" : "bg-accent"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span
            className={`shrink-0 w-9 text-right text-[10px] font-mono tabular-nums ${
              isError ? "text-danger" : isDone ? "text-success" : isQueued ? "text-content-muted" : "text-content-muted"
            }`}
          >
            {isQueued ? "—" : isError ? "failed" : isDone ? "100%" : `${Math.round(progress)}%`}
          </span>
        </div>
        {/* Size transferred indicator: bytes moved so far / total size */}
        <div className="mt-1 flex items-center justify-between gap-2 min-w-0">
          <span className="shrink-0 text-[10px] font-mono text-content-muted tabular-nums">
            {isQueued ? formatBytes(t.total) : isDone ? formatBytes(t.total) : `${formatBytes(t.loaded)} / ${formatBytes(t.total)}`}
          </span>
          <span className="shrink-0 text-[10px] font-mono tabular-nums truncate min-w-0 flex-1 text-right">
            {isQueued ? (
              <span className="text-content-muted">Waiting…</span>
            ) : isDone ? (
              <span className="text-success">Completed</span>
            ) : isError ? (
              <span className="text-danger truncate" title={t.error}>{t.error || "Failed"}</span>
            ) : t.speed > 0 ? (
              <span className="text-accent">{speedLabel(t.speed)}</span>
            ) : (
              <span className="text-content-muted">…</span>
            )}
          </span>
        </div>
      </div>

      {/* Cancel / dismiss */}
      <button
        onClick={handleX}
        className="shrink-0 p-1 rounded-md text-content-muted opacity-60 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger hover:bg-danger/10 transition-all"
        title={cancellable ? `Cancel ${t.name}` : `Dismiss ${t.name}`}
        aria-label={cancellable ? `Cancel ${t.name}` : `Dismiss ${t.name}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function TransfersPanel() {
  const transfers = useTransfers((s) => s.transfers);
  const clearFinished = useTransfers((s) => s.clearFinished);
  const [open, setOpen] = useState(false);

  const active = transfers.filter((t) => t.status === "active" || t.status === "paused").length;
  const queued = transfers.filter((t) => t.status === "queued").length;
  const finished = transfers.filter((t) => t.status === "done" || t.status === "error").length;
  const allDone = active === 0;

  // Auto-open when new transfers are added or start moving.
  useEffect(() => {
    if (transfers.length > 0 && transfers.some((t) => t.status === "active")) {
      setOpen(true);
    }
  }, [transfers.length]);

  // Once everything finishes, reveal the panel (in case it was minimized).
  useEffect(() => {
    if (allDone && transfers.length > 0) setOpen(true);
  }, [allDone, transfers.length]);

  if (transfers.length === 0) return null;

  const totalLoaded = transfers
    .filter((t) => t.status === "active")
    .reduce((acc, t) => acc + t.loaded, 0);
  const totalSize = transfers
    .filter((t) => t.status === "active")
    .reduce((acc, t) => acc + t.total, 0);
  const overallProgress = totalSize > 0 ? Math.min(100, (totalLoaded / totalSize) * 100) : 0;

  // Newest transfer first (top of the list).
  const visible = [...transfers].reverse();

  const title =
    active > 0
      ? `${active} Active Transfer${active !== 1 ? "s" : ""}${queued > 0 ? ` · ${queued} queued` : ""}`
      : queued > 0
        ? "Starting…"
        : "Transfers Completed";

  // Minimized: a compact circular pill with an aggregate progress ring (Google Drive style).
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[var(--z-transfers)] h-11 w-11 rounded-full glass-strong transfers-glow shadow-2xl border border-border/50 flex items-center justify-center animate-scale-in cursor-pointer"
        title="Show transfers"
        aria-label="Show transfers"
      >
        <ProgressRing progress={overallProgress} active={active > 0} />
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {active > 0 ? (
            <Upload className="h-4 w-4 text-accent" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
        </span>
        {queued + active > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center shadow">
            {active + queued}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      aria-live="polite"
      aria-label="File transfers"
      className="fixed bottom-4 right-4 z-[var(--z-transfers)] w-72 sm:w-80 glass-strong transfers-glow transfers-panel rounded-2xl shadow-2xl border border-border/50 overflow-hidden flex flex-col transition-all duration-300 ease-in-out animate-scale-in"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-surface/50 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative shrink-0">
            {allDone ? (
              <div className="p-1.5 rounded-md bg-success/10 text-success">
                <ArrowDownToDot className="h-4 w-4" />
              </div>
            ) : (
              <div className="p-1.5 rounded-md bg-accent/10 text-accent relative">
                <Upload className="h-4 w-4" />
                <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-accent animate-ping" />
                <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-accent" />
              </div>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold text-content leading-tight truncate">
              Transfers{transfers.length > 0 ? ` · ${transfers.length}` : ""}
            </span>
            <span className="text-[10px] text-content-muted leading-tight truncate">{title}</span>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-md text-content-muted hover:text-danger hover:bg-danger/10 transition-colors"
            title="Minimize to pill"
            aria-label="Minimize transfer panel to pill"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scrollable Google Drive style list */}
      <div
        className="transfer-scroll overflow-y-auto bg-surface/30 backdrop-blur-sm p-1.5 flex flex-col gap-1.5"
        style={{ maxHeight: "min(55vh, 24rem)" }}
      >
        {visible.map((t) => (
          <Row key={t.id} t={t} />
        ))}
      </div>

      {/* Footer: clear finished */}
      {finished > 0 && (
        <button
          onClick={clearFinished}
          className="shrink-0 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold text-content-muted hover:text-content hover:bg-surface/60 border-t border-border/40 transition-colors"
        >
          <ListX className="h-3 w-3" />
          Clear {finished} finished transfer{finished !== 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}
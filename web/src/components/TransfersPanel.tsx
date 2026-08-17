import { useState, useEffect } from "react";
import { Upload, Download, X, CheckCircle2, AlertCircle, Clock, ChevronsLeftRight, Grip } from "lucide-react";
import { useTransfers, type Transfer } from "../store/transfers";
import { cancelTransfer, isCancellable, speedLabel } from "../lib/transfer";

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

// Compact transfer chip — one per file, single X to cancel/dismiss.
function Chip({ t }: { t: Transfer }) {
  const remove = useTransfers((s) => s.remove);

  const progress = pct(t);
  const isQueued = t.status === "queued";
  const isDone = t.status === "done";
  const isError = t.status === "error";
  const isActive = t.status === "active";
  const finished = isDone || isError;
  const cancellable = !finished && isCancellable(t.id);

  const handleX = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cancellable) cancelTransfer(t.id);
    else remove(t.id);
  };

  return (
    <div
      className={`shrink-0 w-44 p-1.5 pr-2 rounded-xl border bg-surface/70 backdrop-blur-sm flex items-center gap-1.5 transition-colors ${
        finished ? "border-border/30" : isQueued ? "border-border/40 opacity-70" : "border-accent/25"
      }`}
    >
      <div className={`shrink-0 p-1 rounded-lg ${
        isDone ? 'bg-success/10 text-success' :
        isError ? 'bg-danger/10 text-danger' :
        isQueued ? 'bg-surface-muted text-content-muted' :
        t.kind === "upload" ? 'bg-accent/10 text-accent' : 'bg-accent/10 text-accent'
      }`}>
        {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> :
         isError ? <AlertCircle className="h-3.5 w-3.5" /> :
         isQueued ? <Clock className="h-3.5 w-3.5" /> :
         t.kind === "upload" ? <Upload className="h-3.5 w-3.5" /> :
         <Download className="h-3.5 w-3.5" />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-content truncate leading-tight pr-0.5">{t.name}</p>
        {isQueued ? (
          <p className="text-[9px] text-content-muted font-mono">Waiting…</p>
        ) : isDone ? (
          <p className="text-[9px] text-success font-mono">Completed</p>
        ) : isError ? (
          <p className="text-[9px] text-danger font-mono truncate">{t.error || "Failed"}</p>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1 rounded-full bg-surface-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ease-out ${
                  isError ? "bg-danger" : isDone ? "bg-success" : "bg-accent"
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            {isActive && t.speed > 0 && (
              <span className="text-[9px] font-mono text-accent shrink-0">
                {speedLabel(t.speed)}
              </span>
            )}
          </div>
        )}
      </div>

      <button
        onClick={handleX}
        className="shrink-0 p-0.5 rounded-md text-content-muted hover:text-danger hover:bg-danger/10 transition-colors"
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
  const [open, setOpen] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  const active = transfers.filter((t) => t.status === "active" || t.status === "paused").length;
  const queued = transfers.filter((t) => t.status === "queued").length;
  const allDone = active === 0;

  // Auto-open when new transfers are added.
  useEffect(() => {
    if (transfers.length > 0 && transfers.some(t => t.status === 'active')) {
      setOpen(true);
    }
  }, [transfers.length]);

  // Once everything finishes, reveal the panel (in case it was minimized).
  useEffect(() => {
    if (allDone && transfers.length > 0) setOpen(true);
  }, [allDone, transfers.length]);

  if (transfers.length === 0) return null;

  const totalLoaded = transfers.filter(t => t.status === 'active').reduce((acc, t) => acc + t.loaded, 0);
  const totalSize = transfers.filter(t => t.status === 'active').reduce((acc, t) => acc + t.total, 0);
  const overallProgress = totalSize > 0 ? Math.min(100, (totalLoaded / totalSize) * 100) : 0;

  // Newest transfer first (left edge of the scroll row).
  const visible = [...transfers].reverse();

  const title = active > 0
    ? `${active} Active Transfer${active !== 1 ? 's' : ''}${queued > 0 ? ` · ${queued} queued` : ''}`
    : queued > 0
      ? "Starting…"
      : "Transfers Completed";

  // Minimized: a compact circular pill with a progress ring.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[65] h-11 w-11 rounded-full glass-strong transfers-glow shadow-2xl border border-border/50 flex items-center justify-center animate-scale-in cursor-pointer"
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
      </button>
    );
  }

  return (
    <div
      aria-live="polite"
      aria-label="File transfers"
      className={`fixed z-[65] bottom-4 right-4 w-72 sm:w-80 glass-strong transfers-glow transfers-panel rounded-2xl shadow-2xl border border-border/50 overflow-hidden relative transition-all duration-300 ease-in-out`}
    >
      {/* Mini bar header */}
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-border/50 bg-surface/50 backdrop-blur-md h-9">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative shrink-0">
            {active > 0 ? (
              <div className="p-1 rounded-md bg-accent/10 text-accent relative">
                <Upload className="h-3.5 w-3.5" />
                <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-accent animate-ping" />
                <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-accent" />
              </div>
            ) : (
              <div className="p-1 rounded-md bg-surface text-content-muted">
                <CheckCircle2 className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold text-content leading-tight truncate">
              {title}
            </span>
            {active > 0 && (
              <div className="w-20 h-0.5 mt-0.5 bg-surface-muted rounded-full overflow-hidden">
                <div className="h-full bg-accent transition-all duration-300" style={{ width: `${overallProgress}%` }} />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setIsExpanded((e) => !e)}
            className="p-1 rounded-md text-content-muted hover:text-content hover:bg-surface transition-colors"
            title={isExpanded ? "Collapse" : "Expand"}
            aria-label={isExpanded ? "Collapse transfer bar" : "Expand transfer bar"}
          >
            <ChevronsLeftRight className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded-md text-content-muted hover:text-content hover:bg-surface transition-colors"
            title="Minimize to pill"
            aria-label="Minimize to pill"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable transfer chips */}
      <div className={`bg-surface/30 backdrop-blur-sm transition-all duration-300 ease-in-out ${
        isExpanded ? "grid grid-cols-2 gap-1.5 p-1.5 max-h-[60vh] overflow-y-auto" : "flex gap-1.5 p-1.5 overflow-x-auto hide-scrollbar"
      }`}>
        {isExpanded
          ? visible.map((t) => <Chip key={t.id} t={t} />)
          : (
            <>
              <div className="relative flex items-center gap-2 pr-2 shrink-0 text-content-muted">
                <Grip className="h-3.5 w-3.5 opacity-60" />
                <span className="text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap">
                  {transfers.length}
                </span>
              </div>
              {visible.map((t) => <Chip key={t.id} t={t} />)}
            </>
          )}
      </div>
    </div>
  );
}
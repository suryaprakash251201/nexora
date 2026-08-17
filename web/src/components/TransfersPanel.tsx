import { useState, useEffect } from "react";
import { Upload, Download, X, CheckCircle2, AlertCircle, Clock, Maximize2, Minimize2, Activity } from "lucide-react";
import { useTransfers, type Transfer } from "../store/transfers";
import { cancelTransfer, isCancellable, speedLabel } from "../lib/transfer";
import { formatBytes } from "../lib/format";

function pct(t: Transfer): number {
  if (t.total > 0) return Math.min(100, (t.loaded / t.total) * 100);
  return t.status === "done" ? 100 : 0;
}

function ProgressRing({ progress, active }: { progress: number; active: boolean }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg className="h-11 w-11 -rotate-90" viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r={r} fill="none" strokeWidth="3.5" className="stroke-surface-muted" />
      <circle
        cx="20" cy="20" r={r} fill="none" strokeWidth="3.5" strokeLinecap="round"
        className={active ? "stroke-accent" : "stroke-success"}
        strokeDasharray={c}
        strokeDashoffset={c - (c * progress) / 100}
        style={{ transition: "stroke-dashoffset 0.3s ease-out" }}
      />
    </svg>
  );
}

function Row({ t }: { t: Transfer }) {
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
    <div className={`p-3 border-b border-border/30 last:border-0 transition-colors ${isQueued ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        {/* Icon based on status and kind */}
        <div className={`mt-0.5 p-1.5 rounded-lg shrink-0 ${
          isDone ? 'bg-success/10 text-success' :
          isError ? 'bg-danger/10 text-danger' :
          isQueued ? 'bg-surface-muted/50 text-content-muted' :
          'bg-accent/10 text-accent'
        }`}>
          {isDone ? <CheckCircle2 className="h-4 w-4" /> :
           isError ? <AlertCircle className="h-4 w-4" /> :
           isQueued ? <Clock className="h-4 w-4" /> :
           t.kind === "upload" ? <Upload className="h-4 w-4" /> :
           <Download className="h-4 w-4" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-content truncate pr-2">{t.name}</span>
            {/* Single X: cancels while active/queued, dismisses when finished */}
            <button
              onClick={handleX}
              className="p-1 rounded-md text-content-muted hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
              title={cancellable ? `Cancel ${t.name}` : `Dismiss ${t.name}`}
              aria-label={cancellable ? `Cancel ${t.name}` : `Dismiss ${t.name}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex justify-between items-center text-[10px] text-content-muted font-mono mb-1.5">
            <span>
              {isError ? (t.error || "Failed") :
               isDone ? "Completed" :
               isQueued ? "Waiting…" :
               `${formatBytes(t.loaded)} / ${formatBytes(t.total)}`}
            </span>
            {isActive && t.speed > 0 && (
              <span className="flex items-center gap-1 text-accent">
                <Activity className="h-3 w-3" />
                {speedLabel(t.speed)}
              </span>
            )}
          </div>

          {/* Progress Bar */}
          {!isQueued && (
            <div className="relative h-1.5 rounded-full bg-surface-muted overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 transition-all duration-300 ease-out ${
                  isError ? "bg-danger" :
                  isDone ? "bg-success" :
                  "bg-accent"
                }`}
                style={{ width: `${progress}%` }}
              />
              {isActive && (
                <div className="absolute inset-0 bg-white/20 animate-pulse" style={{ width: `${progress}%` }} />
              )}
            </div>
          )}
        </div>
      </div>
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

  // Auto-open when new transfers are added
  useEffect(() => {
    if (transfers.length > 0 && transfers.some(t => t.status === 'active')) {
      setOpen(true);
    }
  }, [transfers.length]);

  // Once everything finishes, reveal the panel (in case it was minimized) so
  // the user sees the result; it still auto-dismisses after 30s.
  useEffect(() => {
    if (allDone && transfers.length > 0) setOpen(true);
  }, [allDone, transfers.length]);

  if (transfers.length === 0) return null;

  const totalLoaded = transfers.filter(t => t.status === 'active').reduce((acc, t) => acc + t.loaded, 0);
  const totalSize = transfers.filter(t => t.status === 'active').reduce((acc, t) => acc + t.total, 0);
  const overallProgress = totalSize > 0 ? Math.min(100, (totalLoaded / totalSize) * 100) : 0;

  // Newest transfer on top
  const visible = [...transfers].reverse();

  // Minimized: a compact circular pill with a progress ring.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[65] h-12 w-12 rounded-full glass-strong transfers-glow shadow-2xl border border-border/50 flex items-center justify-center animate-scale-in cursor-pointer"
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
    <div aria-live="polite" aria-label="File transfers" className={`fixed z-[65] transition-all duration-300 ease-in-out glass-strong transfers-glow transfers-panel rounded-2xl shadow-2xl border border-border/50 overflow-hidden relative
      ${isExpanded
        ? "bottom-4 right-4 max-w-[calc(100vw-2rem)] sm:w-96 max-h-[80vh] flex flex-col"
        : "bottom-4 right-4 max-w-[calc(100vw-2rem)] sm:w-80"}`}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 border-b border-border/50 bg-surface/50 backdrop-blur-md cursor-pointer hover:bg-surface/70 transition-colors"
        title={isExpanded ? "Minimize" : "Maximize"}
        onClick={() => setIsExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            {active > 0 ? (
              <div className="p-1.5 rounded-lg bg-accent/10 text-accent relative">
                <Upload className="h-4 w-4" />
                <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-accent animate-ping" />
                <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-accent" />
              </div>
            ) : (
              <div className="p-1.5 rounded-lg bg-surface text-content-muted">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-content leading-tight">
              {active > 0
                ? `${active} Active Transfer${active !== 1 ? 's' : ''}${queued > 0 ? ` · ${queued} queued` : ''}`
                : queued > 0
                  ? "Starting…"
                  : "Transfers Completed"}
            </span>
            {active > 0 && (
              <div className="w-24 h-1 mt-1 bg-surface-muted rounded-full overflow-hidden">
                <div className="h-full bg-accent transition-all duration-300" style={{ width: `${overallProgress}%` }} />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-md text-content-muted hover:text-content hover:bg-surface transition-colors hidden sm:block"
            title={isExpanded ? "Minimize" : "Maximize"}
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-md text-content-muted hover:text-content hover:bg-surface transition-colors"
            title="Minimize to pill"
            aria-label="Minimize to pill"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Transfer List */}
      <div
        className={`bg-surface/30 backdrop-blur-sm transition-all duration-300 ease-in-out ${
          isExpanded ? "flex-1 overflow-y-auto max-h-[60vh]" : "max-h-64 sm:max-h-72 overflow-y-auto"
        }`}
      >
        <div className="divide-y divide-border/20">
          {visible.map((t) => <Row key={t.id} t={t} />)}
        </div>
      </div>
    </div>
  );
}

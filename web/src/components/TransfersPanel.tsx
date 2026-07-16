import { useState, useEffect } from "react";
import { Upload, Download, X, CheckCircle2, AlertCircle, Trash2, Maximize2, Minimize2, Activity, Play, Pause } from "lucide-react";
import { useTransfers, type Transfer } from "../store/transfers";
import { speedLabel } from "../lib/transfer";

function pct(t: Transfer): number {
  if (t.total > 0) return Math.min(100, (t.loaded / t.total) * 100);
  return t.status === "done" ? 100 : 0;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function Row({ t }: { t: Transfer }) {
  const remove = useTransfers((s) => s.remove);
  
  const progress = pct(t);
  const isDone = t.status === "done";
  const isError = t.status === "error";
  const isActive = t.status === "active";
  
  return (
    <div className="p-3 border-b border-border/30 last:border-0 hover:bg-surface/30 transition-colors group">
      <div className="flex items-start gap-3">
        {/* Icon based on status and kind */}
        <div className={`mt-0.5 p-1.5 rounded-lg shrink-0 ${
          isDone ? 'bg-success/10 text-success' : 
          isError ? 'bg-danger/10 text-danger' : 
          'bg-accent/10 text-accent'
        }`}>
          {isDone ? <CheckCircle2 className="h-4 w-4" /> :
           isError ? <AlertCircle className="h-4 w-4" /> :
           t.kind === "upload" ? <Upload className="h-4 w-4" /> : 
           <Download className="h-4 w-4" />}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-content truncate pr-2">{t.name}</span>
            <button 
              onClick={() => remove(t.id)} 
              className="p-1 rounded-md text-content-muted hover:text-content hover:bg-surface opacity-0 group-hover:opacity-100 transition-opacity shrink-0" 
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          
          <div className="flex justify-between items-center text-[10px] text-content-muted font-mono mb-1.5">
            <span>
              {isError ? (t.error || "Failed") : 
               isDone ? "Completed" : 
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
        </div>
      </div>
    </div>
  );
}

export default function TransfersPanel() {
  const transfers = useTransfers((s) => s.transfers);
  const clearFinished = useTransfers((s) => s.clearFinished);
  const [open, setOpen] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-open when new transfers are added
  useEffect(() => {
    if (transfers.length > 0 && transfers.some(t => t.status === 'active')) {
      setOpen(true);
    }
  }, [transfers.length]);

  if (transfers.length === 0) return null;
  
  const active = transfers.filter((t) => t.status === "active").length;
  const done = transfers.filter((t) => t.status === "done").length;
  const totalLoaded = transfers.filter(t => t.status === 'active').reduce((acc, t) => acc + t.loaded, 0);
  const totalSize = transfers.filter(t => t.status === 'active').reduce((acc, t) => acc + t.total, 0);
  const overallProgress = totalSize > 0 ? Math.min(100, (totalLoaded / totalSize) * 100) : 0;

  return (
    <div className={`fixed z-[65] transition-all duration-300 ease-in-out glass-strong rounded-2xl shadow-2xl border border-border/50 overflow-hidden
      ${isExpanded 
        ? "bottom-4 right-4 w-96 max-w-[calc(100vw-2rem)] max-h-[80vh] flex flex-col" 
        : "bottom-4 right-4 w-80 max-w-[calc(100vw-2rem)]"}`}
    >
      {/* Header */}
      <div 
        className="flex items-center justify-between p-3 border-b border-border/50 bg-surface/50 backdrop-blur-md cursor-pointer hover:bg-surface/70 transition-colors"
        onClick={() => setOpen((o) => !o)}
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
              {active > 0 ? `${active} Active Transfer${active !== 1 ? 's' : ''}` : 'Transfers Completed'}
            </span>
            {active > 0 && (
              <div className="w-24 h-1 mt-1 bg-surface-muted rounded-full overflow-hidden">
                <div className="h-full bg-accent transition-all duration-300" style={{ width: `${overallProgress}%` }} />
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {done > 0 && (
            <button 
              onClick={clearFinished} 
              className="p-1.5 rounded-md text-content-muted hover:text-content hover:bg-surface transition-colors" 
              title="Clear Completed"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          
          {open && (
            <button 
              onClick={() => setIsExpanded(!isExpanded)} 
              className="p-1.5 rounded-md text-content-muted hover:text-content hover:bg-surface transition-colors hidden sm:block" 
              title={isExpanded ? "Minimize" : "Maximize"}
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}
          
          <button 
            onClick={() => setOpen((o) => !o)} 
            className={`p-1.5 rounded-md text-content-muted hover:text-content hover:bg-surface transition-all ${open ? "rotate-180" : ""}`} 
            title={open ? "Collapse" : "Expand"}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Transfer List */}
      <div 
        className={`bg-surface/30 backdrop-blur-sm transition-all duration-300 ease-in-out overflow-hidden
          ${open ? (isExpanded ? "flex-1 overflow-auto max-h-[60vh]" : "max-h-72 overflow-auto") : "max-h-0"}`}
      >
        <div className="custom-scrollbar">
          {transfers.map((t) => <Row key={t.id} t={t} />)}
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Upload, Download, X, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";
import { useTransfers, type Transfer } from "../store/transfers";
import { speedLabel } from "../lib/transfer";

function pct(t: Transfer): number {
  if (t.total > 0) return Math.min(100, (t.loaded / t.total) * 100);
  return t.status === "done" ? 100 : 0;
}

function Row({ t }: { t: Transfer }) {
  const update = useTransfers((s) => s.update);
  const remove = useTransfers((s) => s.remove);
  return (
    <div className="px-3 py-2 border-b glass-divider last:border-0">
      <div className="flex items-center gap-2 text-sm">
        {t.kind === "upload" ? <Upload className="h-4 w-4 text-accent" /> : <Download className="h-4 w-4 text-accent" />}
        <span className="flex-1 truncate">{t.name}</span>
        {t.status === "done" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {t.status === "error" && <AlertCircle className="h-4 w-4 text-red-500" />}
        <button onClick={() => remove(t.id)} className="p-1 rounded glass-hover" title="Dismiss"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="mt-1 relative h-1.5 rounded-full bg-white/15 overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${t.status === "error" ? "bg-red-500" : "bg-accent"}`}
          style={{ width: `${pct(t)}%` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] text-content-muted">
        <span>{t.status === "error" ? (t.error || "Failed") : t.status === "done" ? "Completed" : `${(t.loaded / (1 << 20)).toFixed(1)} MB`}</span>
        {t.status === "active" && t.speed > 0 && <span>{speedLabel(t.speed)}</span>}
      </div>
    </div>
  );
}

export default function TransfersPanel() {
  const transfers = useTransfers((s) => s.transfers);
  const clearFinished = useTransfers((s) => s.clearFinished);
  const [open, setOpen] = useState(true);

  if (transfers.length === 0) return null;
  const active = transfers.filter((t) => t.status === "active").length;

  return (
    <div className="fixed bottom-4 right-4 z-[65] w-80 max-w-[calc(100vw-2rem)] glass-strong rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b glass-divider">
        <button className="flex items-center gap-2 text-sm font-medium" onClick={() => setOpen((o) => !o)}>
          {active > 0 ? <Upload className="h-4 w-4 animate-pulse text-accent" /> : <Download className="h-4 w-4 text-accent" />}
          Transfers {active > 0 && <span className="text-xs text-content-muted">({active})</span>}
        </button>
        <div className="flex items-center gap-1">
          <button onClick={clearFinished} className="p-1 rounded glass-hover" title="Clear completed"><Trash2 className="h-3.5 w-3.5" /></button>
          <button onClick={() => setOpen((o) => !o)} className="p-1 rounded glass-hover" title={open ? "Collapse" : "Expand"}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {open && (
        <div className="max-h-72 overflow-auto">
          {transfers.map((t) => <Row key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}

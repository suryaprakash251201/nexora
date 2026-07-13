import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2, Link2, ExternalLink } from "lucide-react";
import { get, del } from "../api/client";
import { useUI } from "../store";
import { formatDate } from "../lib/format";
import type { ShareItem } from "../api/types";

export default function SharesPanel() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const { data, isLoading } = useQuery({ queryKey: ["shares"], queryFn: () => get<{ items: ShareItem[] }>("/shares") });

  const revoke = async (id: string) => {
    if (!confirm("Revoke this share link? It will stop working immediately.")) return;
    try {
      await del(`/shares/${id}`);
      pushToast("success", "Share revoked");
      qc.invalidateQueries({ queryKey: ["shares"] });
    } catch (e: any) {
      pushToast("error", e.message);
    }
  };

  const items = data?.items || [];

  return (
    <div className="flex-1 overflow-auto p-4">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Link2 className="h-5 w-5" /> Shared links</h2>
      {isLoading && <p className="text-content-muted">Loading…</p>}
      {!isLoading && items.length === 0 && <p className="text-content-muted p-6 text-center">You have no active share links.</p>}
      <div className="space-y-2">
        {items.map((s) => (
          <div key={s.id} className="border rounded-lg p-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{s.name}</p>
              <p className="text-xs text-content-muted truncate">{s.path}</p>
              <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-content-muted">
                <span className="px-1.5 py-0.5 rounded bg-surface-muted">{s.scope}</span>
                {s.has_password && <span className="px-1.5 py-0.5 rounded bg-surface-muted">password</span>}
                <span className="px-1.5 py-0.5 rounded bg-surface-muted">{s.expires_at ? `expires ${formatDate(s.expires_at)}` : "no expiry"}</span>
                <span className="px-1.5 py-0.5 rounded bg-surface-muted">{s.download_count}{s.max_downloads ? `/${s.max_downloads}` : ""} downloads</span>
              </div>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(s.url); pushToast("success", "Link copied"); }} className="p-2 rounded-lg hover:bg-surface-muted" title="Copy link"><Copy className="h-4 w-4" /></button>
            <a href={s.url} target="_blank" rel="noreferrer" className="p-2 rounded-lg hover:bg-surface-muted" title="Open"><ExternalLink className="h-4 w-4" /></a>
            <button onClick={() => revoke(s.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-red-500" title="Revoke"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

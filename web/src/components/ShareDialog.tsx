import { useState } from "react";
import { Copy, Check, Link2, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { post } from "../api/client";
import { useUI } from "../store";
import type { FileItem, ShareItem } from "../api/types";

export default function ShareDialog({ item, rootId, onClose }: { item: FileItem; rootId: string; onClose: () => void }) {
  const pushToast = useUI((s) => s.pushToast);
  const [scope, setScope] = useState<"download" | "preview">("preview");
  const [password, setPassword] = useState("");
  const [expiresHours, setExpiresHours] = useState<number>(0);
  const [maxDownloads, setMaxDownloads] = useState<number>(0);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<ShareItem | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      const res = await post<{ share: ShareItem }>("/shares", {
        root: rootId,
        path: item.path,
        scope,
        password: password || undefined,
        expires_in_hours: expiresHours,
        max_downloads: maxDownloads,
      });
      setResult(res.share);
    } catch (e: any) {
      pushToast("error", e.message || "Could not create share");
    } finally {
      setCreating(false);
    }
  };

  const copy = () => {
    if (result) {
      navigator.clipboard.writeText(result.url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  };

  return (
    <Modal
      title={result ? "Share link created" : `Share "${item.name}"`}
      onClose={onClose}
      footer={
        result ? (
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg accent-glass text-sm">Done</button>
        ) : (
          <button onClick={create} disabled={creating} className="flex items-center gap-1 px-3 py-1.5 rounded-lg accent-glass text-sm disabled:opacity-50">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Create link
          </button>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input readOnly value={result.url} className="flex-1 rounded-lg bg-surface border px-3 py-2 text-sm font-mono" />
              <button onClick={copy} className="p-2 rounded-lg border glass-hover" title="Copy link">
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <ul className="text-sm text-content-muted space-y-1">
            <li>Scope: <span className="text-content">{result.scope === "preview" ? "Preview + download" : "Download only"}</span></li>
            <li>Password: <span className="text-content">{result.has_password ? "Protected" : "None"}</span></li>
            <li>Expires: <span className="text-content">{result.expires_at ? new Date(result.expires_at).toLocaleString() : "Never"}</span></li>
            <li>Max downloads: <span className="text-content">{result.max_downloads || "Unlimited"}</span></li>
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Access scope</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as any)} className="w-full rounded-lg bg-surface border px-3 py-2 outline-none">
              <option value="preview">Preview + download</option>
              <option value="download">Download only</option>
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Password (optional)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave empty for no password" className="w-full rounded-lg bg-surface border px-3 py-2 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Expires in (hours)</label>
              <input type="number" min={0} value={expiresHours} onChange={(e) => setExpiresHours(Number(e.target.value))} placeholder="0 = never" className="w-full rounded-lg bg-surface border px-3 py-2 outline-none" />
            </div>
            <div>
              <label className="block text-sm mb-1">Max downloads</label>
              <input type="number" min={0} value={maxDownloads} onChange={(e) => setMaxDownloads(Number(e.target.value))} placeholder="0 = unlimited" className="w-full rounded-lg bg-surface border px-3 py-2 outline-none" />
            </div>
          </div>
          <p className="text-xs text-content-muted">Folder shares are listed but only files can be downloaded directly.</p>
        </div>
      )}
    </Modal>
  );
}

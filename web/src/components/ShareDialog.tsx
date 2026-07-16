import { useState } from "react";
import { Copy, Check, Link2, Globe, Shield, Clock, Download, Share2 } from "lucide-react";
import { Modal } from "./Modal";
import { post } from "../api/client";
import { useUI } from "../store";
import type { FileItem, ShareItem } from "../api/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

export default function ShareDialog({ item, rootId, onClose }: { item: FileItem; rootId: string; onClose: () => void }) {
  const pushToast = useUI((s) => s.pushToast);
  const [scope, setScope] = useState<"download" | "preview">("preview");
  const [password, setPassword] = useState("");
  const [expiresHours, setExpiresHours] = useState<string>("");
  const [maxDownloads, setMaxDownloads] = useState<string>("");
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
        expires_in_hours: expiresHours ? Number(expiresHours) : 0,
        max_downloads: maxDownloads ? Number(maxDownloads) : 0,
      });
      setResult(res.share);
      pushToast("success", "Share link created successfully");
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
        pushToast("success", "Link copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <Modal
      title={result ? "Share Link Ready" : "Share File"}
      description={result ? "Anyone with this link can access the file based on your settings." : `Create a secure sharing link for "${item.name}"`}
      onClose={onClose}
      icon={<Share2 className="h-5 w-5 text-accent" />}
      footer={
        <div className="flex justify-end gap-3 w-full">
          {result ? (
            <Button variant="primary" onClick={onClose} className="w-full">Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button 
                variant="primary" 
                onClick={create} 
                loading={creating} 
                icon={!creating && <Link2 className="h-4 w-4" />}
              >
                Create Link
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="py-2">
        {result ? (
          <div className="space-y-6 animate-scale-in">
            <div className="flex items-center gap-2 bg-surface/50 p-1.5 rounded-xl border border-border/50 backdrop-blur-md">
              <input 
                readOnly 
                value={result.url} 
                className="flex-1 bg-transparent px-3 py-2 text-sm font-mono outline-none text-content truncate" 
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button 
                variant={copied ? "primary" : "secondary"} 
                onClick={copy}
                className="shrink-0"
                icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            
            <div className="bg-surface/30 rounded-xl border border-border/50 p-4 space-y-4">
              <h4 className="text-xs font-bold text-content-muted uppercase tracking-wider mb-2">Share Settings</h4>
              <ul className="text-sm space-y-3">
                <li className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-content-muted"><Globe className="h-4 w-4" /> Scope</span>
                  <span className="font-medium text-content">{result.scope === "preview" ? "Preview + Download" : "Download Only"}</span>
                </li>
                <li className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-content-muted"><Shield className="h-4 w-4" /> Access</span>
                  <span className={`font-medium ${result.has_password ? "text-warning" : "text-success"}`}>
                    {result.has_password ? "Password Protected" : "Public Link"}
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-content-muted"><Clock className="h-4 w-4" /> Expires</span>
                  <span className="font-medium text-content">{result.expires_at ? new Date(result.expires_at).toLocaleString() : "Never"}</span>
                </li>
                <li className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-content-muted"><Download className="h-4 w-4" /> Downloads</span>
                  <span className="font-medium text-content">{result.max_downloads ? `${result.max_downloads} maximum` : "Unlimited"}</span>
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-content-muted uppercase tracking-wider">Access Scope</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setScope("preview")}
                  className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all duration-200
                    ${scope === "preview" 
                      ? "bg-accent/10 border-accent/30 text-accent shadow-sm" 
                      : "bg-surface border-border/50 text-content-muted hover:text-content hover:bg-surface-muted"}`}
                >
                  <Globe className="h-5 w-5" />
                  <span className="text-xs font-medium text-center">Preview & Download</span>
                </button>
                <button
                  type="button"
                  onClick={() => setScope("download")}
                  className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all duration-200
                    ${scope === "download" 
                      ? "bg-accent/10 border-accent/30 text-accent shadow-sm" 
                      : "bg-surface border-border/50 text-content-muted hover:text-content hover:bg-surface-muted"}`}
                >
                  <Download className="h-5 w-5" />
                  <span className="text-xs font-medium text-center">Download Only</span>
                </button>
              </div>
            </div>
            
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-content-muted uppercase tracking-wider flex justify-between">
                Password <span className="opacity-50 font-normal normal-case">Optional</span>
              </label>
              <Input 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                placeholder="Leave empty for public access" 
                icon={<Shield className="h-4 w-4" />}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-content-muted uppercase tracking-wider flex justify-between">
                  Expires In <span className="opacity-50 font-normal normal-case">Hours</span>
                </label>
                <Input 
                  type="number" 
                  min={0} 
                  value={expiresHours} 
                  onChange={(e) => setExpiresHours(e.target.value)} 
                  placeholder="0 = Never" 
                  icon={<Clock className="h-4 w-4" />}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-content-muted uppercase tracking-wider flex justify-between">
                  Downloads <span className="opacity-50 font-normal normal-case">Max</span>
                </label>
                <Input 
                  type="number" 
                  min={0} 
                  value={maxDownloads} 
                  onChange={(e) => setMaxDownloads(e.target.value)} 
                  placeholder="0 = Unlimited" 
                  icon={<Download className="h-4 w-4" />}
                />
              </div>
            </div>
            
            <div className="p-3 rounded-lg bg-accent/5 border border-accent/10 flex gap-3 mt-2">
              <div className="mt-0.5 text-accent"><Share2 className="h-4 w-4" /></div>
              <p className="text-xs text-content-muted">
                Folder shares will be listed but only files can be downloaded directly. Ensure you grant appropriate permissions.
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

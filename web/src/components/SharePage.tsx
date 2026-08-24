import { useEffect, useState } from "react";
import { Download, Lock, FileWarning, Eye, AlertCircle, FileIcon, Folder, FolderOpen, Music, FileText, Film, Image as ImageIcon, Archive, Package } from "lucide-react";
import type { SharePublicEntry, SharePublicInfo } from "../api/types";
import { previewKind, codeLanguage } from "../lib/preview";
import { isTauri as isTauriRuntime } from "../lib/desktop";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { formatBytes } from "../lib/format";

async function fetchInfo(token: string): Promise<SharePublicInfo> {
  const res = await fetch(`/api/v1/share/${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Not found");
  return res.json();
}

export function SharePageFileIcon({ name }: { name: string }) {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return (
    <div className="relative">
      <div className="h-16 w-16 bg-accent/10 rounded-2xl flex items-center justify-center text-accent shadow-inner border border-accent/20">
        <FileIcon className="h-8 w-8" />
      </div>
      {ext && (
        <div className="absolute -bottom-2 -right-2 bg-surface text-content text-[10px] uppercase font-bold px-2 py-0.5 rounded-lg border border-border/50 shadow-sm truncate max-w-[50px]">
          {codeLanguage(ext)}
        </div>
      )}
    </div>
  );
}

function entryIcon(entry: SharePublicEntry) {
  if (entry.is_dir) return <Folder className="h-5 w-5 text-accent" />;
  const kind = previewKind(entry);
  if (kind === "image") return <ImageIcon className="h-5 w-5 text-emerald-400" />;
  if (kind === "audio") return <Music className="h-5 w-5 text-pink-400" />;
  if (kind === "video") return <Film className="h-5 w-5 text-indigo-400" />;
  if (kind === "pdf") return <FileText className="h-5 w-5 text-red-400" />;
  if (entry.extension === "zip" || entry.extension === "tar" || entry.extension === "gz") return <Archive className="h-5 w-5 text-amber-400" />;
  return <FileIcon className="h-5 w-5 text-content-muted" />;
}

export default function SharePage({ token }: { token: string }) {
  const [info, setInfo] = useState<SharePublicInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState(false);

  // Remove the static boot splash (index.html) — this route renders its own UI.
  useEffect(() => {
    document.getElementById("boot-splash")?.remove();
  }, []);

  useEffect(() => {
    fetchInfo(token).then(setInfo).catch((e) => setError(e.message));
  }, [token]);

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/share/${encodeURIComponent(token)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Incorrect password");
      }
      setUnlocked(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setVerifying(false);
    }
  };

  const authFetch = (url: string, init?: RequestInit) => fetch(url, {
    ...init,
    headers: { ...(password ? { "X-Share-Password": password } : {}), ...(init?.headers || {}) },
  });

  const readError = async (res: Response): Promise<string> => {
    try {
      const body = await res.json();
      if (body?.message) return body.message;
    } catch { /* ignore */ }
    return res.statusText || "Request failed";
  };

  // downloadTarget streams and saves a blob. entry may be undefined for the
  // folder-as-zip download; for folder shares the server zips the whole folder.
  const downloadTarget = async (entry?: SharePublicEntry) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const params = entry ? `?path=${encodeURIComponent(entry.path)}` : "";
      const url = `/api/v1/share/${encodeURIComponent(token)}/download${params}`;
      const isTauri = isTauriRuntime();
      if (isTauri) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { download: tauriDownload } = await import("@tauri-apps/plugin-upload");
        const defaultName = entry?.name || (info?.is_dir ? `${info.name}.zip` : info?.name || "download");
        const savePath = await save({ defaultPath: defaultName });
        if (!savePath) return;
        const absoluteUrl = new URL(url, localStorage.getItem("nexora-api-url") || window.location.origin).toString();
        const headers = new Map<string, string>();
        if (password) headers.set("X-Share-Password", password);
        await tauriDownload(absoluteUrl, savePath, undefined, headers);
        return;
      }
      const res = await authFetch(url);
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = entry?.name || (info?.is_dir ? `${info.name}.zip` : info?.name || "download");
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next macrotask — revoking synchronously can abort the
      // download in some browsers before it has latched the URL.
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    } catch (e: any) {
      setError(e?.message || "Download failed");
    } finally {
      setBusy(false);
    }
  };

  // previewTarget opens a file (or the whole share if it is a file) in a new
  // tab so the browser's native viewer handles images/audio/video/PDF.
  const previewTarget = async (entry?: SharePublicEntry) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const params = entry ? `?path=${encodeURIComponent(entry.path)}` : "";
      const url = `/api/v1/share/${encodeURIComponent(token)}/raw${params}`;
      const res = await authFetch(url);
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, "_blank", "noopener,noreferrer");
      // Reclaim the object URL once the preview window has had a chance to load it.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      if (!win) setError("Popup blocked — allow popups to preview downloads.");
    } catch (e: any) {
      setError(e?.message || "Preview failed");
    } finally {
      setBusy(false);
    }
  };

  const isDir = !!info?.is_dir;
  const canPreview = info?.scope === "preview";

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-2xl relative z-10 animate-scale-in">
        <div className="flex flex-col items-center justify-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-accent/20 mb-4 transform hover:scale-105 transition-transform">
            N
          </div>
          <span className="font-bold text-lg tracking-wide text-content-muted">NEXORA</span>
        </div>

        <div className="glass-strong rounded-3xl p-8 shadow-2xl border border-border/50 backdrop-blur-xl relative overflow-hidden">
          {error && !info ? (
            <div className="text-center py-8 animate-fade-in">
              <div className="h-16 w-16 rounded-full bg-danger/10 text-danger flex items-center justify-center mx-auto mb-4">
                <FileWarning className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-bold mb-2">Link Unavailable</h2>
              <p className="text-content-muted">{error}</p>
            </div>
          ) : !info ? (
            <div className="text-center py-10 space-y-4 animate-pulse">
              <div className="skeleton h-16 w-16 rounded-2xl mx-auto" />
              <div className="skeleton h-6 w-3/4 mx-auto rounded-lg" />
              <div className="skeleton h-4 w-1/2 mx-auto rounded" />
            </div>
          ) : info.status !== "ok" ? (
            <div className="text-center py-8 animate-fade-in">
              <div className="h-16 w-16 rounded-full bg-warning/10 text-warning flex items-center justify-center mx-auto mb-4">
                <FileWarning className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-bold mb-2">Link Expired</h2>
              <p className="text-content-muted">This link has {info.status === "expired" ? "expired" : "reached its maximum download limit"}.</p>
            </div>
          ) : (
            <div className="animate-fade-in">
              <div className="flex flex-col items-center text-center mb-6">
                <div className="mb-4">
                  {isDir ? (
                    <div className="h-16 w-16 bg-accent/10 rounded-2xl flex items-center justify-center text-accent shadow-inner border border-accent/20">
                      <FolderOpen className="h-8 w-8" />
                    </div>
                  ) : (
                    <SharePageFileIcon name={info.name} />
                  )}
                </div>
                <h2 className="text-xl md:text-2xl font-bold break-all mb-1">{info.name}</h2>
                <p className="text-sm text-content-muted">
                  {isDir
                    ? `Shared folder with ${info.total_entries ?? info.entries?.length ?? 0} item${(info.total_entries ?? info.entries?.length ?? 0) === 1 ? "" : "s"}`
                    : "Shared securely via Nexora"}
                </p>
              </div>

              {info.has_password && !unlocked ? (
                <form onSubmit={verify} className="space-y-4 animate-slide-up">
                  <div className="bg-surface/50 rounded-xl p-4 border border-border/50 flex items-start gap-3 mb-6">
                    <Lock className="h-5 w-5 text-accent shrink-0 mt-0.5" />
                    <p className="text-sm font-medium leading-relaxed">This file is protected by a password. Please enter the password to access it.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-content-muted uppercase tracking-wider">Access Password</label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="Enter password"
                      icon={<Lock className="h-4 w-4" />}
                      autoFocus
                    />
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm font-medium animate-slide-up flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="pt-2">
                    <Button
                      type="submit"
                      variant="primary"
                      className="w-full h-12 text-base"
                      loading={verifying}
                      disabled={!password || verifying}
                    >
                      Unlock File
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4 animate-slide-up">
                  {error && (
                    <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm font-medium animate-slide-up flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {error}
                    </div>
                  )}

                  {isDir ? (
                    <div className="bg-surface/30 rounded-2xl border border-border/50 overflow-hidden">
                      <div className="max-h-80 overflow-auto custom-scrollbar divide-y divide-border/40">
                        {(info.entries || []).map((entry) => (
                          <div key={entry.path} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface/60 transition-colors">
                            <span className="shrink-0">{entryIcon(entry)}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{entry.name}</p>
                              <p className="text-[11px] text-content-muted/70 truncate">
                                {entry.is_dir ? "Folder" : formatBytes(entry.size)}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {!entry.is_dir && canPreview && (
                                <button
                                  onClick={() => previewTarget(entry)}
                                  disabled={busy}
                                  className="p-2 rounded-lg glass-hover text-content-muted hover:text-content transition-colors"
                                  title="Preview"
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                              )}
                              {!entry.is_dir && (
                                <button
                                  onClick={() => downloadTarget(entry)}
                                  disabled={busy}
                                  className="p-2 rounded-lg glass-hover text-content-muted hover:text-accent transition-colors"
                                  title="Download"
                                >
                                  <Download className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                        {info.entries && info.entries.length === 0 && (
                          <div className="text-center text-content-muted py-10 text-sm">
                            <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            This folder is empty.
                          </div>
                        )}
                      </div>
                      {(info.total_entries ?? 0) > (info.entries?.length || 0) && (
                        <div className="px-4 py-2 bg-surface/40 border-t border-border/50 text-xs text-content-muted text-center">
                          Showing first {info.entries?.length} of {info.total_entries} items — download the folder for everything.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 bg-surface/30 rounded-xl p-3 border border-border/50 mb-2">
                      <SharePageFileIcon name={info.name} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{info.name}</p>
                        <p className="text-xs text-content-muted">{info.size ? formatBytes(info.size) : ""}{info.size && info.extension ? " · " : ""}{info.extension.toUpperCase() || "FILE"}</p>
                      </div>
                    </div>
                  )}

                  <Button variant="primary" className="w-full h-12 text-base shadow-lg shadow-accent/20" icon={<Download className="h-5 w-5" />} onClick={() => downloadTarget()} loading={busy}>
                    {isDir ? "Download folder (.zip)" : "Download File"}
                  </Button>

                  {canPreview && !isDir && (
                    <Button variant="secondary" className="w-full h-12" icon={<Eye className="h-5 w-5" />} onClick={() => previewTarget()} loading={busy}>
                      Open Preview
                    </Button>
                  )}

                  {info.max_downloads > 0 && (
                    <div className="mt-6 text-center">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border/50 text-xs font-medium text-content-muted">
                        <Download className="h-3.5 w-3.5" />
                        {info.downloads} of {info.max_downloads} downloads used
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs font-medium text-content-muted mt-8 opacity-60">
          Powered by Nexora — Enterprise File System
        </p>
      </div>
    </div>
  );
}

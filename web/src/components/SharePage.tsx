import { useEffect, useState } from "react";
import { Download, Lock, FileWarning, Eye, AlertCircle, FileIcon } from "lucide-react";
import type { SharePublicInfo } from "../api/types";
import { previewKind, codeLanguage } from "../lib/preview";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

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

export default function SharePage({ token }: { token: string }) {
  const [info, setInfo] = useState<SharePublicInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    fetchInfo(token).then(setInfo).catch((e) => setError(e.message));
  }, [token]);

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setVerifying(true);
    try {
      const res = await fetch(`/api/v1/share/${encodeURIComponent(token)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error("Incorrect password");
      setUnlocked(true);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setVerifying(false);
    }
  };

  const downloadUrl = `/api/v1/share/${encodeURIComponent(token)}/download`;
  const rawViewUrl = `/api/v1/share/${encodeURIComponent(token)}/raw`;

  const authFetch = (url: string) => fetch(url, {
    headers: password ? { "X-Share-Password": password } : undefined,
  });

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (info?.scope === "preview" && previewKind(info) === "image" && unlocked) {
      authFetch(rawViewUrl).then((res) => {
        if (res.ok) res.blob().then((b) => setPreviewUrl(URL.createObjectURL(b)));
      });
    }
  }, [info, unlocked]);

  const handleDownload = async () => {
    const res = await authFetch(downloadUrl);
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = info?.name || "download";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handlePreview = async () => {
    const res = await authFetch(rawViewUrl);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-lg relative z-10 animate-scale-in">
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
              <div className="flex flex-col items-center text-center mb-8">
                <div className="mb-4">
                  <SharePageFileIcon name={info.name} />
                </div>
                <h2 className="text-xl md:text-2xl font-bold break-all mb-1">{info.name}</h2>
                <p className="text-sm text-content-muted">Shared securely via Nexora</p>
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
                  {info.scope === "preview" && previewKind(info) === "image" && previewUrl && (
                    <div className="bg-surface/30 rounded-xl p-2 border border-border/50 mb-6 flex justify-center">
                      <img src={previewUrl} alt={info.name} className="max-h-64 rounded-lg object-contain" />
                    </div>
                  )}
                  
                  <Button variant="primary" className="w-full h-12 text-base shadow-lg shadow-accent/20" icon={<Download className="h-5 w-5" />} onClick={handleDownload}>
                    Download File
                  </Button>
                  
                  {info.scope === "preview" && (
                    <Button variant="secondary" className="w-full h-12" icon={<Eye className="h-5 w-5" />} onClick={handlePreview}>
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

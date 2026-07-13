import { useEffect, useState } from "react";
import { Download, Lock, FileWarning, Eye } from "lucide-react";
import type { SharePublicInfo } from "../api/types";
import { previewKind } from "../lib/preview";

async function fetchInfo(token: string): Promise<SharePublicInfo> {
  const res = await fetch(`/api/v1/share/${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Not found");
  return res.json();
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

  const verify = async () => {
    setVerifying(true);
    try {
      const res = await fetch(`/api/v1/share/${encodeURIComponent(token)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error("Incorrect password");
      setUnlocked(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setVerifying(false);
    }
  };

  const pq = password ? `?p=${encodeURIComponent(password)}` : "";
  const downloadUrl = `/api/v1/share/${encodeURIComponent(token)}/download${pq}`;
  const rawViewUrl = `/api/v1/share/${encodeURIComponent(token)}/raw${pq}`;

  return (
    <div className="min-h-screen grid place-items-center p-4 bg-surface">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="h-9 w-9 rounded-lg bg-accent grid place-items-center text-accent-fg font-bold">N</div>
          <span className="font-semibold text-xl">Nexora</span>
        </div>
        <div className="bg-surface-elevated border rounded-xl p-6 shadow-sm">
          {error && !info ? (
            <div className="text-center text-content-muted">
              <FileWarning className="h-8 w-8 mx-auto mb-2 text-amber-500" />
              <p>{error}</p>
            </div>
          ) : !info ? (
            <p className="text-center text-content-muted">Loading…</p>
          ) : info.status !== "ok" ? (
            <div className="text-center text-content-muted">
              <FileWarning className="h-8 w-8 mx-auto mb-2 text-amber-500" />
              <p>This link has {info.status === "expired" ? "expired" : "reached its download limit"}.</p>
            </div>
          ) : (
            <>
              <div className="text-center mb-5">
                <p className="text-sm text-content-muted">Shared file</p>
                <p className="text-lg font-semibold break-all">{info.name}</p>
              </div>

              {info.has_password && !unlocked ? (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm"><Lock className="h-4 w-4" /> This file is password protected</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && verify()}
                    placeholder="Enter password"
                    className="w-full rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40"
                  />
                  {error && <p className="text-sm text-red-500">{error}</p>}
                  <button onClick={verify} disabled={verifying} className="w-full rounded-lg bg-accent text-accent-fg py-2 disabled:opacity-50">
                    {verifying ? "Checking…" : "Unlock"}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {info.scope === "preview" && previewKind(info) === "image" && (
                    <img src={rawViewUrl} alt={info.name} className="max-h-64 mx-auto rounded-lg object-contain" />
                  )}
                  <a href={downloadUrl} className="flex items-center justify-center gap-2 w-full rounded-lg bg-accent text-accent-fg py-2 font-medium">
                    <Download className="h-4 w-4" /> Download
                  </a>
                  {info.scope === "preview" && (
                    <a href={rawViewUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full rounded-lg border py-2 hover:bg-surface-muted">
                      <Eye className="h-4 w-4" /> Open preview
                    </a>
                  )}
                  {info.max_downloads > 0 && (
                    <p className="text-center text-xs text-content-muted">{info.downloads}/{info.max_downloads} downloads used</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <p className="text-center text-xs text-content-muted mt-4">Powered by Nexora — your private file workspace</p>
      </div>
    </div>
  );
}

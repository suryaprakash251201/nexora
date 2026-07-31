import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, discoverServerUrl } from "./api/client";
import Login from "./components/Login";
import Setup from "./components/Setup";
import Workspace from "./components/Workspace";
import MouseGlow from "./components/MouseGlow";
import UpdaterCheck from "./components/UpdaterCheck";
import TauriShell from "./components/TauriShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { User } from "./api/types";

export default function App() {
  const isTauri = "__TAURI_INTERNALS__" in window;
  return (
    <>
      <div className="nexora-bg" aria-hidden="true" />
      <MouseGlow />
      {isTauri && <TauriShell />}
      {isTauri && <UpdaterCheck />}
      <AppInner />
    </>
  );
}

import { useState, useEffect, useRef } from "react";

function AppInner() {
  const qc = useQueryClient();
  const [apiUrl, setApiUrl] = useState(localStorage.getItem("nexora-api-url") || "");
  const [inputUrl, setInputUrl] = useState(apiUrl);
  const [discovering, setDiscovering] = useState("");
  const discoverDone = useRef(false);
  
  const isTauri = "__TAURI_INTERNALS__" in window;

  // ── Auto-discovery: probe Tailscale hosts when no URL is stored ──
  useEffect(() => {
    if (!isTauri || apiUrl || discoverDone.current) return;
    discoverDone.current = true;
    setDiscovering("Probing Tailscale hosts…");
    discoverServerUrl()
      .then((url) => {
        if (url) {
          localStorage.setItem("nexora-api-url", url);
          setApiUrl(url);
        }
        setDiscovering("");
      })
      .catch(() => setDiscovering(""));
  }, [isTauri, apiUrl]);

  const needsSetup = useQuery({ 
    queryKey: ["needs-setup"], 
    queryFn: () => get<{ configured: boolean }>("/auth/needs-setup"),
    enabled: !isTauri || !!apiUrl
  });
  
  const session = useQuery({ 
    queryKey: ["session"], 
    queryFn: () => get<{ user: User }>("/auth/session"),
    enabled: !isTauri || !!apiUrl
  });

  if (isTauri && !apiUrl) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="w-full max-w-sm p-6 bg-surface border rounded-xl shadow-lg space-y-4">
          <h2 className="text-xl font-bold">Connect to Nexora</h2>
          {discovering ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm text-content-muted">{discovering}</p>
              <p className="text-xs text-content-muted/50">Trying Tailscale MagicDNS…</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-content-muted">
                No Nexora server found on your Tailscale network. Enter the URL manually:
              </p>
              <input 
                type="url" 
                className="w-full px-3 py-2 bg-background border rounded-lg focus:ring-2 focus:ring-primary focus:outline-none" 
                placeholder="http://localhost:8080"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                autoFocus
              />
              <button 
                className="w-full py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition"
                onClick={() => {
                  if (inputUrl) {
                    localStorage.setItem("nexora-api-url", inputUrl);
                    setApiUrl(inputUrl);
                  }
                }}
              >
                Connect
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (needsSetup.isLoading || session.isLoading) {
    return <div className="min-h-screen grid place-items-center text-content-muted">Loading…</div>;
  }

  if (needsSetup.isError || session.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="max-w-md w-full p-6 bg-card border rounded-lg shadow-lg text-center">
          <h2 className="text-xl font-semibold mb-2 text-destructive">Connection Error</h2>
          <p className="text-content-muted text-sm mb-4">
            Could not connect to the backend server. If using Tauri, ensure the URL is correct and the server allows CORS.
          </p>
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
            onClick={() => {
              localStorage.removeItem("nexora-api-url");
              setApiUrl("");
              qc.clear();
            }}
          >
            Reset URL
          </button>
        </div>
      </div>
    );
  }

  if (!needsSetup.data?.configured) {
    return <Setup onSuccess={() => { qc.invalidateQueries(); }} />;
  }

  if (!session.data?.user) {
    return <Login onSuccess={() => { qc.invalidateQueries(); }} />;
  }

  return (
    <ErrorBoundary>
      <Workspace user={session.data.user} />
    </ErrorBoundary>
  );
}

// Re-export for potential external use.
export async function handleLogout() {
  await post("/auth/logout");
  localStorage.removeItem("nexora-token");
  window.location.reload();
}

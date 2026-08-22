import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, ExternalLink, LoaderCircle, PlugZap, WifiOff } from "lucide-react";
import { discoverServerUrl } from "./api/client";
import { authApi } from "./api/endpoints";
import Login from "./components/Login";
import Setup from "./components/Setup";
import Workspace from "./components/Workspace";
import MouseGlow from "./components/MouseGlow";
import SplashScreen from "./components/SplashScreen";
import NexoraLogo from "./components/icons/NexoraLogo";
import UpdaterCheck from "./components/UpdaterCheck";
import TauriShell from "./components/TauriShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Toaster } from "./components/ui/sonner";
import { openInBrowser, isTauri } from "./lib/desktop";

export default function App() {
  return (
    <>
      <div className="nexora-bg" aria-hidden="true" />
      <MouseGlow />
      {isTauri() && <TauriShell />}
      {isTauri() && <UpdaterCheck />}
      <Toaster />
      <AppInner />
    </>
  );
}

import { useState, useEffect } from "react";

function AppInner() {
  const qc = useQueryClient();
  const [apiUrl, setApiUrl] = useState(localStorage.getItem("nexora-api-url") || "");
  const [inputUrl, setInputUrl] = useState(apiUrl);
  const [discovering, setDiscovering] = useState("");
  const [discoverDone, setDiscoverDone] = useState(false);

  const isTauriEnv = isTauri();

  // ── Auto-discovery: probe Tailscale hosts when no URL is stored ──
  useEffect(() => {
    if (!isTauriEnv || apiUrl || discoverDone) return;
    setDiscoverDone(true);
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
  }, [isTauriEnv, apiUrl, discoverDone]);

  const needsSetup = useQuery({
    queryKey: ["needs-setup"],
    queryFn: () => authApi.needsSetup(),
    enabled: !isTauriEnv || !!apiUrl,
  });

  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => authApi.session(),
    enabled: !isTauriEnv || !!apiUrl,
  });

  const quickConnect = (url: string) => {
    localStorage.setItem("nexora-api-url", url);
    setApiUrl(url);
    setInputUrl(url);
  };

  // ── Boot splash: show the branded logo briefly, but only once per
  // browser session so refreshes don't add perceived latency. ──
  const [splashDone, setSplashDone] = useState(() => {
    try { return sessionStorage.getItem("nexora-splash-seen") === "1"; } catch { return false; }
  });
  if (!splashDone) {
    return <SplashScreen onDone={() => { try { sessionStorage.setItem("nexora-splash-seen", "1"); } catch { /* ignore */ } setSplashDone(true); }} />;
  }

  if (isTauriEnv && !apiUrl) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="w-full max-w-sm px-6">
          <div className="rounded-2xl border border-glass-border-soft bg-glass-bg-strong/80 backdrop-blur-xl shadow-glass-strong p-8 space-y-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="grid place-items-center h-14 w-14 rounded-2xl bg-white/5 ring-1 ring-white/10 shadow-lg shadow-accent/25">
                <NexoraLogo size={40} idPrefix="connect" />
              </span>
              <div>
                <h2 className="text-xl font-bold tracking-tight">Connect to Nexora</h2>
                <p className="text-sm text-content-muted mt-1">Find your server on this network or enter its address.</p>
              </div>
            </div>

            {discovering ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <LoaderCircle className="h-8 w-8 animate-spin text-accent" />
                <p className="text-sm text-content-muted">{discovering}</p>
                <p className="text-xs text-content-muted/60">Checking localhost and Tailscale MagicDNS…</p>
              </div>
            ) : (
              <>
                <input
                  type="url"
                  className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl focus:ring-2 focus:ring-accent focus:outline-none text-sm"
                  placeholder="http://localhost:8080"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && inputUrl.trim()) {
                      localStorage.setItem("nexora-api-url", inputUrl.trim());
                      setApiUrl(inputUrl.trim());
                    }
                  }}
                  autoFocus
                />
                <button
                  className="w-full py-2.5 bg-gradient-to-r from-accent via-accent-secondary to-accent-tertiary text-white font-medium rounded-xl hover:opacity-90 active:scale-[0.99] transition"
                  onClick={() => {
                    if (inputUrl.trim()) {
                      localStorage.setItem("nexora-api-url", inputUrl.trim());
                      setApiUrl(inputUrl.trim());
                    }
                  }}
                >
                  Connect
                </button>

                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-content-muted/60">Quick connect</p>
                  <div className="flex flex-wrap gap-1.5">
                    {["http://localhost:8080", "http://127.0.0.1:8080", "http://nexora.local"].map((u) => (
                      <button
                        key={u}
                        onClick={() => quickConnect(u)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-glass-bg-subtle border border-glass-border-soft text-content-muted hover:text-foreground hover:border-accent/50 transition-colors font-mono"
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {!discovering && (
            <button
              onClick={() => {
                setDiscoverDone(false);
              }}
              className="mt-4 w-full flex items-center justify-center gap-2 text-xs text-content-muted hover:text-content transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Scan the network again
            </button>
          )}
        </div>
      </div>
    );
  }

  if (needsSetup.isLoading || session.isLoading) {
    // Branded loading: logo + animation while we connect to the server.
    return <SplashScreen persistent caption="Connecting to your server…" />;
  }

  if (needsSetup.isError || session.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="max-w-md w-full px-6">
          <div className="rounded-2xl border border-glass-border-soft bg-glass-bg-strong/80 backdrop-blur-xl shadow-glass-strong p-8 text-center space-y-4">
            <span className="mx-auto grid place-items-center h-14 w-14 rounded-2xl bg-red-500/10 text-red-500">
              <WifiOff className="h-7 w-7" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-destructive">Connection Error</h2>
              <p className="text-sm text-content-muted mt-2">
                Could not reach the Nexora server{isTauriEnv && apiUrl ? ` at ${apiUrl}` : ""}. Make sure it is running and reachable.
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <button
                className="w-full py-2.5 bg-primary text-primary-foreground font-medium rounded-xl hover:bg-primary/90 transition"
                onClick={() => {
                  localStorage.removeItem("nexora-api-url");
                  setApiUrl("");
                  setDiscoverDone(false);
                  qc.clear();
                }}
              >
                <span className="flex items-center justify-center gap-2">
                  <PlugZap className="h-4 w-4" />
                  Reconfigure connection
                </span>
              </button>
              {isTauriEnv && (
                <button
                  className="w-full py-2.5 rounded-xl border border-glass-border-soft text-sm text-content-muted hover:text-foreground hover:bg-glass-bg-subtle transition"
                  onClick={() => openInBrowser()}
                >
                  <span className="flex items-center justify-center gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Open server in browser
                  </span>
                </button>
              )}
            </div>
          </div>
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
  await authApi.logout();
  localStorage.removeItem("nexora-token");
  window.location.reload();
}

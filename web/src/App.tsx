import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "./api/client";
import Login from "./components/Login";
import Setup from "./components/Setup";
import Workspace from "./components/Workspace";
import MouseGlow from "./components/MouseGlow";
import type { User } from "./api/types";

export default function App() {
  return (
    <>
      <div className="nexora-bg" aria-hidden="true" />
      <MouseGlow />
      <AppInner />
    </>
  );
}

import { useState } from "react";

function AppInner() {
  const qc = useQueryClient();
  const [apiUrl, setApiUrl] = useState(localStorage.getItem("nexora-api-url") || "");
  const [inputUrl, setInputUrl] = useState(apiUrl);
  
  const isTauri = "__TAURI_INTERNALS__" in window;

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
          <p className="text-sm text-content-muted">Enter your Nexora server URL to continue.</p>
          <input 
            type="url" 
            className="w-full px-3 py-2 bg-background border rounded-lg focus:ring-2 focus:ring-primary focus:outline-none" 
            placeholder="http://localhost:8080"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
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

  return <Workspace user={session.data.user} />;
}

// Re-export for potential external use.
export async function handleLogout() {
  await post("/auth/logout");
  localStorage.removeItem("nexora-token");
  window.location.reload();
}

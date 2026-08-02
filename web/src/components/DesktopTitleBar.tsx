import { useEffect, useState } from "react";
import { Minus, Square, Copy, X, ExternalLink, Sparkles, Wifi, WifiOff, LoaderCircle } from "lucide-react";
import { useUI } from "../store";
import { isTauri, openInBrowser, usesCustomTitleBar } from "../lib/desktop";

/** True when the native title bar has been replaced (Windows/Linux desktop). */
export function useCustomTitleBar(): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let mounted = true;
    usesCustomTitleBar().then((v) => mounted && setShow(v));
    return () => {
      mounted = false;
    };
  }, []);
  return show;
}

function StatusDot() {
  const online = useUI((s) => s.serverOnline);
  if (online === null) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-content-muted">
        <LoaderCircle className="h-3 w-3 animate-spin" />
        Connecting…
      </span>
    );
  }
  if (online) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-emerald-500">
        <Wifi className="h-3 w-3" />
        Connected
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-red-500">
      <WifiOff className="h-3 w-3" />
      Offline
    </span>
  );
}

/**
 * DesktopTitleBar replaces the OS window chrome on Windows & Linux with an
 * in-app, draggable bar (brand, live server status, window controls).
 * Rendered as a fixed overlay; content gets top padding via useCustomTitleBar().
 */
export default function DesktopTitleBar() {
  const show = useCustomTitleBar();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!show || !isTauri()) return;
    let un: (() => void) | undefined;
    import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        try {
          setMaximized(await win.isMaximized());
        } catch { /* ignore */ }
        un = await win.onResized(() => {
          win.isMaximized().then(setMaximized).catch(() => {});
        });
      })
      .catch(() => {});
    return () => {
      un?.();
    };
  }, [show]);

  if (!show || !isTauri()) return null;

  const minimize = () => import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().minimize());
  const toggleMax = () => import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize());
  const close = () => import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close());

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={toggleMax}
      className="fixed top-0 inset-x-0 h-[38px] z-[70] flex items-center select-none glass-bar border-b border-glass-border-soft pl-3 pr-1.5"
    >
      {/* Brand */}
      <div data-tauri-drag-region className="flex items-center gap-2 min-w-0">
        <span className="grid place-items-center h-5 w-5 rounded-md bg-gradient-to-br from-accent via-accent-secondary to-accent-tertiary text-white shrink-0">
          <Sparkles className="h-3 w-3" />
        </span>
        <span className="font-semibold text-[13px] tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-accent via-accent-secondary to-accent-tertiary whitespace-nowrap">
          Nexora
        </span>
      </div>

      {/* Server status */}
      <div data-tauri-drag-region className="flex items-center gap-1.5 ml-3 px-2 h-6 rounded-md bg-glass-bg-subtle border border-glass-border-soft">
        <StatusDot />
      </div>

      <div data-tauri-drag-region className="flex-1 h-full" />

      {/* Actions + window controls */}
      <div className="flex items-center gap-0.5">
        <button
          title="Open in browser"
          onClick={() => openInBrowser()}
          className="grid place-items-center h-7 w-7 rounded-md text-content-muted hover:text-foreground hover:bg-glass-bg-subtle transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>

        <div className="w-px h-4 bg-border/40 mx-1" />

        <button
          title="Minimize"
          onClick={minimize}
          className="grid place-items-center h-7 w-9 rounded-md text-content-muted hover:text-foreground hover:bg-glass-bg-subtle transition-colors"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          title={maximized ? "Restore" : "Maximize"}
          onClick={toggleMax}
          className="grid place-items-center h-7 w-9 rounded-md text-content-muted hover:text-foreground hover:bg-glass-bg-subtle transition-colors"
        >
          {maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          title="Close"
          onClick={close}
          className="grid place-items-center h-7 w-9 rounded-md text-content-muted hover:text-white hover:bg-red-500/90 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

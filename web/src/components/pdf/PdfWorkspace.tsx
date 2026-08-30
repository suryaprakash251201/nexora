import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileItem } from "../../api/types";
import { rawUrl } from "../../lib/preview";
import { ViewerContext, type ViewerContextValue } from "./ctx";
import { usePdfDocument } from "./usePdfDocument";
import { searchDocument } from "./searchEngine";
import type { FitMode, SearchMatch } from "./types";
import { clamp, downloadItem, openInNewTab, printPdfUrl } from "./utils";
import { DocumentCanvas } from "./DocumentCanvas";
import { FloatingHeader } from "./FloatingHeader";
import { FloatingControls } from "./FloatingControls";
import { PageNavigator } from "./PageNavigator";
import { CommandPalette } from "./CommandPalette";
import { SearchPanel } from "./SearchPanel";
import { DocumentInfoPanel } from "./DocumentInfoPanel";
import { ShareSheet } from "./ShareSheet";
import { SelectionToolbar } from "./SelectionToolbar";
import { ViewerStatus } from "./ViewerStatus";

/** Idle time before chrome (header/dock) fades out while reading. */
const CHROME_IDLE_MS = 3200;
/** Faster hide in true fullscreen — less obstruction while reading. */
const CHROME_IDLE_MS_FULLSCREEN = 2200;

/**
 * The Document Space — Nexora's dedicated PDF workspace. Owns all viewer
 * state, the adaptive-chrome timer, the keyboard layer, and composes every
 * floating surface around the continuous document canvas.
 */
export default function PdfWorkspace({
  item,
  rootId,
  onClose,
  onShare,
}: {
  item: FileItem;
  /** Root id fallback when the item carries no root_id of its own. */
  rootId?: string;
  onClose(): void;
  onShare?(item: FileItem): void;
}) {
  const url = rawUrl(item.root_id || rootId || "", item.path);
  const docState = usePdfDocument(url);
  const { doc, numPages } = docState;

  // ── View state ──────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [fit, setFit] = useState<FitMode>("width");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [effectiveScale, setEffectiveScale] = useState(1);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [shellEl, setShellEl] = useState<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  // Reset view state when another document opens in this workspace.
  useEffect(() => {
    setPage(1);
    setFit("width");
    setZoom(1);
    setRotation(0);
  }, [url]);

  // ── Panels ──────────────────────────────────────────────────────────
  const [pagesOpen, setPagesOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // ── Search ──────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [resultsByPage, setResultsByPage] = useState<Map<number, SearchMatch[]>>(new Map());
  const [flatResults, setFlatResults] = useState<SearchMatch[]>([]);
  const [resultsTruncated, setResultsTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchProgressPage, setSearchProgressPage] = useState(0);
  const [activeResult, setActiveResult] = useState(-1);
  const searchGenRef = useRef(0);
  const activeResultRef = useRef(-1);
  activeResultRef.current = activeResult;
  const pageRef = useRef(page);
  pageRef.current = page;

  // Debounced, cancellable search execution.
  useEffect(() => {
    const q = query.trim();
    if (!doc || q.length === 0 || !searchOpen) {
      searchGenRef.current++;
      setSearching(false);
      setResultsByPage(new Map());
      setFlatResults([]);
      setResultsTruncated(false);
      setActiveResult(-1);
      return;
    }
    const timer = setTimeout(() => {
      const gen = ++searchGenRef.current;
      setSearching(true);
      setResultsByPage(new Map());
      setFlatResults([]);
      setResultsTruncated(false);
      setActiveResult(-1);
      void searchDocument(
        doc,
        q,
        {
          onProgress: (p) => {
            if (searchGenRef.current === gen) setSearchProgressPage(p);
          },
          onPartial: (byPage, flat) => {
            if (searchGenRef.current !== gen) return;
            setResultsByPage(new Map(byPage));
            setFlatResults([...flat]);
          },
        },
        () => searchGenRef.current !== gen
      ).then(({ byPage, flat, truncated }) => {
        if (searchGenRef.current !== gen) return;
        setResultsByPage(byPage);
        setFlatResults(flat);
        setResultsTruncated(truncated);
        setSearching(false);
        if (flat.length > 0) setActiveResult((cur) => (cur >= 0 ? cur : -1));
      });
    }, 280);
    return () => clearTimeout(timer);
  }, [query, doc, searchOpen]);

  // ── Modes ───────────────────────────────────────────────────────────
  const [focusMode, setFocusMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chromeIdle, setChromeIdle] = useState(false);
  const activityTimerRef = useRef<number | null>(null);
  const anyPanelOpen = pagesOpen || infoOpen || shareOpen || paletteOpen || searchOpen;
  const anyPanelOpenRef = useRef(anyPanelOpen);
  anyPanelOpenRef.current = anyPanelOpen;

  const reportActivity = useCallback(() => {
    setChromeIdle(false);
    if (activityTimerRef.current !== null) window.clearTimeout(activityTimerRef.current);
    const idleMs = isFullscreen ? CHROME_IDLE_MS_FULLSCREEN : CHROME_IDLE_MS;
    activityTimerRef.current = window.setTimeout(() => {
      if (!anyPanelOpenRef.current) setChromeIdle(true);
    }, idleMs);
  }, [isFullscreen]);

  useEffect(() => {
    reportActivity();
    return () => {
      if (activityTimerRef.current !== null) window.clearTimeout(activityTimerRef.current);
    };
  }, [reportActivity]);

  // In true browser / Tauri fullscreen, hide chrome immediately and require
  // explicit mouse movement to reveal — avoids the “controls disturb preview”
  // feeling where the dock sits over the page after entering fullscreen.
  useEffect(() => {
    if (isFullscreen) {
      setChromeIdle(true);
      if (activityTimerRef.current !== null) window.clearTimeout(activityTimerRef.current);
    } else {
      reportActivity();
    }
  }, [isFullscreen, reportActivity]);

  const chromeVisible = !chromeIdle || anyPanelOpen;

  const toggleFocus = useCallback(() => {
    setFocusMode((f) => {
      const next = !f;
      if (next) {
        setPagesOpen(false);
        setInfoOpen(false);
        setShareOpen(false);
        setChromeIdle(true);
      } else {
        reportActivity();
      }
      return next;
    });
  }, [reportActivity]);

  // ── Fullscreen ──────────────────────────────────────────────────────
  // Supports both browser Fullscreen API and Tauri window fullscreen
  // (where the web API is unavailable). Keeps isFullscreen in sync with
  // whatever surface is actually fullscreened. Exits fullscreen on viewer
  // close so “back to files / home” never leaves the app stuck in fullscreen.
  const toggleFullscreen = useCallback(async () => {
    const isTauriEnv =
      typeof window !== "undefined" &&
      (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);
    if (isTauriEnv) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const cur = await win.isFullscreen();
        await win.setFullscreen(!cur);
        setIsFullscreen(!cur);
        return;
      } catch {
        // fall through to web API
      }
    }
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch {
      /* fullscreen unavailable */
    }
  }, []);

  const exitFullscreenIfNeeded = useCallback(async () => {
    if (!isFullscreen) return;
    const isTauriEnv =
      typeof window !== "undefined" &&
      (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);
    if (isTauriEnv) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        if (await win.isFullscreen()) await win.setFullscreen(false);
      } catch {}
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {}
    setIsFullscreen(false);
  }, [isFullscreen]);

  // Wrapper used for every “close viewer / back to files” path — ensures the
  // app never stays in OS fullscreen after the document is dismissed.
  // Satisfies: “fullscreen to back exit home automatically” and
  // “F11 fullscreen mode to exit entire application home”.
  const closeViewerAndExitFullscreen = useCallback(async () => {
    await exitFullscreenIfNeeded();
    onClose();
  }, [exitFullscreenIfNeeded, onClose]);

  // Keep isFullscreen in sync for browser API; Tauri path updates state
  // directly in toggleFullscreen / exitFullscreenIfNeeded.
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    // Also handle F11-initiated browser fullscreen changes (documentElement)
    document.addEventListener("webkitfullscreenchange" as any, onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange" as any, onFsChange);
    };
  }, []);

  // Safety: if the viewer unmounts while still fullscreen, leave fullscreen
  // so the underlying file browser isn't rendered stuck in fullscreen.
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
      // Tauri: don't block unmount on async window call
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        void import("@tauri-apps/api/window")
          .then(({ getCurrentWindow }) => {
            const win = getCurrentWindow();
            return win.isFullscreen().then((fs: boolean) => {
              if (fs) return win.setFullscreen(false);
            });
          })
          .catch(() => {});
      }
    };
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────
  const goToPage = useCallback(
    (n: number) => {
      const clamped = clamp(Math.round(n), 1, Math.max(numPages, 1));
      setPage(clamped);
    },
    [numPages]
  );

  const zoomBy = useCallback((factor: number) => {
    setFit("none");
    setZoom((z) => clamp(z * factor, 0.25, 8));
  }, []);

  const resetZoom = useCallback(() => {
    setFit("none");
    setZoom(1);
  }, []);

  const wheelZoomTo = useCallback((s: number) => {
    setFit("none");
    setZoom(clamp(s, 0.25, 8));
  }, []);

  const rotate = useCallback((dir: 1 | -1) => {
    setRotation((r) => (((r + dir * 90) % 360) + 360) % 360);
  }, []);

  const togglePagesFn = useCallback((force?: boolean) => {
    setPagesOpen((open) => force ?? !open);
  }, []);
  const toggleInfoFn = useCallback((force?: boolean) => {
    setInfoOpen((open) => force ?? !open);
  }, []);
  const toggleShareFn = useCallback((force?: boolean) => {
    setShareOpen((open) => force ?? !open);
  }, []);

  const openSearch = useCallback((prefill?: string) => {
    if (prefill !== undefined) setQuery(prefill);
    setPaletteOpen(false);
    setShareOpen(false);
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
  }, []);

  const gotoResult = useCallback(
    (index: number) => {
      const match = flatResults[index];
      if (!match) return;
      setActiveResult(index);
      goToPage(match.page);
    },
    [flatResults, goToPage]
  );

  const nextResult = useCallback(() => {
    if (flatResults.length === 0) return;
    const next = activeResultRef.current + 1 >= flatResults.length ? 0 : activeResultRef.current + 1;
    gotoResult(next);
  }, [flatResults.length, gotoResult]);

  const prevResult = useCallback(() => {
    if (flatResults.length === 0) return;
    const prev = activeResultRef.current - 1 < 0 ? flatResults.length - 1 : activeResultRef.current - 1;
    gotoResult(prev);
  }, [flatResults.length, gotoResult]);

  const download = useCallback(() => downloadItem(item), [item]);

  const print = useCallback(() => {
    printPdfUrl(url);
  }, [url]);

  const openExternalTab = useCallback(() => {
    void openInNewTab(url);
  }, [url]);

  // ── Keyboard layer (capture phase — runs before host handlers) ───────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      reportActivity();
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest?.("input, textarea, select, [contenteditable]");
      const mod = e.ctrlKey || e.metaKey;

      // F11 — toggle app fullscreen; when leaving fullscreen via F11,
      // also exit the viewer to “home” per product spec:
      // “F11 fullscreen mode to exit entire application home”.
      if (e.key === "F11") {
        e.preventDefault();
        e.stopPropagation();
        if (isFullscreen) {
          void exitFullscreenIfNeeded().then(() => onClose());
        } else {
          void toggleFullscreen();
        }
        return;
      }

      // Escape cascade: close the top-most surface; only let the event
      // bubble out (closing the viewer itself) when nothing is open.
      // In true fullscreen, Escape first exits fullscreen (no viewer close)
      // — second Escape then closes the viewer. This prevents “stuck in
      // fullscreen” and satisfies “fullscreen to back exit home automatically”.
      if (e.key === "Escape") {
        if (isFullscreen) {
          e.preventDefault();
          e.stopPropagation();
          void exitFullscreenIfNeeded();
          return;
        }
        if (paletteOpen) {
          e.preventDefault();
          e.stopPropagation();
          setPaletteOpen(false);
          return;
        }
        if (searchOpen) {
          e.preventDefault();
          e.stopPropagation();
          closeSearch();
          return;
        }
        if (shareOpen) {
          e.stopPropagation();
          setShareOpen(false);
          return;
        }
        if (infoOpen) {
          e.stopPropagation();
          setInfoOpen(false);
          return;
        }
        if (pagesOpen) {
          e.stopPropagation();
          setPagesOpen(false);
          return;
        }
        if (focusMode) {
          e.stopPropagation();
          setFocusMode(false);
          reportActivity();
          return;
        }
        return; // bubbles to the host modal → viewer closes
      }

      if (mod && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        e.stopPropagation();
        openSearch();
        return;
      }
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((open) => !open);
        return;
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        e.stopPropagation();
        zoomBy(1.2);
        return;
      }
      if (mod && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        e.stopPropagation();
        zoomBy(1 / 1.2);
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        e.stopPropagation();
        resetZoom();
        return;
      }
      if (mod && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        e.stopPropagation();
        print();
        return;
      }

      if (typing || mod || e.altKey) return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goToPage(pageRef.current - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          goToPage(pageRef.current + 1);
          break;
        case "Home":
          e.preventDefault();
          goToPage(1);
          break;
        case "End":
          e.preventDefault();
          goToPage(numPages);
          break;
        case "f":
        case "F":
          toggleFocus();
          break;
        case "i":
        case "I":
          toggleInfoFn();
          break;
        case "p":
        case "P":
          togglePagesFn();
          break;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    paletteOpen,
    searchOpen,
    shareOpen,
    infoOpen,
    pagesOpen,
    focusMode,
    isFullscreen,
    closeSearch,
    openSearch,
    zoomBy,
    resetZoom,
    print,
    goToPage,
    toggleFocus,
    toggleInfoFn,
    togglePagesFn,
    toggleFullscreen,
    exitFullscreenIfNeeded,
    onClose,
    numPages,
    reportActivity,
  ]);

  // ── Context value ───────────────────────────────────────────────────
  const value = useMemo<ViewerContextValue>(
    () => ({
      item,
      url,

      doc: docState.doc,
      numPages,
      loading: docState.loading,
      progress: docState.progress,
      error: docState.error,
      meta: docState.meta,
      reload: docState.reload,
      sizes: docState.sizes,

      page,
      goToPage,
      setPage,
      effectiveScale,
      setEffectiveScale,
      wheelZoomTo,
      fit,
      setFit,
      zoom,
      zoomBy,
      resetZoom,
      rotation,
      rotate,
      attachScrollEl: setScrollEl,
      scrollEl,
      attachShellEl: setShellEl,
      shellEl,

      pagesOpen,
      togglePages: togglePagesFn,
      infoOpen,
      toggleInfo: toggleInfoFn,
      shareOpen,
      toggleShare: toggleShareFn,
      paletteOpen,
      setPaletteOpen,
      searchOpen,

      query,
      setQuery,
      resultsByPage,
      flatResults,
      resultsTruncated,
      searching,
      searchProgressPage,
      activeResult,
      openSearch,
      closeSearch,
      gotoResult,
      nextResult,
      prevResult,

      focusMode,
      toggleFocus,
      isFullscreen,
      toggleFullscreen,
      chromeVisible,
      reportActivity,

      hasShareFlow: !!onShare,
      requestShare: () => onShare?.(item),
      closeViewer: closeViewerAndExitFullscreen,
      download,
      print,
      openInNewTab: openExternalTab,
    }),
    [
      item, url, numPages, docState, page, goToPage, effectiveScale, wheelZoomTo,
      fit, zoom, zoomBy, resetZoom, rotation, rotate, scrollEl, shellEl,
      pagesOpen, togglePagesFn, infoOpen, toggleInfoFn, shareOpen, toggleShareFn,
      paletteOpen, searchOpen, query, resultsByPage, flatResults, resultsTruncated,
      searching, searchProgressPage, activeResult, openSearch, closeSearch,
      gotoResult, nextResult, prevResult, focusMode, toggleFocus, isFullscreen,
      toggleFullscreen, closeViewerAndExitFullscreen, chromeVisible, reportActivity, onShare, onClose,
      download, print, openExternalTab,
    ]
  );

  return (
    <ViewerContext.Provider value={value}>
      <div
        ref={(el) => {
          shellRef.current = el;
          setShellEl(el);
        }}
        className={`doc-shell relative flex h-full min-h-0 w-full flex-col overflow-hidden outline-none ${isFullscreen && chromeIdle && !anyPanelOpen ? "cursor-none" : ""}`}
        data-focus={focusMode || undefined}
        data-fullscreen={isFullscreen || undefined}
        onMouseMove={reportActivity}
        onPointerDown={reportActivity}
        onWheel={reportActivity}
        tabIndex={-1}
        role="application"
        aria-label={`Document viewer: ${item.name}`}
      >
        <DocumentCanvas />

        {/* Focus-mode minimal page indicator — the only permanent UI left */}
        {focusMode && (
          <button
            onClick={toggleFocus}
            className="doc-glass fixed bottom-4 left-1/2 z-30 h-7 -translate-x-1/2 rounded-full px-3 font-mono text-[11px] tabular-nums text-[var(--doc-muted)] transition-opacity hover:text-[var(--doc-text)]"
            aria-label="Exit focus mode"
          >
            {page} / {Math.max(numPages, 1)}
          </button>
        )}

        <FloatingHeader />
        <PageNavigator variant="rail" />
        <PageNavigator variant="sheet" />
        <FloatingControls />
        <SearchPanel />
        <DocumentInfoPanel />
        <ShareSheet />
        <SelectionToolbar />
        <CommandPalette />
        <ViewerStatus />
      </div>
    </ViewerContext.Provider>
  );
}

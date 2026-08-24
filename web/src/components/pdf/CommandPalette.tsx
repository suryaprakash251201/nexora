import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  ChevronLast,
  ChevronFirst,
  CornerDownLeft,
  Download,
  ExternalLink,
  Focus,
  Info,
  Maximize,
  Minimize,
  MoveHorizontal,
  PanelLeft,
  Plus,
  Minus,
  Printer,
  RotateCw,
  Search,
  Share2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useViewer } from "./ctx";
import { fuzzyScore, padPage } from "./utils";
import { cn } from "@/lib/utils";

interface PaletteAction {
  id: string;
  label: string;
  group: string;
  icon: React.ReactNode;
  shortcut?: string;
  keywords?: string;
  run(): void;
}

/**
 * Document Command bar (Ctrl+K): fuzzy-matched actions scoped to the
 * open document — navigation, view state, and host actions. Typing a bare
 * number surfaces "Go to page N" as the top action.
 */
export function CommandPalette() {
  const viewer = useViewer();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const actions = useMemo<PaletteAction[]>(() => {
    const a: PaletteAction[] = [
      { id: "next", group: "Navigate", label: "Next page", icon: <ArrowRight className="h-4 w-4" />, shortcut: "→", run: () => viewer.goToPage(viewer.page + 1) },
      { id: "prev", group: "Navigate", label: "Previous page", icon: <ArrowRight className="h-4 w-4 rotate-180" />, shortcut: "←", run: () => viewer.goToPage(viewer.page - 1) },
      { id: "first", group: "Navigate", label: "First page", icon: <ChevronFirst className="h-4 w-4" />, run: () => viewer.goToPage(1) },
      { id: "last", group: "Navigate", label: "Last page", icon: <ChevronLast className="h-4 w-4" />, run: () => viewer.goToPage(viewer.numPages) },
      { id: "zoom-in", group: "View", label: "Zoom in", icon: <Plus className="h-4 w-4" />, shortcut: "Ctrl +", keywords: "bigger larger", run: () => viewer.zoomBy(1.2) },
      { id: "zoom-out", group: "View", label: "Zoom out", icon: <Minus className="h-4 w-4" />, shortcut: "Ctrl −", keywords: "smaller smaller", run: () => viewer.zoomBy(1 / 1.2) },
      { id: "reset-zoom", group: "View", label: "Actual size · 100%", icon: <Minus className="h-4 w-4 opacity-40" />, shortcut: "Ctrl 0", keywords: "reset zoom one hundred real size", run: () => viewer.resetZoom() },
      { id: "fit-width", group: "View", label: "Fit width", icon: <MoveHorizontal className="h-4 w-4" />, keywords: "fill horizontal", run: () => viewer.setFit("width") },
      { id: "fit-page", group: "View", label: "Fit page", icon: <Maximize className="h-4 w-4" />, keywords: "whole entire", run: () => viewer.setFit("page") },
      { id: "rotate", group: "View", label: "Rotate clockwise", icon: <RotateCw className="h-4 w-4" />, keywords: "turn landscape", run: () => viewer.rotate(1) },
      { id: "pages", group: "View", label: viewer.pagesOpen ? "Hide pages panel" : "Show pages panel", icon: <PanelLeft className="h-4 w-4" />, shortcut: "P", keywords: "thumbnails sidebar navigator", run: () => viewer.togglePages() },
      { id: "focus", group: "View", label: viewer.focusMode ? "Exit focus mode" : "Focus mode", icon: <Focus className="h-4 w-4" />, shortcut: "F", keywords: "immersive reading distraction free zen", run: () => viewer.toggleFocus() },
      { id: "fullscreen", group: "View", label: viewer.isFullscreen ? "Exit fullscreen" : "Fullscreen", icon: viewer.isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />, keywords: "expand full screen", run: () => viewer.toggleFullscreen() },
      { id: "info", group: "Document", label: "Document information", icon: <Info className="h-4 w-4" />, shortcut: "I", keywords: "metadata details properties about", run: () => viewer.toggleInfo(true) },
      { id: "share", group: "Actions", label: "Share", icon: <Share2 className="h-4 w-4" />, keywords: "link collaborate", run: () => viewer.toggleShare(true) },
      { id: "download", group: "Actions", label: "Download", icon: <Download className="h-4 w-4" />, keywords: "save export", run: () => viewer.download() },
      { id: "print", group: "Actions", label: "Print…", icon: <Printer className="h-4 w-4" />, shortcut: "Ctrl P", run: () => viewer.print() },
      { id: "newtab", group: "Actions", label: "Open in new tab", icon: <ExternalLink className="h-4 w-4" />, keywords: "browser external system", run: () => viewer.openInNewTab() },
    ];
    // Bare-number query → "Go to page N" as the first action.
    const m = /^(\d{1,4})$/.exec(query.trim());
    if (m && viewer.numPages > 0) {
      const n = parseInt(m[1], 10);
      a.unshift({
        id: "goto",
        group: "Navigate",
        label: `Go to page ${Math.min(n, viewer.numPages)}${n > viewer.numPages ? ` (max ${viewer.numPages})` : ""}`,
        icon: <span className="grid h-4 w-6 place-items-center font-mono text-[11px] tabular-nums">{padPage(Math.min(n, viewer.numPages))}</span>,
        run: () => viewer.goToPage(n),
      });
    }
    return a;
  }, [viewer, query]);

  const filtered = useMemo(() => {
    if (!query.trim()) return actions;
    return actions
      .map((action) => ({ action, score: Math.max(fuzzyScore(query, action.label), fuzzyScore(query, `${action.group} ${action.keywords ?? ""}`) - 1.5) }))
      .filter((x) => x.score >= 0)
      .sort((x, y) => y.score - x.score)
      .map((x) => x.action);
  }, [actions, query]);

  // Reset selection whenever the result set changes.
  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    if (viewer.paletteOpen) {
      setQuery("");
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [viewer.paletteOpen]);

  const runAt = (i: number) => {
    const action = filtered[i];
    if (!action) return;
    viewer.setPaletteOpen(false);
    action.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(index);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-selected='true']")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  let lastGroup = "";

  return (
    <AnimatePresence>
      {viewer.paletteOpen && (
        <div className="absolute inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Document commands">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={() => viewer.setPaletteOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="doc-glass relative w-full max-w-xl overflow-hidden rounded-2xl"
          >
            <div className="flex items-center gap-3 border-b border-[var(--doc-border)] px-4">
              <Search className="h-4 w-4 shrink-0 text-[var(--doc-faint)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search commands, or type a page number…"
                aria-label="Command input"
                autoComplete="off"
                spellCheck={false}
                className="h-12 min-w-0 flex-1 bg-transparent text-sm text-[var(--doc-text)] outline-none placeholder:text-[var(--doc-faint)]"
              />
              <kbd className="doc-kbd">esc</kbd>
            </div>

            <div ref={listRef} className="doc-scroll max-h-[46vh] overflow-y-auto p-1.5">
              {filtered.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-[var(--doc-faint)]">No matching commands</p>
              )}
              {filtered.map((action, i) => {
                const showGroup = action.group !== lastGroup;
                lastGroup = action.group;
                return (
                  <div key={action.id}>
                    {showGroup && (
                      <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-[0.14em] text-[var(--doc-faint)] uppercase">
                        {action.group}
                      </p>
                    )}
                    <button
                      data-selected={i === index}
                      onMouseMove={() => setIndex(i)}
                      onClick={() => runAt(i)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors",
                        i === index ? "bg-[var(--doc-accent)]/14 text-[var(--doc-text)]" : "text-[var(--doc-muted)] hover:bg-white/5"
                      )}
                    >
                      <span className={cn("shrink-0", i === index && "text-[var(--doc-accent)]")}>{action.icon}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{action.label}</span>
                      {action.shortcut && <kbd className="doc-kbd">{action.shortcut}</kbd>}
                      {i === index && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-[var(--doc-faint)]" />}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-4 border-t border-[var(--doc-border)] px-4 py-2 text-[11px] text-[var(--doc-faint)]">
              <span className="flex items-center gap-1.5"><ArrowUp className="h-3 w-3 rotate-180" /><ArrowUp className="h-3 w-3" /> navigate</span>
              <span className="flex items-center gap-1.5"><CornerDownLeft className="h-3 w-3" /> select</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

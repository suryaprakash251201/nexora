import { useEffect, useRef, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useViewer } from "./ctx";

/**
 * Contextual selection toolbar — a compact pill that appears above selected
 * text inside the document canvas with quick actions (copy, find in doc).
 * Deliberately small: it should never compete with the text being read.
 */
export function SelectionToolbar() {
  const viewer = useViewer();
  const [state, setState] = useState<{ x: number; y: number; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!viewer.searchOpen && !viewer.paletteOpen) return;
    // Panels take precedence — drop the pill while they're up.
    setState(null);
  }, [viewer.searchOpen, viewer.paletteOpen]);

  useEffect(() => {
    let raf = 0;

    const scheduleHide = () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => setState(null), 120);
    };

    const onSelectionChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          scheduleHide();
          return;
        }
        const text = sel.toString().trim();
        if (!text || text.length > 400) {
          scheduleHide();
          return;
        }
        // Only react to selections that live inside the document canvas.
        const anchorEl = sel.anchorNode?.parentElement;
        if (!anchorEl?.closest(".doc-page")) {
          scheduleHide();
          return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (!rect.width) {
          scheduleHide();
          return;
        }
        setCopied(false);
        setState({
          x: Math.min(Math.max(rect.left + rect.width / 2, 90), window.innerWidth - 90),
          y: rect.top,
          text,
        });
      });
    };

    const onHide = () => setState(null);
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("resize", onHide);
    window.addEventListener("keydown", onKeyHide);

    function onKeyHide(e: KeyboardEvent) {
      // Any key interaction other than modifiers dismisses the pill.
      if (!e.altKey && !e.ctrlKey && !e.metaKey) setState(null);
    }

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("resize", onHide);
      window.removeEventListener("keydown", onKeyHide);
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Dismiss when the canvas scrolls under the selection.
  useEffect(() => {
    const el = viewer.scrollEl;
    if (!el) return;
    const hide = () => setState(null);
    el.addEventListener("scroll", hide, { passive: true });
    return () => el.removeEventListener("scroll", hide);
  }, [viewer.scrollEl]);

  const copy = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.text);
      setCopied(true);
      setTimeout(() => setState(null), 700);
    } catch {
      /* clipboard unavailable */
    }
  };

  const searchDoc = () => {
    if (!state) return;
    const q = state.text.replace(/\s+/g, " ").slice(0, 64);
    viewer.openSearch(q);
    setState(null);
  };

  return (
    <AnimatePresence>
      {state && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.96 }}
          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          className="doc-glass fixed z-[65] flex -translate-x-1/2 items-center gap-0.5 rounded-xl p-1"
          style={{ left: state.x, top: Math.max(8, state.y - 46) }}
          role="toolbar"
          aria-label="Selection actions"
        >
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={copy}
            className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-[var(--doc-text)] transition-colors hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[var(--doc-accent)]/50 outline-none"
            aria-label="Copy selection"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <div className="h-4 w-px bg-white/10" aria-hidden />
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={searchDoc}
            className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-[var(--doc-text)] transition-colors hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-[var(--doc-accent)]/50 outline-none"
            aria-label="Find in document"
          >
            <Search className="h-3.5 w-3.5" />
            Find in document
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

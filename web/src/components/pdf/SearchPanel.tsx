import { useEffect, useMemo, useRef } from "react";
import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useViewer } from "./ctx";
import { cn } from "@/lib/utils";

const MAX_RENDERED = 120;

/**
 * Floating document search — debounced full-text scan with live results,
 * page badges, snippet previews with highlighted terms, and prev/next
 * match cycling. Replaces the browser's native find UI.
 */
export function SearchPanel() {
  const viewer = useViewer();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field whenever the panel opens.
  useEffect(() => {
    if (viewer.searchOpen) requestAnimationFrame(() => inputRef.current?.focus());
  }, [viewer.searchOpen]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) viewer.prevResult();
      else viewer.nextResult();
    }
  };

  const total = viewer.flatResults.length;
  const positionLabel = useMemo(() => {
    if (viewer.searching) return `page ${viewer.searchProgressPage}…`;
    if (total === 0) return null;
    if (viewer.activeResult < 0) return String(total);
    return `${viewer.activeResult + 1} / ${total}`;
  }, [viewer.searching, viewer.searchProgressPage, total, viewer.activeResult]);

  return (
    <AnimatePresence>
      {viewer.searchOpen && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          role="dialog"
          aria-label="Document search"
          className="doc-glass absolute top-[72px] right-4 z-[60] flex max-h-[68vh] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl sm:right-5"
        >
          {/* Input row */}
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--doc-border)] px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-[var(--doc-faint)]" />
            <input
              ref={inputRef}
              value={viewer.query}
              onChange={(e) => viewer.setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search this document…"
              aria-label="Search this document"
              autoComplete="off"
              spellCheck={false}
              className="h-8 min-w-0 flex-1 bg-transparent text-sm text-[var(--doc-text)] outline-none placeholder:text-[var(--doc-faint)]"
            />
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--doc-faint)]">{positionLabel}</span>
            <button onClick={() => viewer.prevResult()} disabled={total === 0} className="doc-btn size-7" aria-label="Previous match (Shift+Enter)">
              <ChevronUp className="h-4 w-4" />
            </button>
            <button onClick={() => viewer.nextResult()} disabled={total === 0} className="doc-btn size-7" aria-label="Next match (Enter)">
              <ChevronDown className="h-4 w-4" />
            </button>
            <button onClick={() => viewer.closeSearch()} className="doc-btn size-7" aria-label="Close search (Escape)">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Results */}
          <div className="doc-scroll min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-label="Search results">
            {viewer.searching && total === 0 && (
              <p className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-[var(--doc-faint)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching page {viewer.searchProgressPage}…
              </p>
            )}
            {!viewer.searching && viewer.query.trim().length > 0 && total === 0 && (
              <p className="px-3 py-8 text-center text-sm text-[var(--doc-faint)]">
                No matches for “{viewer.query.trim()}”
              </p>
            )}
            {viewer.query.trim().length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-[var(--doc-faint)]">
                Type to search across {viewer.numPages} pages
              </p>
            )}

            {viewer.flatResults.slice(0, MAX_RENDERED).map((match, i) => {
              const active = i === viewer.activeResult;
              return (
                <button
                  key={`${match.page}:${i}`}
                  role="option"
                  aria-selected={active}
                  onClick={() => viewer.gotoResult(i)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors",
                    active ? "bg-[var(--doc-accent)]/14" : "hover:bg-white/5"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-5 shrink-0 place-items-center rounded-md px-1.5 font-mono text-[10px] font-semibold tabular-nums",
                      active
                        ? "bg-[var(--doc-accent)] text-white"
                        : "bg-white/[0.07] text-[var(--doc-muted)]"
                    )}
                  >
                    {match.page}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-[var(--doc-muted)]">
                    …{match.before}
                    <mark className={cn("rounded-[2px] px-0", active ? "bg-transparent font-semibold text-[var(--doc-text)] underline decoration-[var(--doc-accent)] decoration-2 underline-offset-2" : "bg-transparent font-semibold text-[var(--doc-text)]")}>
                      {match.match}
                    </mark>
                    {match.after}…
                  </span>
                </button>
              );
            })}

            {viewer.flatResults.length > MAX_RENDERED && (
              <p className="px-3 py-2 text-center text-[11px] text-[var(--doc-faint)]">
                +{viewer.flatResults.length - MAX_RENDERED} more matches — refine your search
              </p>
            )}
          </div>

          {/* Footer hint */}
          {(total > 0 || viewer.resultsTruncated) && (
            <div className="flex shrink-0 items-center justify-between border-t border-[var(--doc-border)] px-3 py-1.5 text-[11px] text-[var(--doc-faint)]">
              <span>
                {total} {total === 1 ? "result" : "results"}
                {viewer.resultsTruncated ? "+" : ""}
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="doc-kbd">↵</kbd> next
                <kbd className="doc-kbd">⇧ ↵</kbd> prev
              </span>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

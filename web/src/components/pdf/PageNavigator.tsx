import { useEffect, memo, useRef } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useViewer } from "./ctx";
import { DEFAULT_PAGE_SIZE, type PageSize } from "./types";
import { cn } from "@/lib/utils";

const THUMB_WIDTH = 112;
const THUMB_DPR_CAP = 1.5;
/** Cached rendered thumbnails (LRU) so reopening the panel is instant. */
const THUMB_CACHE_LIMIT = 90;
const thumbCache = new Map<string, HTMLCanvasElement>();
const docIds = new WeakMap<PDFDocumentProxy, number>();
let nextDocId = 1;

function docUid(doc: PDFDocumentProxy): number {
  let id = docIds.get(doc);
  if (!id) {
    id = nextDocId++;
    docIds.set(doc, id);
  }
  return id;
}

/**
 * Smart page navigator — a floating slide-out workspace panel on desktop,
 * a bottom sheet on mobile. Thumbnails render lazily via IntersectionObserver
 * and are LRU-cached across open/close cycles.
 */
export function PageNavigator({ variant }: { variant: "rail" | "sheet" }) {
  const viewer = useViewer();
  const listRef = useRef<HTMLDivElement>(null);

  const isRail = variant === "rail";

  // Keep the active thumbnail in view as pages change.
  useEffect(() => {
    if (!viewer.pagesOpen) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-thumb="${viewer.page}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [viewer.page, viewer.pagesOpen]);

  return (
    <AnimatePresence>
      {viewer.pagesOpen && (
        <>
          {/* Sheet backdrop (mobile only) */}
          {!isRail && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 z-30 bg-black/45 md:hidden"
              onClick={() => viewer.togglePages(false)}
            />
          )}

          <motion.div
            role="complementary"
            aria-label="Page navigator"
            initial={isRail ? { opacity: 0, x: -18 } : { opacity: 0, y: 60 }}
            animate={isRail ? { opacity: 1, x: 0 } : { opacity: 1, y: 0 }}
            exit={isRail ? { opacity: 0, x: -18 } : { opacity: 0, y: 60 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "doc-glass z-40 flex flex-col overflow-hidden",
              isRail
                ? "absolute top-20 bottom-28 left-4 w-[232px] rounded-2xl max-md:hidden"
                : "absolute inset-x-2 bottom-2 h-[56vh] rounded-t-3xl md:hidden"
            )}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--doc-border)] px-3.5 py-2.5">
              <div>
                <p className="text-[13px] font-semibold text-[var(--doc-text)]">Pages</p>
                <p className="text-[11px] text-[var(--doc-faint)]">{viewer.numPages} total</p>
              </div>
              {!isRail && (
                <button onClick={() => viewer.togglePages(false)} className="doc-btn size-8" aria-label="Close page navigator">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Thumbnail list */}
            <div ref={listRef} className="doc-scroll flex-1 space-y-2.5 overflow-y-auto p-3">
              {viewer.doc &&
                (() => {
                  const currentDoc = viewer.doc;
                  return Array.from({ length: Math.min(viewer.numPages, 500) }, (_, i) => (
                    <ThumbButton
                      key={i + 1}
                      doc={currentDoc}
                      pageNumber={i + 1}
                      size={viewer.sizes[i]}
                      active={viewer.page === i + 1}
                      onSelect={() => {
                        viewer.goToPage(i + 1);
                        viewer.togglePages(false);
                      }}
                    />
                  ));
                })()}
              {viewer.numPages > 500 && (
                <p className="pt-1 text-center text-[11px] text-[var(--doc-faint)]">
                  +{viewer.numPages - 500} more pages — use search or go-to-page
                </p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const ThumbButton = memo(function ThumbButton({
  doc,
  pageNumber,
  size,
  active,
  onSelect,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  size: PageSize | undefined;
  active: boolean;
  onSelect: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const slotRef = useRef<HTMLSpanElement>(null);
  const effSize = size ?? DEFAULT_PAGE_SIZE;
  const aspect = effSize.height / effSize.width;

  useEffect(() => {
    const el = btnRef.current;
    const slot = slotRef.current;
    if (!el || !slot) return;

    const key = `${docUid(doc)}:${pageNumber}:${THUMB_WIDTH}`;

    let cancelled = false;
    let task: RenderTask | null = null;

    // Adopt a cached (or freshly rendered) canvas into this button's slot.
    function adopt(canvas: HTMLCanvasElement) {
      io.disconnect();
      if (cancelled || !slotRef.current) return;
      slotRef.current.replaceChildren(canvas.cloneNode(true) as HTMLCanvasElement);
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (cancelled) return;
        const cacheHit = thumbCache.get(key);
        if (cacheHit) {
          adopt(cacheHit);
          return;
        }
        doc
          .getPage(pageNumber)
          .then((page) => {
            if (cancelled) return;
            const vp1 = page.getViewport({ scale: 1 });
            const dpr = Math.min(THUMB_DPR_CAP, window.devicePixelRatio || 1);
            const vp = page.getViewport({ scale: (THUMB_WIDTH / vp1.width) * dpr });
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.floor(vp.width));
            canvas.height = Math.max(1, Math.floor(vp.height));
            canvas.style.width = `${THUMB_WIDTH}px`;
            task = page.render({ canvas, viewport: vp });
            return task.promise.then(() => {
              if (cancelled) return;
              // LRU insert.
              thumbCache.set(key, canvas);
              if (thumbCache.size > THUMB_CACHE_LIMIT) {
                const oldest = thumbCache.keys().next().value as string | undefined;
                if (oldest && oldest !== key) thumbCache.delete(oldest);
              }
              adopt(canvas);
            });
          })
          .catch(() => {});
      },
      { rootMargin: "420px 0px" }
    );
    io.observe(el);

    // Cache hits resolve immediately, before the observer would fire.
    const cached = thumbCache.get(key);
    if (cached) adopt(cached);

    return () => {
      cancelled = true;
      io.disconnect();
      task?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber]);

  return (
    <button
      ref={btnRef}
      data-thumb={pageNumber}
      onClick={onSelect}
      title={`Page ${pageNumber}`}
      aria-label={`Go to page ${pageNumber}`}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group mx-auto block w-fit rounded-lg p-1 outline-none transition-all focus-visible:ring-2 focus-visible:ring-[var(--doc-accent)]",
        active ? "bg-[var(--doc-accent)]/12" : "hover:bg-white/5"
      )}
    >
      <span
        className={cn(
          "relative block overflow-hidden rounded-md bg-white shadow-sm outline outline-1 transition-all",
          active
            ? "outline-2 outline-[var(--doc-accent)]"
            : "outline-black/10 group-hover:outline-black/25"
        )}
        style={{ width: THUMB_WIDTH, height: Math.round(THUMB_WIDTH * aspect) }}
      >
        <span ref={slotRef} className="block h-full w-full [&>canvas]:block [&>canvas]:h-auto [&>canvas]:w-full" />
        {!size && <span className="doc-shimmer absolute inset-0" aria-hidden />}
      </span>
      <span
        className={cn(
          "mt-1 block text-center font-mono text-[10px] tabular-nums",
          active ? "font-semibold text-[var(--doc-accent)]" : "text-[var(--doc-faint)]"
        )}
      >
        {pageNumber}
      </span>
    </button>
  );
});

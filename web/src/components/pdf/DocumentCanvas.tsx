import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MatchSegment, PageSize } from "./types";
import { DEFAULT_PAGE_SIZE } from "./types";
import { PdfPage } from "./PdfPage";
import { useViewer } from "./ctx";
import { clamp } from "./utils";

const GAP_Y = 20;
const PAD_Y = 40;
/** Horizontal breathing room around the page (kept clear of the scrollbar). */
const PAD_X = 48;
const ZOOM_STEP = 1.2;

interface Measured {
  width: number;
  height: number;
}

/**
 * The immersive document canvas: a continuously scrollable stack of lazily
 * rendered pages with active-page synchronization, anchor-stable Ctrl+wheel
 * zoom, and smooth programmatic navigation.
 */
export function DocumentCanvas() {
  const viewer = useViewer();
  const { doc, numPages, sizes, page, fit, zoom, rotation } = viewer;

  const containerRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Measured>({ width: 0, height: 0 });

  // Scroll-sync plumbing: the last page index WE reported upward. Programmatic
  // navigations set it too, so the scroll effect doesn't fight scroll sync.
  const lastReportedPageRef = useRef(page);
  const scrollRafRef = useRef<number | null>(null);
  // Anchor for cursor-stable wheel zooming; consumed by the layout effect.
  const wheelAnchorRef = useRef<{ clientX: number; clientY: number; scale: number } | null>(null);
  const restoreRatioRef = useRef<{ ratio: number } | null>(null);
  const firstLayoutRef = useRef(true);

  // Expose the scroll element to scroll-aware overlays.
  useEffect(() => {
    viewer.attachScrollEl(containerRef.current);
    return () => viewer.attachScrollEl(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Container measurement ────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      if (fit === "none") {
        // Preserve reading position proportionally when the viewport resizes
        // while zoomed (fit modes recompute anyway).
        const h = el.scrollHeight;
        if (h > 0) restoreRatioRef.current = { ratio: (el.scrollTop + el.clientHeight / 2) / h };
      }
      setMeasured({ width: r.width, height: r.height });
    });
    ro.observe(el);
    setMeasured({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, [fit]);

  const currentPageSize: PageSize = sizes[page - 1] ?? sizes[0] ?? DEFAULT_PAGE_SIZE;

  // ── Effective scale from fit mode + measured viewport ────────────────
  const effectiveScale = useMemo(() => {
    const d = swappedSize(currentPageSize, rotation);
    const availW = Math.max(80, measured.width - PAD_X * 2);
    const availH = Math.max(80, measured.height - PAD_Y * 2);
    if (fit === "page") return Math.min(availW / d.width, availH / d.height);
    if (fit === "width") return availW / d.width;
    return zoom;
  }, [currentPageSize, rotation, measured, fit, zoom]);

  // Report upward for header/dock/palette display + wheel math.
  const prevEffRef = useRef(effectiveScale);
  useEffect(() => {
    if (prevEffRef.current !== effectiveScale) {
      prevEffRef.current = effectiveScale;
      viewer.setEffectiveScale(effectiveScale);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveScale]);

  // ── Layout geometry (prefix offsets for O(log n) page lookup) ────────
  // Mirrors the flow layout below exactly: padY + Σ round(h·scale) + GAP.
  const tops = useMemo(() => {
    const arr = new Float64Array(numPages + 1);
    let y = PAD_Y;
    for (let i = 1; i <= numPages; i++) {
      arr[i - 1] = y;
      const s = sizes[i - 1] ?? sizes[0] ?? DEFAULT_PAGE_SIZE;
      y += Math.round(swappedSize(s, rotation).height * effectiveScale) + GAP_Y;
    }
    arr[numPages] = y;
    return arr;
  }, [numPages, sizes, rotation, effectiveScale]);

  // ── Post-layout scroll corrections ───────────────────────────────────
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || numPages === 0 || effectiveScale <= 0) return;

    // Wheel-zoom anchor: keep the point under the cursor stationary.
    const anchor = wheelAnchorRef.current;
    wheelAnchorRef.current = null;
    if (anchor && !firstLayoutRef.current) {
      const rect = el.getBoundingClientRect();
      const viewX = anchor.clientX - rect.left;
      const viewY = anchor.clientY - rect.top;
      const ratio = effectiveScale / anchor.scale;
      el.scrollLeft = (el.scrollLeft + viewX) * ratio - viewX;
      el.scrollTop = (el.scrollTop + viewY) * ratio - viewY;
      firstLayoutRef.current = false;
      return;
    }

    // Fit/zoom/rotation changes: restore the centered reading position.
    const r = restoreRatioRef.current;
    restoreRatioRef.current = null;
    if (r && !firstLayoutRef.current) {
      el.scrollTop = clamp(r.ratio * el.scrollHeight - el.clientHeight / 2, 0, Infinity);
    }

    // Programmatic navigation: bring the requested page into view.
    if (lastReportedPageRef.current !== page) {
      lastReportedPageRef.current = page;
      const target = tops[page - 1] ?? 0;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const distance = Math.abs(target - el.scrollTop);
      el.scrollTo({
        top: Math.max(0, target - PAD_Y * 0.75),
        behavior: reduced || distance > 12_000 ? "auto" : "smooth",
      });
    }
    firstLayoutRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tops, page, numPages]);

  // ── Scroll → active page sync ────────────────────────────────────────
  const onScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = containerRef.current;
      if (!el || numPages === 0) return;
      const probe = el.scrollTop + el.clientHeight * 0.38;
      let lo = 0;
      let hi = numPages - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tops[mid] <= probe) lo = mid;
        else hi = mid - 1;
      }
      const detected = lo + 1;
      if (detected !== page && detected >= 1 && detected <= numPages) {
        lastReportedPageRef.current = detected;
        viewer.setPage(detected);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tops, numPages, page]);

  // ── Ctrl/Meta+wheel → anchored zoom ──────────────────────────────────
  const effRef = useRef(effectiveScale);
  effRef.current = effectiveScale;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
      // Scale relative to what's currently on screen so switching from a fit
      // mode to free zoom doesn't jump.
      wheelAnchorRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        scale: effRef.current,
      };
      viewer.wheelZoomTo(clamp(effRef.current * factor, 0.25, 8));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    },
    []
  );

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="doc-scroll relative flex-1 min-w-0 overflow-auto overscroll-contain outline-none"
      role="document"
      aria-label="Document pages"
    >
      {doc && numPages > 0 && (
        <div
          className="mx-auto flex w-max min-w-full flex-col items-center"
          style={{ paddingTop: PAD_Y, paddingBottom: 96, gap: GAP_Y }}
        >
          {Array.from({ length: numPages }, (_, i) => {
            const n = i + 1;
            const pageMatches = viewer.resultsByPage.get(n);
            // Flatten this page's matches into one segment list; the active
            // ordinal points at the active match's first segment.
            let segments: MatchSegment[] | null = null;
            let activeOrdinal = -1;
            if (pageMatches) {
              segments = pageMatches.flatMap((m) => m.segments);
              if (viewer.activeResult >= 0) {
                const activeMatch = viewer.flatResults[viewer.activeResult];
                if (activeMatch && activeMatch.page === n) {
                  const idxInPage = pageMatches.indexOf(activeMatch);
                  if (idxInPage >= 0) {
                    activeOrdinal = pageMatches
                      .slice(0, idxInPage)
                      .reduce((sum, m) => sum + m.segments.length, 0);
                  }
                }
              }
            }
            return (
              <PdfPage
                key={n}
                doc={doc}
                pageNumber={n}
                size={sizes[i]}
                scale={effectiveScale}
                rotation={rotation}
                isActive={page === n}
                segments={segments}
                activeOrdinal={activeOrdinal}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Dimensions after applying user rotation. */
function swappedSize(s: PageSize, rotation: number): PageSize {
  return rotation % 180 !== 0 ? { width: s.height, height: s.width } : s;
}

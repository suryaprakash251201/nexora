import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import type { PDFDocumentProxy, RenderTask, TextLayer as TextLayerType } from "pdfjs-dist";
import type { MatchSegment, PageSize } from "./types";
import { DEFAULT_PAGE_SIZE } from "./types";
import { applyHighlights, clearHighlights } from "./textHighlight";
import { getPdfModule } from "./usePdfDocument";

const DPR_CAP = 2;
/** Distance beyond the viewport (px) at which pages are asked to render. */
const RENDER_MARGIN = "1100px 0px";
/** How long an offscreen page keeps its bitmap before being released. */
const BITMAP_TTL_MS = 45_000;

export interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /** Unrotated size at scale 1; falls back to A4 until discovered. */
  size: PageSize | undefined;
  /** Effective CSS scale for this layout pass. */
  scale: number;
  /** User rotation in degrees (0/90/180/270). */
  rotation: number;
  isActive: boolean;
  /** Highlight segments for this page (null = no active search). */
  segments: MatchSegment[] | null;
  /** Ordinal of the globally-active match within `segments` (-1 = none). */
  activeOrdinal: number;
}

/**
 * One page of the document canvas: a correctly-sized placeholder that lazy-
 * renders its bitmap + selectable text layer via IntersectionObserver, and
 * releases the bitmap after staying offscreen for a while.
 */
export const PdfPage = memo(function PdfPage({
  doc,
  pageNumber,
  size,
  scale,
  rotation,
  isActive,
  segments,
  activeOrdinal,
}: PdfPageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const textLayerInstanceRef = useRef<TextLayerType | null>(null);
  const gcTimerRef = useRef<number | null>(null);
  const lastAppliedActiveRef = useRef<string>("");
  const prevRotationRef = useRef(rotation);

  const [visible, setVisible] = useState(false);
  const [bitmapReady, setBitmapReady] = useState(false);
  const [textReady, setTextReady] = useState(false);

  const effectiveSize = size ?? DEFAULT_PAGE_SIZE;
  const swapped = rotation % 180 !== 0;
  const cssW = Math.max(1, Math.round((swapped ? effectiveSize.height : effectiveSize.width) * scale));
  const cssH = Math.max(1, Math.round((swapped ? effectiveSize.width : effectiveSize.height) * scale));

  // ── Visibility → render / release lifecycle ──────────────────────────
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries.some((e) => e.isIntersecting);
        setVisible(isIntersecting);
        if (!isIntersecting) {
          // Schedule bitmap release; cancelled promptly if it returns.
          if (gcTimerRef.current === null) {
            gcTimerRef.current = window.setTimeout(() => {
              gcTimerRef.current = null;
              // Drop the decoded bitmap, not just its visibility.
              const canvas = canvasRef.current;
              if (canvas) {
                canvas.width = 1;
                canvas.height = 1;
              }
              setBitmapReady(false);
              setTextReady(false);
            }, BITMAP_TTL_MS);
          }
        } else if (gcTimerRef.current !== null) {
          window.clearTimeout(gcTimerRef.current);
          gcTimerRef.current = null;
        }
      },
      { rootMargin: RENDER_MARGIN }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (gcTimerRef.current !== null) {
        window.clearTimeout(gcTimerRef.current);
        gcTimerRef.current = null;
      }
    };
  }, []);

  // ── Render bitmap + build/update the text layer ─────────────────────
  const renderGenRef = useRef(0);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    const run = async () => {
      try {
        // Generation token: only the newest invocation may touch the DOM.
        const gen = ++renderGenRef.current;
        const stale = () => cancelled || renderGenRef.current !== gen;

        const page = await doc.getPage(pageNumber);
        if (stale()) return;

        const baseRotation = ((page.rotate ?? 0) + rotation) % 360;
        const vp1 = page.getViewport({ scale: 1, rotation: baseRotation });
        const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);

        // Bitmap — backing store at device pixels, CSS size at layout pixels.
        const canvas = canvasRef.current;
        if (!canvas) return;
        const vp = page.getViewport({ scale: scale * dpr, rotation: baseRotation });
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        canvas.style.width = `${Math.floor(scale * vp1.width)}px`;
        canvas.style.height = `${Math.floor(scale * vp1.height)}px`;

        if (renderTaskRef.current) renderTaskRef.current.cancel();
        const task = page.render({ canvas, viewport: vp });
        renderTaskRef.current = task;
        await task.promise;
        if (stale()) return;
        setBitmapReady(true);

        // Text layer — rebuild on rotation (layout changes fundamentally),
        // update in place on zoom (cheap reflow of existing spans).
        const container = textLayerRef.current;
        if (!container) return;
        const tlVp = page.getViewport({ scale, rotation: baseRotation });
        const prev = textLayerInstanceRef.current;
        if (prev && prevRotationRef.current === rotation && !stale()) {
          prev.update({ viewport: tlVp });
          if (stale()) return;
          setTextReady(true);
        } else {
          prev?.cancel();
          textLayerInstanceRef.current = null;
          container.replaceChildren();
          setTextReady(false); // force the highlight pass to rerun after rebuild
          const { TextLayer } = await getPdfModule();
          if (stale()) return;
          const tl = new TextLayer({
            textContentSource: page.streamTextContent(),
            container,
            viewport: tlVp,
          });
          textLayerInstanceRef.current = tl as TextLayerType;
          await tl.render();
          if (stale()) return;
          setTextReady(true);
        }
        prevRotationRef.current = rotation;
      } catch (err) {
        if ((err as Error)?.name === "RenderingCancelledException" || cancelled) return;
        console.error(`DocumentSpace: render failed for page ${pageNumber}`, err);
      }
    };
    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, visible, scale, rotation]);

  // Cancel in-flight work when leaving / unmounting.
  useEffect(() => {
    if (visible) return;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
  }, [visible]);

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel();
      textLayerInstanceRef.current?.cancel();
    };
  }, []);

  // ── Search highlighting ──────────────────────────────────────────────
  const segmentsKey = segments ? JSON.stringify(segments) : "";
  useEffect(() => {
    const container = textLayerRef.current;
    if (!container) return;
    if (!segments || segments.length === 0 || !textReady) {
      clearHighlights(container);
      lastAppliedActiveRef.current = "";
      return;
    }
    const activeEl = applyHighlights(container, segments, activeOrdinal);
    const activeId = activeOrdinal >= 0 ? `${pageNumber}:${activeOrdinal}` : "";
    if (activeEl && activeId !== lastAppliedActiveRef.current) {
      lastAppliedActiveRef.current = activeId;
      requestAnimationFrame(() =>
        activeEl.scrollIntoView({ block: "center", behavior: "smooth" })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentsKey, activeOrdinal, textReady]);

  return (
    <div
      ref={wrapperRef}
      data-page={pageNumber}
      className="doc-page"
      style={{ width: cssW, height: cssH }}
      aria-label={`Page ${pageNumber}`}
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${
          bitmapReady ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={textLayerRef}
        className="textLayer"
        style={{ "--total-scale-factor": scale } as CSSProperties}
      />
      {/* Soft ring on the current page while navigating */}
      {isActive && (
        <div className="pointer-events-none absolute inset-0 rounded-[6px] ring-1 ring-[var(--doc-accent)]/35" />
      )}
    </div>
  );
});

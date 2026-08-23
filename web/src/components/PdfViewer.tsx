import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
  ExternalLink,
  PanelLeft,
  FileText,
  Loader2,
  FileWarning,
} from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { startDownload } from "../lib/transfer";
import { cn } from "@/lib/utils";
import { Button } from "./ui/Button";

const isTauri = "__TAURI_INTERNALS__" in window;

// pdf.js is loaded lazily — the ~1.5 MB renderer is only fetched when a PDF is
// actually opened, so the main bundle stays small. The worker is emitted as a
// separate asset by Vite (`?url`) and wired up once.
type PdfModule = typeof import("pdfjs-dist");
let pdfPromise: Promise<PdfModule> | null = null;
function loadPdf(): Promise<PdfModule> {
  if (!pdfPromise) {
    pdfPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([mod, worker]) => {
      mod.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
      return mod;
    });
  }
  return pdfPromise;
}

type FitMode = "width" | "page" | "none";

const ZOOM_STEP = 1.25;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const THUMB_WIDTH = 132;
const MAX_THUMBS = 250;

export default function PdfViewer({ url, name }: { url: string; name: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [fit, setFit] = useState<FitMode>("width");
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [showThumbs, setShowThumbs] = useState(true);
  const [pageInput, setPageInput] = useState("1");
  const [, setResizeTick] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const fitRef = useRef<FitMode>("width");
  fitRef.current = fit;

  // ── Load the document ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProgress(0);
    setError(null);
    setDoc((d) => {
      d?.loadingTask.destroy().catch(() => {});
      return null;
    });
    setPageNum(1);
    setPageInput("1");
    setNumPages(0);
    setFit("width");

    loadPdf()
      .then((pdfjs) => {
        if (cancelled) return;
        const task = pdfjs.getDocument({ url });
        task.onProgress = (data: { loaded: number; total: number }) => {
          if (!cancelled && data.total > 0) setProgress(Math.round((data.loaded / data.total) * 100));
        };
        return task.promise.then((d) => {
          if (cancelled) {
            d.loadingTask.destroy().catch(() => {});
            return;
          }
          setDoc(d);
          setNumPages(d.numPages);
          setLoading(false);
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("PdfViewer: failed to load document", err);
        setError(
          "This PDF could not be rendered. It may be corrupted, password-protected, or the connection to the server was interrupted."
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  // Fit-scale computation relative to the visible container.
  const computeFit = useCallback((vp: { width: number; height: number }) => {
    const c = containerRef.current;
    if (!c) return 1;
    const pad = 56;
    const cw = Math.max(80, c.clientWidth - pad);
    const ch = Math.max(80, c.clientHeight - pad);
    const sWidth = cw / vp.width;
    if (fitRef.current === "page") return Math.min(sWidth, ch / vp.height);
    return sWidth;
  }, []);

  // ── Render the active page ─────────────────────────────────────────────
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setRendering(true);

    const renderPage = async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const vp1 = page.getViewport({ scale: 1 });
        const effectiveScale = fitRef.current === "none" ? scale : computeFit(vp1);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale: effectiveScale * dpr });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = `${Math.floor(effectiveScale * vp1.width)}px`;
        canvas.style.height = `${Math.floor(effectiveScale * vp1.height)}px`;

        if (renderTaskRef.current) renderTaskRef.current.cancel();
        const task = page.render({
          canvas,
          viewport: vp,
        });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;
        setScale(effectiveScale);
        setRendering(false);
      } catch (err) {
        if ((err as Error)?.name === "RenderingCancelledException" || cancelled) return;
        console.error("PdfViewer: page render failed", err);
        setError("This page could not be rendered. Try downloading the file instead.");
        setRendering(false);
      }
    };
    renderPage();

    return () => {
      cancelled = true;
    };
  }, [doc, pageNum, scale, computeFit]);

  // Re-fit when the container is resized (window or fullscreen toggle).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !doc) return;
    const onResize = () => setResizeTick((t) => t + 1);
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  // ── Keyboard navigation (arrows page, ctrl+wheel zoom) ─────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToRef.current(pageNum - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToRef.current(pageNum + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageNum]);

  const goToRef = useRef<(n: number) => void>(() => {});
  const goTo = useCallback(
    (n: number) => {
      if (!doc) return;
      const clamped = Math.max(1, Math.min(doc.numPages, n));
      setPageNum(clamped);
      setPageInput(String(clamped));
    },
    [doc]
  );
  goToRef.current = goTo;

  const zoomBy = (factor: number) => {
    setFit("none");
    setScale((s) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s * factor)));
  };
  const setFitMode = (m: FitMode) => {
    setFit(m);
    if (m !== "none") setScale(1); // recomputed from container on next render
  };

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    setFit("none");
    setScale((s) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s * factor)));
  }, []);

  const onPageInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const n = parseInt(pageInput, 10);
    if (!Number.isNaN(n)) goTo(n);
  };

  const pct = Math.round(scale * 100);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#0d1117]/60">
      {/* Toolbar — floating segmented glass bar */}
      <div className="shrink-0 px-3 py-2 border-b border-border/40 bg-[#0b0f14]/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-1.5 rounded-xl border border-border/50 bg-surface/60 px-2 py-1.5 shadow-lg shadow-black/20">
          {/* File chip */}
          <span
            title={name}
            className="mr-1 hidden min-w-0 max-w-[15rem] items-center gap-1.5 truncate rounded-lg bg-surface-muted/70 px-2.5 py-1 text-xs font-medium text-content md:flex"
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="truncate">{name}</span>
          </span>

          <PdfDivider />

          {/* Thumbnails toggle */}
          <ToolBtn
            active={showThumbs}
            onClick={() => setShowThumbs((s) => !s)}
            title={showThumbs ? "Hide thumbnails" : "Show thumbnails"}
            label="Toggle thumbnails"
          >
            <PanelLeft className="h-4 w-4" />
          </ToolBtn>

          <PdfDivider />

          {/* Page navigation group */}
          <div className="flex items-center gap-0.5 rounded-lg bg-surface-muted/60 p-0.5">
            <button
              onClick={() => goTo(pageNum - 1)}
              disabled={!doc || pageNum <= 1}
              className="rounded-md p-1.5 text-content-muted transition-colors hover:text-content disabled:opacity-30 disabled:pointer-events-none"
              title="Previous page (←)"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1 px-1 text-xs font-mono tabular-nums text-content-muted">
              <input
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
                onKeyDown={onPageInputKey}
                onBlur={() => setPageInput(String(pageNum))}
                className="w-9 rounded-md border border-border/40 bg-transparent py-0.5 text-center text-content focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/30"
                aria-label="Page number"
                inputMode="numeric"
              />
              <span>/ {numPages || "—"}</span>
            </div>
            <button
              onClick={() => goTo(pageNum + 1)}
              disabled={!doc || pageNum >= numPages}
              className="rounded-md p-1.5 text-content-muted transition-colors hover:text-content disabled:opacity-30 disabled:pointer-events-none"
              title="Next page (→)"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <PdfDivider />

          {/* Zoom group */}
          <div className="flex items-center gap-0.5 rounded-lg bg-surface-muted/60 p-0.5">
            <button
              onClick={() => zoomBy(1 / ZOOM_STEP)}
              disabled={!doc}
              className="rounded-md p-1.5 text-content-muted transition-colors hover:text-content disabled:opacity-30 disabled:pointer-events-none"
              title="Zoom out (−)"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="w-11 select-none text-center text-xs font-mono tabular-nums text-content">{pct}%</span>
            <button
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={!doc}
              className="rounded-md p-1.5 text-content-muted transition-colors hover:text-content disabled:opacity-30 disabled:pointer-events-none"
              title="Zoom in (+)"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>

          {/* Fit modes */}
          <div className="hidden items-center overflow-hidden rounded-lg border border-border/40 sm:flex">
            {(
              [
                ["width", "Fit W"],
                ["page", "Fit P"],
                ["none", "1:1"],
              ] as [FitMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setFitMode(mode)}
                className={cn(
                  "px-2 py-1 text-[11px] font-medium transition-colors",
                  fit === mode
                    ? "bg-accent text-accent-fg"
                    : "text-content-muted hover:bg-surface-muted hover:text-content",
                )}
                title={mode === "width" ? "Fit to width" : mode === "page" ? "Fit whole page" : "Actual size"}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {rendering && <Loader2 className="mr-1 h-4 w-4 animate-spin text-accent" />}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => startDownloadFromUrl(url, name)}
            icon={<Download className="h-3.5 w-3.5" />}
            className="px-2.5"
          >
            <span className="hidden md:inline">Download</span>
          </Button>
          {isTauri && (
            <button
              onClick={() => openExternally(url)}
              className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-surface-muted hover:text-content"
              title="Open in system PDF viewer"
              aria-label="Open in system viewer"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {/* Thumbnails rail */}
        {showThumbs && doc && !error && (
          <div className="hidden md:flex flex-col w-40 shrink-0 border-r border-border/50 bg-surface/30 overflow-hidden">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-content-muted border-b border-border/30 shrink-0">
              Pages
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
              {Array.from({ length: Math.min(numPages, MAX_THUMBS) }, (_, i) => i + 1).map((n) => (
                <PdfThumb key={n} doc={doc} index={n} active={n === pageNum} onSelect={() => goTo(n)} />
              ))}
              {numPages > MAX_THUMBS && (
                <p className="text-[10px] text-content-muted text-center pt-1">+{numPages - MAX_THUMBS} more pages</p>
              )}
            </div>
          </div>
        )}

        {/* Page canvas */}
        <div
          ref={containerRef}
          onWheel={onWheel}
          className="relative flex-1 min-w-0 overflow-auto custom-scrollbar bg-grid p-6"
        >
          {loading ? (
            <div className="h-full min-h-[300px] flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-8 w-8 text-accent animate-spin" />
              <div className="w-56">
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-accent transition-all duration-200" style={{ width: `${progress}%` }} />
                </div>
              </div>
              <p className="text-sm text-content-muted">
                {progress > 0 && progress < 100 ? `Loading PDF… ${progress}%` : "Loading PDF…"}
              </p>
            </div>
          ) : error ? (
            <div className="h-full min-h-[300px] flex flex-col items-center justify-center gap-4 text-center px-8">
              <div className="h-16 w-16 rounded-full bg-danger/10 grid place-items-center">
                <FileWarning className="h-8 w-8 text-danger" />
              </div>
              <div>
                <p className="text-content font-semibold mb-1">PDF preview failed</p>
                <p className="text-content-muted text-sm max-w-md">{error}</p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="primary"
                  onClick={() => startDownloadFromUrl(url, name)}
                  icon={<Download className="h-4 w-4" />}
                >
                  Download PDF
                </Button>
                {isTauri && (
                  <Button variant="secondary" onClick={() => openExternally(url)} icon={<ExternalLink className="h-4 w-4" />}>
                    Open in System Viewer
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <canvas ref={canvasRef} className="m-auto shadow-2xl shadow-black/50 rounded-sm bg-white max-w-full" />
              {rendering && (
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                  <Loader2 className="h-6 w-6 text-accent animate-spin" />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PdfDivider() {
  return <div className="mx-0.5 hidden h-5 w-px bg-border/40 sm:block" aria-hidden />;
}

function ToolBtn({ children, onClick, title, label, active, disabled }: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={cn(
        "rounded-lg p-1.5 transition-colors disabled:opacity-30 disabled:pointer-events-none",
        active ? "bg-accent/15 text-accent" : "text-content-muted hover:bg-surface-muted hover:text-content",
      )}
    >
      {children}
    </button>
  );
}

function startDownloadFromUrl(url: string, name: string) {
  try {
    const u = new URL(url, window.location.origin);
    const root = u.searchParams.get("root") || "";
    const path = u.searchParams.get("path") || "";
    if (root && path) startDownload(root, path, name);
    else if (u.protocol === "http:" || u.protocol === "https:") {
      // Only navigate to http(s) destinations; anything else (e.g. a
      // `javascript:` hyperlink embedded in the PDF) is ignored.
      window.location.href = u.href;
    }
  } catch {
    // Invalid URL – nothing to do.
  }
}

async function openExternally(url: string) {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch (e) {
    console.error("Failed to open PDF externally:", e);
  }
}

function PdfThumb({
  doc,
  index,
  active,
  onSelect,
}: {
  doc: PDFDocumentProxy;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLButtonElement>(null);

  // Only render thumbnails that are near the viewport — huge docs otherwise
  // fire hundreds of page renders at once.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let visible = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          visible = true;
          renderThumb();
        }
      },
      { root: el.parentElement, rootMargin: "600px 0px" }
    );
    io.observe(el);

    let cancelled = false;
    let task: RenderTask | null = null;
    const renderThumb = () => {
      if (cancelled || visible === false) return;
      doc
        .getPage(index)
        .then((page) => {
          if (cancelled) return;
          const vp1 = page.getViewport({ scale: 1 });
          const scale = THUMB_WIDTH / vp1.width;
          const vp = page.getViewport({ scale });
          const c = ref.current;
          if (!c) return;
          c.width = Math.floor(vp.width);
          c.height = Math.floor(vp.height);
          task = page.render({ canvas: c, viewport: vp });
          task.promise.catch(() => {});
        })
        .catch(() => {});
    };
    renderThumb();

    return () => {
      cancelled = true;
      visible = false;
      io.disconnect();
      task?.cancel();
    };
  }, [doc, index]);

  return (
    <button
      ref={boxRef}
      onClick={onSelect}
      className={cn(
        "relative w-full rounded-md overflow-hidden border transition-all",
        active
          ? "border-accent ring-1 ring-accent/40 shadow-md shadow-accent/20"
          : "border-white/10 opacity-70 hover:opacity-100 hover:border-white/30"
      )}
      title={`Page ${index}`}
    >
      <canvas ref={ref} className="w-full h-auto bg-white" />
      <span className="absolute bottom-0.5 right-1 text-[9px] font-mono text-white/90 bg-black/60 rounded px-1 leading-4">
        {index}
      </span>
    </button>
  );
}

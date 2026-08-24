import { useCallback, useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageSize, PdfDocMeta } from "./types";
import { parsePdfDate } from "./utils";

// pdf.js is loaded lazily — the ~1.5 MB renderer is only fetched when a
// document is actually opened, so the main bundle stays small. The worker is
// emitted as a separate asset by Vite (`?url`) and wired up once.
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

/**
 * Resolves the (cached) pdf.js module. Pages need the TextLayer class at
 * render time; going through here keeps pdf.js out of the static graph.
 */
export function getPdfModule(): Promise<PdfModule> {
  return loadPdf();
}

export interface PdfDocumentState {
  doc: PDFDocumentProxy | null;
  numPages: number;
  loading: boolean;
  progress: number;
  error: string | null;
  meta: PdfDocMeta | null;
  /** Unrotated page dimensions; filled progressively (page 1 first). */
  sizes: (PageSize | undefined)[];
  reload(): void;
}

/**
 * Loads a PDF document via pdf.js, extracts metadata, and progressively
 * discovers every page's dimensions so the continuous canvas can lay out
 * placeholders before pages render.
 */
export function usePdfDocument(url: string): PdfDocumentState {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<PdfDocMeta | null>(null);
  const [sizes, setSizes] = useState<(PageSize | undefined)[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  // ── Load the document ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setProgress(0);
    setError(null);
    setDoc((prev) => {
      prev?.loadingTask.destroy().catch(() => {});
      return null;
    });
    setNumPages(0);
    setSizes([]);
    setMeta(null);

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
      .catch((err: Error) => {
        if (cancelled) return;
        console.error("DocumentSpace: failed to load document", err);
        setError(
          err?.name === "PasswordException"
            ? "This document is password-protected, so it can't be previewed here."
            : "This PDF could not be rendered. It may be corrupted, or the connection to the server was interrupted."
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url, reloadTick]);

  // ── Metadata ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    doc
      .getMetadata()
      .then(({ info }) => {
        if (cancelled) return;
        const i = info as Record<string, unknown>;
        const str = (k: string): string | undefined => {
          const v = i[k];
          return typeof v === "string" && v.trim() ? v.trim() : undefined;
        };
        setMeta({
          title: str("Title") || undefined,
          author: str("Author") || undefined,
          subject: str("Subject") || undefined,
          keywords: str("Keywords") || undefined,
          creator: str("Creator") || undefined,
          producer: str("Producer") || undefined,
          created: parsePdfDate(str("CreationDate")),
          modifiedPdf: parsePdfDate(str("ModDate")),
          version: str("PDFFormatVersion"),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // ── Progressive page-size discovery ──────────────────────────────────
  // Page 1 arrives first so the initial layout is correct immediately; the
  // rest stream in in small chunks, yielding to the event loop to keep the
  // UI responsive even for documents with thousands of pages.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    const total = doc.numPages;

    (async () => {
      try {
        const first = await doc.getPage(1);
        if (cancelled) return;
        const vp = first.getViewport({ scale: 1 });
        setSizes((prev) => {
          const arr = prev.slice();
          arr[0] = { width: vp.width, height: vp.height };
          return arr;
        });

        const CHUNK = 24;
        for (let start = 2; start <= total && !cancelled; start += CHUNK) {
          const end = Math.min(total, start + CHUNK - 1);
          const batch: Array<[number, PageSize]> = [];
          for (let n = start; n <= end && !cancelled; n++) {
            try {
              const page = await doc.getPage(n);
              if (cancelled) return;
              const v = page.getViewport({ scale: 1 });
              batch.push([n, { width: v.width, height: v.height }]);
            } catch {
              // Leave this page at its fallback size.
            }
            // Yield periodically — one getPage per microtask chunk is plenty.
            if ((n - start) % 8 === 7) await new Promise((r) => setTimeout(r, 0));
          }
          if (cancelled || batch.length === 0) return;
          setSizes((prev) => {
            const arr = prev.slice();
            for (const [n, size] of batch) arr[n - 1] = size;
            return arr;
          });
        }
      } catch {
        // Document destroyed mid-scan — layout falls back to A4 ratio.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc]);

  return { doc, numPages, loading, progress, error, meta, sizes, reload };
}

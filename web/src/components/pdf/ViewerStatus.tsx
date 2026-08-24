import { Download, FileWarning, RefreshCw } from "lucide-react";
import { useViewer } from "./ctx";
import { DEFAULT_PAGE_SIZE } from "./types";

/**
 * Loading / error states for the Document Space. No generic spinners: a
 * document-shaped skeleton with real progress while loading, and a calm,
 * actionable card when a file can't be rendered.
 */
export function ViewerStatus() {
  const viewer = useViewer();

  if (viewer.loading) return <DocumentSkeleton progress={viewer.progress} />;
  if (viewer.error) return <ErrorCard />;
  return null;
}

/** Page-proportioned skeleton with a thin progress bar. */
export function DocumentSkeleton({ progress }: { progress: number }) {
  const aspect = DEFAULT_PAGE_SIZE.height / DEFAULT_PAGE_SIZE.width;
  const width = Math.min(420, typeof window !== "undefined" ? window.innerWidth * 0.72 : 420);

  return (
    <div className="absolute inset-0 z-30 grid place-items-center" aria-live="polite" aria-busy="true">
      <div className="flex flex-col items-center gap-6">
        <div
          className="doc-page doc-shimmer relative overflow-hidden"
          style={{ width, height: Math.round(width * aspect) }}
        />
        <div className="flex w-56 flex-col items-center gap-3">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full bg-[var(--doc-accent)] transition-all duration-300"
              style={{ width: `${Math.max(4, progress)}%`, opacity: progress > 0 ? 1 : 0.35 }}
            />
          </div>
          <p className="text-[13px] text-[var(--doc-muted)]">
            {progress > 0 && progress < 100 ? `Preparing document… ${progress}%` : "Preparing document…"}
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorCard() {
  const viewer = useViewer();
  return (
    <div className="absolute inset-0 z-30 grid place-items-center px-6">
      <div className="doc-glass flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl p-8 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-danger/10">
          <FileWarning className="h-7 w-7 text-danger" />
        </span>
        <div>
          <p className="mb-1.5 text-[15px] font-semibold">Unable to render this document</p>
          <p className="text-[13px] leading-relaxed text-[var(--doc-muted)]">{viewer.error}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={viewer.reload}
            className="flex h-9 items-center gap-2 rounded-xl bg-[var(--doc-accent)] px-4 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
          <button
            onClick={() => viewer.download()}
            className="flex h-9 items-center gap-2 rounded-xl border border-white/12 px-4 text-[13px] font-medium text-[var(--doc-text)] transition-colors hover:bg-white/5"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Extracted from AudioPlayer's fullscreen overlay — the play-queue side panel.
 * Deliberately dumb: playback state flows in via props/callbacks so this can
 * never drift from the store contract.
 */
import { ListMusic, X, Play, Trash2 } from "lucide-react";
import type { FileItem } from "../../api/types";
import { cleanTrackTitle } from "@nexora/core";

export function QueuePanel({
  queue,
  qIndex,
  playing,
  controlled,
  onClose,
  onSelectIndex,
  onRemove,
  scrollRef,
}: {
  queue: FileItem[];
  qIndex: number;
  playing: boolean;
  /** When true rows jump via store; otherwise onSelectIndex drives an external playlist. */
  controlled?: boolean;
  onClose: () => void;
  /** Jump to queue position i (store setIndex when controlled, onSelect otherwise). */
  onSelectIndex: (i: number) => void;
  /** Present only when controlled — renders per-row remove buttons. */
  onRemove?: (i: number) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    /* No solid queue container — the song cards themselves form the UI,
       floating directly on the player's blurred-cover surface. */
    <div
      className="absolute z-40 top-16 bottom-0 right-0 flex w-full max-w-md flex-col px-3 pb-6 animate-slide-in-right sm:top-24 sm:right-2 sm:px-2"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Integrated header — no dark header block */}
      <div className="flex flex-shrink-0 items-center justify-between px-2 pb-3">
        <div className="flex items-center gap-2">
          <ListMusic className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold tracking-wide text-white">Queue</h2>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white/55">
            {queue.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          title="Close queue"
          aria-label="Close queue"
        >
          <X className="h-4.5 w-4.5" />
        </button>
      </div>

      {queue.length === 0 ? (
        <div className="grid flex-1 place-items-center px-6 text-center text-sm text-white/40">
          The queue is empty — add tracks to start listening.
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="no-scrollbar flex-1 space-y-2 overflow-y-auto pb-8"
        >
          {queue.map((qi, i) => {
            const isCur = i === qIndex;
            return (
              <div
                key={qi.path + i}
                data-queue-row={i}
                role="button"
                tabIndex={0}
                onClick={() => onSelectIndex(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectIndex(i);
                  }
                }}
                className={`group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/60 ${
                  isCur
                    ? "bg-accent/[0.13] shadow-[0_6px_22px_-8px_rgba(91,140,255,0.45)] ring-1 ring-accent/30"
                    : "bg-white/[0.05] shadow-[0_1px_3px_rgba(0,0,0,0.15)] ring-1 ring-white/[0.04] hover:translate-x-0.5 hover:bg-white/[0.09]"
                }`}
                aria-current={isCur ? "true" : undefined}
              >
                {/* Number / playback indicator */}
                <div
                  className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg transition-colors ${
                    isCur ? "bg-accent/20" : "bg-white/[0.06] group-hover:bg-white/[0.12]"
                  }`}
                >
                  {isCur ? (
                    playing ? (
                      <span className="flex h-3.5 items-end gap-0.5" aria-label="Playing">
                        <span className="eq-bar h-2.5 w-0.5 rounded-full bg-accent" style={{ animationDelay: "0ms" }} />
                        <span className="eq-bar h-3.5 w-0.5 rounded-full bg-accent" style={{ animationDelay: "150ms" }} />
                        <span className="eq-bar h-2 w-0.5 rounded-full bg-accent" style={{ animationDelay: "300ms" }} />
                      </span>
                    ) : (
                      <Play className="h-3.5 w-3.5 fill-current text-accent" />
                    )
                  ) : (
                    <span className="font-mono text-[10.5px] tabular-nums text-white/40 group-hover:text-white/65">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  )}
                </div>

                {/* Title + metadata */}
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-[13.5px] leading-tight ${
                      isCur ? "font-semibold text-white" : "font-medium text-white/85"
                    }`}
                  >
                    {cleanTrackTitle(qi.name)}
                  </p>
                  <p className={`mt-1 truncate text-[11px] leading-tight ${isCur ? "text-accent/80" : "text-white/40"}`}>
                    {qi.extension.toUpperCase()}
                    {qi.path ? ` · ${qi.path}` : ""}
                  </p>
                </div>

                {onRemove && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(i);
                    }}
                    className="rounded-full p-1.5 text-white/25 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100 flex-shrink-0"
                    title="Remove from queue"
                    aria-label={`Remove ${qi.name} from queue`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

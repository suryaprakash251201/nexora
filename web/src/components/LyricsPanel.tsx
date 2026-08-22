import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Save, Loader2, Trash2, Music, Plus } from "lucide-react";
import type { FileItem, LyricsResponse } from "../api/types";
import { lyricsApi } from "../api/endpoints";
import { useUI } from "../store";

interface LyricsPanelProps {
  item: FileItem;
  currentTime: number;
  onSeek: (t: number) => void;
}

function findActiveIndex(cues: { time: number }[], t: number): number {
  let idx = -1;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].time < 0) continue; // unsynced
    if (cues[i].time <= t) idx = i;
    else break;
  }
  return idx;
}

export default function LyricsPanel({ item, currentTime, onSeek }: LyricsPanelProps) {
  const [lyrics, setLyrics] = useState<LyricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const pushToast = useUI((s) => s.pushToast);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!item) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    setEditing(false);
    setLyrics(null);
    lyricsApi
      .get(item.root_id, item.path)
      .then((res) => {
        if (!ctrl.signal.aborted) setLyrics(res);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e?.message || "Failed to load lyrics");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [item?.root_id, item?.path]);

  const activeIndex = useMemo(
    () => (lyrics?.synced ? findActiveIndex(lyrics.cues, currentTime) : -1),
    [lyrics, currentTime],
  );

  // Auto-scroll the active line into view as playback progresses. `lyrics` is
  // a dependency so freshly loaded lyrics center on the current line at once.
  useEffect(() => {
    if (activeIndex >= 0 && activeRef.current && scrollRef.current) {
      const c = scrollRef.current;
      const el = activeRef.current;
      const target = el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2;
      c.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }
  }, [activeIndex, lyrics]);

  const openEditor = () => {
    setDraft(lyrics?.raw ?? "");
    setEditing(true);
  };
  const save = async () => {
    if (!item) return;
    setSaving(true);
    try {
      const res = await lyricsApi.save(item.root_id, item.path, draft, "lrc");
      const fresh = await lyricsApi.get(item.root_id, item.path);
      setLyrics(fresh);
      setEditing(false);
      // Strict sidecar naming: <song>.lrc next to the audio file.
      const lrcName = res.path?.split("/").pop() ?? `${item.name.replace(/\.[^.]+$/, "")}.lrc`;
      pushToast("success", `Saved ${lrcName}`);
    } catch (e: any) {
      pushToast("error", e?.message || "Failed to save lyrics");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await lyricsApi.remove(item.root_id, item.path);
      const fresh = await lyricsApi.get(item.root_id, item.path);
      setLyrics(fresh);
      pushToast("info", "Lyrics deleted");
    } catch (e: any) {
      pushToast("error", e?.message || "Failed to remove lyrics");
    } finally {
      setSaving(false);
    }
  };

  return (
    // Apple Music style: lyrics float directly on the blurred cover backdrop —
    // no visible card, no header, no timestamps. On small screens it's a
    // near-opaque lyric sheet covering the player; from `lg` up it's fully
    // transparent over the shared backdrop (click-through except content).
    // Edit/remove actions sit faintly in the corner until hovered/focused.
    <div className="absolute z-40 flex flex-col overflow-hidden bg-black/90 backdrop-blur-2xl animate-slide-in-right top-14 bottom-0 right-0 w-full max-w-md sm:top-[4.5rem] pointer-events-none
        lg:top-24 lg:w-[44%] lg:max-w-2xl lg:bg-transparent lg:backdrop-blur-none lg:animate-fade-in">
      {/* Subtle corner actions — faint until hovered/focused */}
      {lyrics?.has_lyrics && !editing && (
        <div className="pointer-events-auto absolute right-3 top-3 z-10 flex gap-1 opacity-25 transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100 lg:right-5 lg:top-4">
          <button
            onClick={openEditor}
            className="rounded-full bg-black/40 p-2 text-white/60 backdrop-blur-md transition-colors hover:text-white"
            title="Edit lyrics"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {lyrics?.has_lyrics && (
            <button
              onClick={remove}
              disabled={saving}
              className="pointer-events-auto rounded-full bg-black/40 p-2 text-white/60 backdrop-blur-md transition-colors hover:text-red-400 disabled:opacity-40"
              title="Delete these lyrics (removes the .lrc file)"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {editing ? (
        /* ── Editor ─────────────────────────────────────────────── */
        <div className="pointer-events-auto flex min-h-0 flex-1 flex-col gap-3 p-4">
          <p className="text-[11px] leading-snug text-white/45">
            Paste <code className="text-accent">.lrc</code> timed lyrics (e.g.{" "}
            <code className="text-white/60">[00:33.39] lyric</code>) or plain text. One line per cue.
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="w-full flex-1 resize-none rounded-xl border border-white/10 bg-white/5 p-3 font-mono text-sm leading-relaxed text-white focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/30"
            placeholder={"[00:33.39] Hey en koli sodave\n[00:36.21] en kari kolambe"}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg px-3 py-1.5 glass-hover text-sm text-white/70 transition-colors hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>
      ) : loading ? (
        /* ── Loading ────────────────────────────────────────────── */
        <div className="pointer-events-auto grid flex-1 place-items-center text-white/40">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : error ? (
        <div className="pointer-events-auto grid flex-1 place-items-center px-6 text-center text-sm text-white/50">{error}</div>
      ) : !lyrics || !lyrics.has_lyrics ? (
        /* ── Empty state — music glyph + subtle create option ────── */
        <div className="pointer-events-auto grid flex-1 place-items-center px-8 text-center">
          <div>
            <Music className="mx-auto mb-5 h-14 w-14 text-white/20" strokeWidth={1.25} />
            <button
              onClick={openEditor}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 backdrop-blur-md transition-all hover:bg-white/10 hover:text-white active:scale-95"
            >
              <Plus className="h-4 w-4" /> Add lyrics
            </button>
          </div>
        </div>
      ) : lyrics.synced ? (
        /* ── Synced lyrics — karaoke view ──────────────────────── */
        <div
          ref={scrollRef}
          className="lyrics-scroll pointer-events-auto flex-1 space-y-1 overflow-y-auto px-6 py-[42%] sm:px-8 lg:px-10 lg:py-[38%] xl:pr-16"
          style={{
            maskImage:
              "linear-gradient(to bottom, transparent 0%, black 9%, black 82%, rgba(0,0,0,0.35) 94%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, black 9%, black 82%, rgba(0,0,0,0.35) 94%, transparent 100%)",
          }}
        >
          {lyrics.cues.map((c, i) => {
            const isActive = i === activeIndex;
            const isPast = i < activeIndex && c.time >= 0;
            const clickable = c.time >= 0;
            return (
              <button
                key={i}
                ref={isActive ? activeRef : undefined}
                onClick={() => clickable && onSeek(c.time)}
                disabled={!clickable}
                aria-current={isActive || undefined}
                className={`group/line relative flex w-full items-baseline rounded-lg py-1.5 text-left transition-all duration-500 ease-out ${
                  clickable ? "cursor-pointer" : "cursor-default"
                }`}
              >
                <span
                  className={`whitespace-pre-wrap transition-all duration-500 ease-out ${
                    c.text === ""
                      ? "block h-4"
                      : isActive
                        ? "text-[1.55rem] sm:text-[1.85rem] xl:text-[2.05rem] font-bold leading-snug tracking-tight text-white [text-shadow:0_0_28px_rgba(255,255,255,0.28)]"
                        : isPast
                          ? "text-xl sm:text-2xl xl:text-[1.65rem] font-semibold leading-snug tracking-tight text-white/25"
                          : "text-xl sm:text-2xl xl:text-[1.65rem] font-semibold leading-snug tracking-tight text-white/45 group-hover/line:text-white/80"
                  }`}
                >
                  {c.text || " "}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        /* ── Plain (unsynced) lyrics ────────────────────────────── */
        <div
          ref={scrollRef}
          className="lyrics-scroll pointer-events-auto flex-1 overflow-y-auto px-6 py-8 sm:px-8 lg:px-10"
          style={{
            maskImage: "linear-gradient(to bottom, transparent 0%, black 6%, black 94%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, black 6%, black 94%, transparent 100%)",
          }}
        >
          <pre className="whitespace-pre-wrap font-sans text-[1.05rem] leading-loose text-white/70">
            {lyrics.raw}
          </pre>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import type { FileItem } from "../../api/types";
import { cleanTrackTitle } from "@nexora/core";
import { thumbUrl } from "../../lib/preview";

/**
 * CassettePlayer — retro 80s compact-cassette hero for the full-screen
 * audio player. Pure presentation: all playback state comes in via props
 * and every interaction is delegated through callbacks, so the existing
 * Zustand/engine audio pipeline stays the single source of truth.
 *
 * Layout (top → bottom):
 *  - Cream plastic shell, corner screws
 *      - Paper label: red/orange brand stripes, NEXORA wordmark + side
 *        indicator, ruled handwriting lines (title / artist), cover-art
 *        sticker
 *      - Trapezoid tape window: brown tape line, tape packs that scale
 *        with `progress`, two white 6-spoke reels (spin while playing)
 *      - Bottom edge: trapezoid head cutout, "A" side engraving
 *      - Tape-counter groove: fill width follows `progress`
 *
 * Animation model (see index.css "Cassette player" section):
 *  - mount  → .cassette-rig.is-loading  : cassette loads into the deck
 *  - eject  → .cassette-rig.is-ejecting : mechanical eject before overlay closes
 *  - swap   → .cassette-rig.is-swapping : tiny nudge + label slide on track change
 *  - reels  → CSS spin, play-state driven by `playing`; tape pack sizes follow `progress`
 */

/** Must match the `n-cassette-eject` duration in index.css. */
export const CASSETTE_EJECT_MS = 620;

/** Must match the `n-cassette-load` duration in index.css. */
const CASSETTE_LOAD_MS = 950;

// Reel centers (as % of window width).
const P = { left: 30, right: 70 } as const;

function ReelTeeth() {
  // Classic compact-cassette hub: white plastic disc with 6 trapezoid
  // teeth cutouts and a small centre spindle hole.
  return (
    <svg viewBox="0 0 100 100" className="cassette-reel-svg" aria-hidden="true">
      {/* White hub disc */}
      <circle cx="50" cy="50" r="40" fill="#efe9d8" />
      <circle cx="50" cy="50" r="40" fill="none" stroke="#b9ad8f" strokeWidth="2" />
      <circle cx="50" cy="50" r="31" fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
      {/* Six teeth cutouts */}
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <path
          key={a}
          d="M45 22 L55 22 L52 40 L48 40 Z"
          fill="#141210"
          transform={`rotate(${a} 50 50)`}
        />
      ))}
      {/* Centre spindle hole */}
      <circle cx="50" cy="50" r="7" fill="#141210" />
      <circle cx="50" cy="50" r="7" fill="none" stroke="#b9ad8f" strokeWidth="1.2" />
    </svg>
  );
}

function Screw({ className = "" }: { className?: string }) {
  return <span className={`cassette-screw ${className}`} aria-hidden="true" />;
}

export function CassettePlayer({
  track,
  playing,
  progress,
  trackNumber = 1,
  ejecting = false,
  onToggle,
  className = "",
}: {
  track: FileItem | null;
  playing: boolean;
  /** Real playback position, 0 → 1 — drives the tape distribution between reels. */
  progress: number;
  /** 1-based queue position for the "A · 01" cosmetic counter. */
  trackNumber?: number;
  /** True while the eject animation plays (overlay closes right after). */
  ejecting?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  // Load-in runs once on mount so the cassette drops into the deck.
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), CASSETTE_LOAD_MS);
    return () => window.clearTimeout(t);
  }, []);

  // Track-change swap: old label fades out, new metadata fades in, with a
  // subtle physical nudge. Cassette body/reels are never remounted, so the
  // reel rotation never resets.
  const [shownTrack, setShownTrack] = useState<FileItem | null>(track);
  const [swapping, setSwapping] = useState(false);
  useEffect(() => {
    if (!track || track.path === shownTrack?.path) return;
    setSwapping(true);
    const t = window.setTimeout(() => {
      setShownTrack(track);
      setSwapping(false);
    }, 320);
    return () => window.clearTimeout(t);
  }, [track, shownTrack]);

  const p = Math.max(0, Math.min(1, progress || 0));
  // Tape packs: left unwinds as the song plays, right takes up the slack.
  const leftScale = 0.55 + 0.45 * (1 - p);
  const rightScale = 0.55 + 0.45 * p;

  const title = shownTrack ? cleanTrackTitle(shownTrack.name) : "";
  // No ID3 pipeline on FileItem — the parent folder is the common
  // "Artist — Album" convention, so use it as the cosmetic artist line.
  const folder = shownTrack ? shownTrack.path.split("/").slice(-2, -1)[0] || "" : "";
  const side = `A · ${String(Math.max(1, trackNumber)).padStart(2, "0")}`;
  const art = shownTrack ? thumbUrl(shownTrack) : "";
  const rigState = ejecting ? "is-ejecting" : swapping ? "is-swapping" : loading ? "is-loading" : "";

  return (
    <div
      className={`cassette-scene relative select-none ${className}`}
      data-playing={playing ? "true" : "false"}
    >
      {/* Deck bay — the dark slot the cassette loads into */}
      <div className="cassette-deck" aria-hidden="true" />

      <div className={`cassette-rig ${rigState}`}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
          className="cassette-shell block w-full cursor-pointer border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-0"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
        >
          {/* Cream plastic shell */}
          <div className="cassette-body">
            <Screw className="is-tl" />
            <Screw className="is-tr" />
            <Screw className="is-bl" />
            <Screw className="is-br" />

            {/* Paper label */}
            <div className={`cassette-label ${swapping ? "is-swapping" : ""}`}>
              {/* Brand stripes */}
              <div className="cassette-stripes" aria-hidden="true" />
              <div className="cassette-label-top">
                <span className="cassette-brand">Nexora</span>
                <span className="cassette-chrome">Compact Cassette · 90</span>
                <span className="cassette-side">{side}</span>
              </div>

              {/* Handwriting lines + cover sticker */}
              <div className="cassette-label-mid">
                <div className="cassette-lines">
                  <p className="cassette-line-title" title={title}>
                    {title || "No cassette loaded"}
                  </p>
                  <p className="cassette-line-artist" title={folder}>
                    {folder || "\u00A0"}
                  </p>
                </div>
                <div className="cassette-sticker">
                  {art ? (
                    <img
                      key={shownTrack?.path || "empty"}
                      src={art}
                      alt=""
                      className="cassette-sticker-img"
                      draggable={false}
                    />
                  ) : (
                    <span className="cassette-sticker-empty">No art</span>
                  )}
                </div>
              </div>
            </div>

            {/* Trapezoid tape window */}
            <div className="cassette-window" aria-hidden="true">
              {/* Brown magnetic tape line */}
              <div className="cassette-tape-line" />
              {/* Tape packs — scale follows real playback progress */}
              <div
                className="cassette-tape"
                style={{ left: `${P.left}%`, ["--tape-s" as string]: leftScale }}
              />
              <div
                className="cassette-tape"
                style={{ left: `${P.right}%`, ["--tape-s" as string]: rightScale }}
              />
              {/* Rotating hubs */}
              <div className="cassette-reel" style={{ left: `${P.left}%` }}>
                <ReelTeeth />
              </div>
              <div className="cassette-reel cassette-reel-right" style={{ left: `${P.right}%` }}>
                <ReelTeeth />
              </div>
              {/* Window glass sheen */}
              <div className="cassette-window-sheen" />
            </div>

            {/* Tape-counter groove (paints under the head block) */}
            <div className="cassette-counter" aria-hidden="true">
              <div className="cassette-counter-fill" style={{ width: `${p * 100}%` }} />
            </div>

            {/* Bottom edge: head cutout + side engraving */}
            <div className="cassette-bottom" aria-hidden="true">
              <span className="cassette-bottom-letter">A</span>
              <span className="cassette-head-hole" />
              <span className="cassette-guide-hole is-left" />
              <span className="cassette-guide-hole is-right" />
            </div>
          </div>
        </button>
      </div>

      {/* Screen-reader summary — the visual is decorative for AT */}
      <span className="sr-only">
        {playing ? "Playing" : "Paused"} — {title || "nothing loaded"}
      </span>
    </div>
  );
}

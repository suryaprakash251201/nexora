import { useEffect, useState } from "react";
import type { FileItem } from "../../api/types";
import { cleanTrackTitle } from "@nexora/core";
import { thumbUrl } from "../../lib/preview";

/**
 * CassettePlayer — modern premium cassette hero for the full-screen audio
 * player. Pure presentation: all playback state comes in via props and every
 * interaction is delegated through callbacks, so the existing Zustand/engine
 * audio pipeline stays the single source of truth.
 *
 * Layout (top → bottom):
 *  - Dark glass body
 *      - Accent hairline + brand/side header
 *      - Cover photo (the hero, glass-ring frame)
 *      - Title (left) + artist (right) metadata strip
 *  - Glass tape window
 *      - Dark magnetic strip with accent-gradient travelling sheen
 *      - Two reels with rotating spools (accent-tinted hub)
 *      - Reel-position progress dots
 *
 * Animation model (see index.css "Cassette player" section):
 *  - mount  → .cassette-rig.is-loading  : cassette loads into the deck
 *  - eject  → .cassette-rig.is-ejecting : mechanical eject before overlay closes
 *  - swap   → .cassette-rig.is-swapping : tiny nudge + photo slide-in on track change
 *  - reels  → CSS spin, play-state driven by `playing`; tape pack sizes follow `progress`
 *  - tape   → .cassette-tape-strip .sheen : accent gradient moves left → right while playing
 *  - glow   → .cassette-body plays a soft accent-tinted breathe while playing
 */

/** Must match the `n-cassette-eject` duration in index.css. */
export const CASSETTE_EJECT_MS = 620;

// Reel centers (as % of window width) — inset from the edges so the
// strip has somewhere to start/end and the reels read as the mechanism.
const P = { left: 24, right: 76 } as const;

function ReelSpokes() {
  // A modern reel: a glass-tinted ring with 6 spoke cutouts and a small
  // accent-tinted centre spindle hole. No white spool — that was the
  // 1970s cassette; the modern look is a single dark disc with subtle
  // accent details.
  return (
    <svg viewBox="0 0 100 100" className="cassette-reel-svg" aria-hidden="true">
      {/* Outer dark glass ring */}
      <circle cx="50" cy="50" r="36" fill="#0a0c14" />
      <circle cx="50" cy="50" r="36" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5" />
      {/* Six spoke cutouts — slim modern proportions */}
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <rect
          key={a}
          x="48.2"
          y="13"
          width="3.6"
          height="20"
          rx="1.8"
          fill="#06080f"
          transform={`rotate(${a} 50 50)`}
        />
      ))}
      {/* Inner accent ring */}
      <circle cx="50" cy="50" r="14" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
      {/* Centre spindle hole */}
      <circle cx="50" cy="50" r="4.5" fill="#02030a" />
      <circle cx="50" cy="50" r="4.5" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
    </svg>
  );
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
  /** 1-based queue position for the "SIDE A · 01" cosmetic counter. */
  trackNumber?: number;
  /** True while the eject animation plays (overlay closes right after). */
  ejecting?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
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
  const side = `SIDE A · ${String(Math.max(1, trackNumber)).padStart(2, "0")}`;
  const art = shownTrack ? thumbUrl(shownTrack) : "";

  return (
    <div
      className={`cassette-scene relative select-none ${className}`}
      data-playing={playing ? "true" : "false"}
    >
      {/* Deck bay — the dark slot the cassette loads into */}
      <div className="cassette-deck" aria-hidden="true" />

      <div
        className={`cassette-rig ${ejecting ? "is-ejecting" : swapping ? "is-swapping" : ""}`}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
          className="cassette-shell block w-full cursor-pointer border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-0 rounded-[6%/9%]"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
        >
          {/* Dark glass body */}
          <div className="cassette-body">
            {/* Accent edge glow — subtle gradient halo around the perimeter */}
            <div className="cassette-body-glow" aria-hidden="true" />

            {/* Top header strip: brand + side indicator on a single hairline */}
            <div className="cassette-header">
              <div className="cassette-header-rule" aria-hidden="true" />
              <div className="cassette-header-row">
                <span className="cassette-header-brand">Nexora Audio</span>
                <span className="cassette-header-side">{side}</span>
              </div>
            </div>

            {/* Wide cover photo — the visual hero. Glass-ring frame, no
                hard sticker border, accent-tinted vignette that brightens
                while playing. */}
            <div className="cassette-photo-frame">
              <div
                key={shownTrack?.path || "empty"}
                className={`cassette-photo ${swapping ? "is-swapping" : ""}`}
              >
                {art ? (
                  <img
                    src={art}
                    alt=""
                    className="cassette-photo-img"
                    draggable={false}
                  />
                ) : (
                  <div className="cassette-photo-placeholder">
                    <span>No artwork</span>
                  </div>
                )}
                {/* Subtle accent-tinted vignette — only visible while playing */}
                <div className="cassette-photo-glow" aria-hidden="true" />
              </div>
            </div>

            {/* Metadata strip — title (left) + artist (right), single hairline */}
            <div className={`cassette-meta ${swapping ? "is-swapping" : ""}`}>
              <div className="cassette-meta-row">
                <p className="cassette-meta-title" title={title}>
                  {title || "No cassette loaded"}
                </p>
                <p className="cassette-meta-artist" title={folder}>
                  {folder || "\u00A0"}
                </p>
              </div>
            </div>

            {/* Glass tape window — visible magnetic strip + reels + dots */}
            <div className="cassette-window" aria-hidden="true">
              {/* Strip base — always visible, gives the "tape present" look */}
              <div className="cassette-tape-strip">
                {/* Accent gradient travels left → right while playing */}
                <div className="cassette-tape-sheen" />
              </div>

              {/* Tape packs — scale follows real playback progress */}
              <div
                className="cassette-tape"
                style={{ left: `${P.left}%`, ["--tape-s" as string]: leftScale }}
              />
              <div
                className="cassette-tape"
                style={{ left: `${P.right}%`, ["--tape-s" as string]: rightScale }}
              />

              {/* Rotating spools */}
              <div className="cassette-reel" style={{ left: `${P.left}%` }}>
                <ReelSpokes />
              </div>
              <div className="cassette-reel cassette-reel-right" style={{ left: `${P.right}%` }}>
                <ReelSpokes />
              </div>

              {/* Reel-position progress dots — abstract, modern, less literal
                  than the head assembly + capstan posts of the old design. */}
              <div className="cassette-progress-dots">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <span
                    key={i}
                    className={`cassette-progress-dot ${i / 7 <= p ? "is-lit" : ""}`}
                    style={{ ["--i" as string]: i }}
                  />
                ))}
              </div>

              {/* Glass sheen over the window */}
              <div className="cassette-window-sheen" />
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

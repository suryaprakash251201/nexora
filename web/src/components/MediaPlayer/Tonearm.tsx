/**
 * Tonearm — modern minimal redesign.
 *
 * Design philosophy
 * -----------------
 * The previous version was a literal, photorealistic turntable arm: a full
 * S-shaped tube, counterweight, gimbal bearing, brand wordmark, knurling,
 * finger lift, anti-skate dial, screws, etc. The problem with that approach
 * is that it competes with the album art for attention and reads as vintage
 * gear rather than a modern app surface.
 *
 * This redesign is the opposite: a single, abstract suggestion of a tonearm
 * — a thin tapered line from a glowing pivot to a soft accent dot. That's
 * it. The cueing motion does the storytelling; the SVG stays out of the
 * way.
 *
 * Visual primitives
 * -----------------
 *  - One pivot: a soft glowing circle in the upper-right corner. Glows
 *    mint while tracking, amber when parked.
 *  - One arm: a single tapered line. No S-curve, no counterweight, no
 *    subcomponents. The line is the gesture.
 *  - One cartridge: a small rounded rectangle at the arm's tip. Tilted
 *    slightly off-axis so it reads as a cartridge and not a thumbtack.
 *  - One stylus: a soft accent dot. The only saturated color in the
 *    composition, so it draws the eye exactly where the music is
 *    "happening" — on the record.
 *
 * Animation model
 * ---------------
 * The whole composition lives inside a single CSS-transitioned transform
 * (`.tonearm-swing`). When `playing` flips, the arm swings onto the
 * record. The rotation pivot is the gimbal point itself, set via
 * `transform-origin`. No keyframes, no JS animation; transitions handle
 * interruptions gracefully.
 *
 * The pivot's color and the stylus's color are state-driven props, not
 * CSS — this keeps the SVG free of state-class soup and lets us change
 * the palette in JS if we ever want a "limited edition" gold/red theme.
 *
 * Accessibility
 * -------------
 *  - Component is purely decorative (aria-hidden).
 *  - `prefers-reduced-motion: reduce` cuts the swing transition to
 *    0.01s — the state change is still visible, just without the slow
 *    swing.
 */

import { useEffect, useId, useState } from "react";

/* ── Geometry constants ────────────────────────────────────────────────
 *
 * The viewBox is 120x100, smaller than before. The arm runs from the
 * pivot in the upper-right to the cartridge near the lower-left, where
 * the stylus tip touches the outer groove in the playing pose. The
 * "parked" pose swings the arm further to the right so the cartridge
 * sits clear of the disc.
 *
 * The pivot point here is also the CSS transform-origin, so a single
 * `rotate()` rotates the whole arm around the gimbal — the same way a
 * real arm pivots.
 */
const PIVOT = { x: 96, y: 18 } as const;
const CARTRIDGE_TIP = { x: 22, y: 78 } as const;
const VB_W = 120;
const VB_H = 100;

/* Swing angle for the parked state. Positive = clockwise (sweeps the
 * arm further to the right, off the record). Tuned to clear the disc
 * edge at the smallest disc size we render at (220px). */
const PARK_ANGLE = 32;

/* Palette — the only places saturated color appears are the pivot
 * glow, the stylus dot, and (optionally) a faint stylus bloom. The
 * rest of the geometry is white/silver/glass so the album art
 * remains the focal point. */
const PALETTE = {
  pivotPlaying: "#7EE8B0", // mint — tracking
  pivotPaused: "#F5C56B",  // amber — parked
  pivotError: "#F46E6E",   // reserved for future error state
  stylusPlaying: "#FF5A66", // warm red — the "hot tip"
  stylusPaused: "#A8AEB6",  // dim silver — at rest
  arm: "#E8EBF0",            // bright silver for the arm
  armShadow: "#0A0C10",      // near-black for the cast shadow
  cartridge: "#1A1D24",      // near-black cartridge body
  cartridgeEdge: "#3A3F4A",  // bevel highlight
} as const;

export default function Tonearm({ playing }: { playing: boolean }) {
  /* Reduced-motion preference is read once on mount and used to set
   * a class that overrides the swing transition. Doing it in JS
   * avoids a flash of full-motion on first render. */
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  /* Stable IDs for the SVG defs so multiple Tonearm instances on the
   * same page (theoretical future use) don't collide. */
  const uid = useId();
  const ids = {
    pivotGlow: `ta-pivot-glow-${uid}`,
    arm: `ta-arm-${uid}`,
    cartridge: `ta-cartridge-${uid}`,
    stylus: `ta-stylus-${uid}`,
    blur: `ta-blur-${uid}`,
  };

  const pivotColor = playing ? PALETTE.pivotPlaying : PALETTE.pivotPaused;
  const stylusColor = playing ? PALETTE.stylusPlaying : PALETTE.stylusPaused;

  return (
    <div
      className={`tonearm-swing pointer-events-none absolute z-20 aspect-[120/100] w-[96%] ${playing ? "tonearm-playing" : "tonearm-paused"} ${reduced ? "tonearm-reduced" : ""}`}
      style={{
        top: "2%",
        left: "20%",
        ["--ta-pivot-x" as any]: `${(PIVOT.x / VB_W) * 100}%`,
        ["--ta-pivot-y" as any]: `${(PIVOT.y / VB_H) * 100}%`,
        ["--ta-park-angle" as any]: `${PARK_ANGLE}deg`,
      }}
      aria-hidden
      data-playing={playing ? "true" : "false"}
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
      >
        <defs>
          {/* Pivot glow — soft radial bloom that sits behind the
              pivot dot. The colour comes from the JS palette, so the
              whole component changes palette by changing one prop. */}
          <radialGradient id={ids.pivotGlow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={pivotColor} stopOpacity="0.85" />
            <stop offset="55%" stopColor={pivotColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={pivotColor} stopOpacity="0" />
          </radialGradient>

          {/* Arm — a single linear gradient. Bright on top, dim
              underneath, so the arm reads as a polished tube even
              though it's a 2D line. */}
          <linearGradient id={ids.arm} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="50%" stopColor={PALETTE.arm} />
            <stop offset="100%" stopColor="#9DA4AE" />
          </linearGradient>

          {/* Cartridge body — soft vertical gradient. Reads as a
              blocky plastic part without being a literal
              photorealistic cartridge. */}
          <linearGradient id={ids.cartridge} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#252830" />
            <stop offset="100%" stopColor="#0A0C10" />
          </linearGradient>

          {/* Stylus bloom — radial fade that pulses only while
              playing. The colour comes from the JS palette. */}
          <radialGradient id={ids.stylus} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={stylusColor} stopOpacity="0.9" />
            <stop offset="40%" stopColor={stylusColor} stopOpacity="0.45" />
            <stop offset="100%" stopColor={stylusColor} stopOpacity="0" />
          </radialGradient>

          {/* Soft blur for the cast shadow under the arm. */}
          <filter id={ids.blur} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>

        {/* ── Cast shadow under the arm ─────────────────────────────
            A single line drawn 1.2 units below the arm, blurred and
            at low opacity. Reads as the arm casting a soft shadow
            onto the platter. */}
        <line
          x1={PIVOT.x}
          y1={PIVOT.y + 1.2}
          x2={CARTRIDGE_TIP.x}
          y2={CARTRIDGE_TIP.y + 1.2}
          stroke={PALETTE.armShadow}
          strokeWidth="3.2"
          strokeLinecap="round"
          opacity="0.35"
          filter={`url(#${ids.blur})`}
        />

        {/* ── ARM ────────────────────────────────────────────────────
            One tapered line. No S-curve, no sub-tubes, no
            counterweight. The simplification is the point. */}
        <line
          x1={PIVOT.x}
          y1={PIVOT.y}
          x2={CARTRIDGE_TIP.x}
          y2={CARTRIDGE_TIP.y}
          stroke={`url(#${ids.arm})`}
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* ── PIVOT ──────────────────────────────────────────────────
            A glowing dot at the gimbal. Outer halo (radial gradient
            that pulses while playing) plus a small solid inner
            dot. The colour and animation convey playback state at
            a glance. */}
        <circle
          cx={PIVOT.x}
          cy={PIVOT.y}
          r="9"
          fill={`url(#${ids.pivotGlow})`}
          className="tonearm-pivot-halo"
        />
        <circle
          cx={PIVOT.x}
          cy={PIVOT.y}
          r="3.2"
          fill={pivotColor}
          className="tonearm-pivot-dot"
        />

        {/* ── CARTRIDGE ─────────────────────────────────────────────
            A small rounded rectangle at the arm's tip, tilted so
            it reads as a cartridge and not a thumbtack. The tilt
            is the only detail; everything else is geometry. */}
        <g transform={`translate(${CARTRIDGE_TIP.x} ${CARTRIDGE_TIP.y}) rotate(-15)`}>
          {/* Body */}
          <rect
            x="-7"
            y="-4.5"
            width="14"
            height="9"
            rx="2.2"
            fill={`url(#${ids.cartridge})`}
            stroke={PALETTE.cartridgeEdge}
            strokeWidth="0.5"
          />
          {/* Top-edge highlight — a single thin line on the top
              edge of the cartridge. Reads as light catching a
              chamfered edge. */}
          <rect
            x="-6"
            y="-3.8"
            width="12"
            height="0.8"
            rx="0.4"
            fill="#FFFFFF"
            opacity="0.35"
          />
        </g>

        {/* ── STYLUS ─────────────────────────────────────────────────
            The only saturated colour in the composition (when
            playing). The dot is the literal "where the music is
            happening" — on the record. A soft bloom behind it
            pulses only while playing, mirroring the pivot halo. */}
        <circle
          cx={CARTRIDGE_TIP.x}
          cy={CARTRIDGE_TIP.y}
          r="6.5"
          fill={`url(#${ids.stylus})`}
          className="tonearm-stylus-bloom"
          style={{ opacity: playing ? 1 : 0 }}
        />
        <circle
          cx={CARTRIDGE_TIP.x}
          cy={CARTRIDGE_TIP.y}
          r="1.6"
          fill={stylusColor}
        />
      </svg>
    </div>
  );
}

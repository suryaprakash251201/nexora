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
 *
 * CARTRIDGE is the position of the cartridge body's centre; STYLUS is
 * the actual contact point with the record (offset from the
 * cartridge's front edge by a small amount — on a real cartridge the
 * cantilever protrudes ~1mm past the body). Keeping these as separate
 * constants lets the cantilever line connect them precisely.
 */
const PIVOT = { x: 96, y: 18 } as const;
const CARTRIDGE = { x: 22, y: 76 } as const;
const STYLUS = { x: 13, y: 88 } as const;
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
    cantilever: `ta-cantilever-${uid}`,
    stylus: `ta-stylus-${uid}`,
    stylusBody: `ta-stylus-body-${uid}`,
    contactShadow: `ta-contact-${uid}`,
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

          {/* Cantilever — a thin metallic rod. We use a horizontal
              gradient (light at the cartridge end, darker at the
              tip) to fake the curvature of a real beryllium or
              aluminium cantilever, which is brighter where it
              exits the cartridge body and dimmer at the tip. */}
          <linearGradient id={ids.cantilever} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#E5E7EA" />
            <stop offset="60%" stopColor="#9DA4AE" />
            <stop offset="100%" stopColor="#6A707A" />
          </linearGradient>

          {/* Stylus bloom — a three-stop radial gradient. Inner core
              is opaque and warm (the "diamond contact"); mid stop is
              the saturated color at half-opacity (the "hot tip"
              halo); outer stop fades to zero (atmospheric glow).
              Together they read as a single refined light source
              rather than a fuzzy circle. */}
          <radialGradient id={ids.stylus} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="18%" stopColor={stylusColor} stopOpacity="0.85" />
            <stop offset="55%" stopColor={stylusColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stylusColor} stopOpacity="0" />
          </radialGradient>

          {/* Stylus body — a tiny solid circle of the saturated
              color, sized to read as the physical stylus tip
              (not the glow). Layered on top of the bloom. */}
          <radialGradient id={ids.stylusBody} cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="40%" stopColor={stylusColor} />
            <stop offset="100%" stopColor={stylusColor} stopOpacity="0.7" />
          </radialGradient>

          {/* Contact shadow — a soft elliptical darkening at the
              point where the stylus meets the record. Suggests the
              physical pressure of the needle in the groove. Only
              visible while playing. */}
          <radialGradient id={ids.contactShadow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#000" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#000" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
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
          x2={CARTRIDGE.x}
          y2={CARTRIDGE.y + 1.2}
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
          x2={CARTRIDGE.x}
          y2={CARTRIDGE.y}
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
        <g transform={`translate(${CARTRIDGE.x} ${CARTRIDGE.y}) rotate(-15)`}>
          {/* Body — slightly more elongated than before so it
              reads as a real cartridge (which is taller than it
              is wide when viewed from above). */}
          <rect
            x="-6.5"
            y="-5.5"
            width="13"
            height="11"
            rx="2.4"
            fill={`url(#${ids.cartridge})`}
            stroke={PALETTE.cartridgeEdge}
            strokeWidth="0.5"
          />
          {/* Top-edge highlight — a single thin line on the top
              edge of the cartridge. Reads as light catching a
              chamfered edge. */}
          <rect
            x="-5.5"
            y="-4.7"
            width="11"
            height="0.8"
            rx="0.4"
            fill="#FFFFFF"
            opacity="0.35"
          />
          {/* Brand accent — a thin horizontal red stripe across
              the body. Subtle enough to read as a label, not a
              decoration. The real Ortofon / Shure / Audio-Technica
              cartridges all have one of these. */}
          <rect
            x="-4.5"
            y="-0.6"
            width="9"
            height="0.7"
            rx="0.35"
            fill={PALETTE.stylusPlaying}
            opacity="0.75"
          />
          {/* Tiny mounting screws at the four corners — two
              small champagne dots. Just enough to read as
              "fastened", not so much they look like a
              schematic. */}
          <circle cx="-5" cy="-4" r="0.45" fill="#F5E6C2" opacity="0.7" />
          <circle cx="5" cy="-4" r="0.45" fill="#F5E6C2" opacity="0.7" />
          <circle cx="-5" cy="4" r="0.45" fill="#F5E6C2" opacity="0.55" />
          <circle cx="5" cy="4" r="0.45" fill="#F5E6C2" opacity="0.55" />
          {/* Stylus reflection — a tiny bright glint on the
              top of the cartridge, suggesting light from the
              stylus glow bouncing off the plastic. Only visible
              while playing (when the stylus is lit). */}
          <ellipse
            cx="-2.5"
            cy="-3"
            rx="1.6"
            ry="0.6"
            fill="#FFFFFF"
            opacity={playing ? 0.45 : 0}
            transform="rotate(-20 -2.5 -3)"
          />
        </g>

        {/* ── CANTILEVER ─────────────────────────────────────────────
            A thin metal rod that extends from the front edge of
            the cartridge to the stylus tip. The cantilever is
            what physically carries the stylus into the groove; on
            a real cartridge it protrudes a few mm past the body
            at a slight downward angle.

            We taper it from ~0.9 at the cartridge end to ~0.4
            at the tip, with a gradient that gives it a metallic
            sheen. Without this, the stylus dot looks like it
            is attached directly to the cartridge; with it, the
            composition reads as "cartridge on a stick, touching
            the record" which is exactly what a real tonearm is. */}
        <line
          x1={CARTRIDGE.x - 2.6}
          y1={CARTRIDGE.y + 1.4}
          x2={STYLUS.x}
          y2={STYLUS.y}
          stroke={`url(#${ids.cantilever})`}
          strokeWidth="0.9"
          strokeLinecap="round"
        />

        {/* ── STYLUS (contact point) ───────────────────────────────
            This is the literal "where the music is happening" —
            the point where the cantilever meets the record
            groove. Built from four layers, back to front:

              1. Contact shadow  (only while playing)  — a soft
                 elliptical darkening under the tip, suggesting
                 the physical pressure of the needle in the
                 groove. Reads as a tiny dent in the record.

              2. Outer bloom      (only while playing)  — a wide,
                 three-stop radial gradient that pulses at 1.4s.
                 The atmospheric glow that says "playing".

              3. Stylus body                          — a small
                 solid dot with its own gradient (white hot
                 spot at top-left, saturated colour at the body).
                 Sized so it reads as the physical diamond tip,
                 not the glow.

              4. White-hot core                        — a single
                 pure-white pixel at the tip's centre. The
                 "diamond catching the light" effect. */}
        <ellipse
          cx={STYLUS.x}
          cy={STYLUS.y + 0.6}
          rx="3.2"
          ry="1.2"
          fill={`url(#${ids.contactShadow})`}
          className="tonearm-contact-shadow"
          style={{ opacity: playing ? 1 : 0 }}
        />
        <circle
          cx={STYLUS.x}
          cy={STYLUS.y}
          r="6.5"
          fill={`url(#${ids.stylus})`}
          className="tonearm-stylus-bloom"
          style={{ opacity: playing ? 1 : 0 }}
        />
        <circle
          cx={STYLUS.x}
          cy={STYLUS.y}
          r="1.7"
          fill={`url(#${ids.stylusBody})`}
          style={{ opacity: playing ? 1 : 0.55 }}
        />
        <circle
          cx={STYLUS.x - 0.35}
          cy={STYLUS.y - 0.4}
          r="0.6"
          fill="#FFFFFF"
          opacity={playing ? 0.95 : 0.4}
        />
      </svg>
    </div>
  );
}

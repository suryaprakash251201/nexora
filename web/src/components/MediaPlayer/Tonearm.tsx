/**
 * Tonearm — realistic minimal redesign.
 *
 * Design philosophy
 * -----------------
 * The previous version (sonar rings) abstracted the cueing gesture so
 * far that nothing on the disc actually looked like a turntable. This
 * redesign brings back the iconic turntable vocabulary, but stops
 * well short of a literal replica:
 *
 *   - S-shaped arm tube        — the visual signature of a real hi-fi
 *     tonearm. Drawn as a single stroked Bezier path, not a filled
 *     polygon, so it reads as a polished metal tube at any scale.
 *
 *   - Counterweight             — a knurled cylinder behind the pivot.
 *     The other visual signature; without it, the composition reads
 *     as 'a stick with a needle' rather than 'a tonearm'.
 *
 *   - Gimbal pivot              — a single polished ring + centre pin
 *     at the rotation point. The eye is drawn to the pivot because
 *     that's where the cueing motion happens.
 *
 *   - Headshell + finger lift   — a small angled block at the arm's
 *     tip with a chrome tab. The finger lift is the small detail that
 *     says 'this is the part a DJ touches' — it's why a real
 *     headshell is recognisable at a glance.
 *
 * What's NOT here (deliberately):
 *   - Cantilever + stylus needle, anti-skate dial, base plinth,
 *     mounting screws, knurling lines, brand wordmark, multiple
 *     LEDs. The S-curve + counterweight + headshell trio is enough
 *     to communicate 'real turntable' while keeping the disc surface
 *     clean — the album art stays the hero.
 *
 * Animation
 * ---------
 * Single CSS transition on transform, rotating around the gimbal
 * pivot. The path itself is unchanged in shape; only the
 * transform-origin matters. Same gesture as before: 1.8s swing with
 * a slight overshoot so the arm 'lands' on the record.
 *
 * Accessibility: decorative (aria-hidden). prefers-reduced-motion
 * (media query + JS-detected) cuts the swing to 0.01s.
 */

import { useEffect, useId, useState } from "react";

/* ── Geometry constants ────────────────────────────────────────────────
 *
 * viewBox 120x100, like the previous version. PIVOT is the gimbal
 * centre; PIVOT also becomes the CSS transform-origin so a single
 * rotate() swings the whole arm around the right point.
 *
 * ARM_PATH is the S-curve from the pivot out to the cartridge. It's
 * a single SVG path string with two cubic Beziers:
 *   - first  curve: from pivot, the arm bends slightly outward
 *     (the "S" top hump)
 *   - second curve: continues to the cartridge, bending back inward
 *     (the "S" bottom hump)
 *   - ending at the headshell position
 *
 * HEADSHELL is the cartridge body's centre; the S-curve ends there
 * and the headshell itself is the visual terminus — no stylus or
 * cantilever extends beyond it.
 */
const PIVOT = { x: 92, y: 30 } as const;
const HEADSHELL = { x: 24, y: 78 } as const;
const COUNTERWEIGHT_END = { x: 108, y: 50 } as const; // far end of the counterweight
const VB_W = 120;
const VB_H = 100;

/* Arm path: smooth S-curve from pivot to headshell. The control
 * points are tuned by eye so the curve reads as an "S" at any
 * scale (a Bezier with both control points on the same side of
 * the chord produces a flat curve; here they're alternated side
 * to side which is what gives the S its characteristic shape). */
const ARM_PATH = `M ${PIVOT.x} ${PIVOT.y}
                   C 90 50, 78 56, 60 64
                   C 42 72, 30 76, ${HEADSHELL.x} ${HEADSHELL.y}`;



/* Counterweight: a cylinder sitting between the pivot and the
 * counterweight's far end. Drawn as a rotated rect so it has
 * visible 3D presence (the rotation creates the illusion of a
 * knurled cylinder, even though we don't draw knurling lines). */
const COUNTERWEIGHT_ANGLE = -38; // tilt the counterweight downward

/* Swing angle for the parked state. Positive = clockwise (the arm
 * folds back over the pivot to the right, off the disc). The
 * counterweight swings in the opposite direction, which on a real
 * tonearm keeps the balance — visually it just looks right. */
const PARK_ANGLE = 30;

/* ── Palette ───────────────────────────────────────────────────────────
 * Saturated colour appears only at the pivot glow. The arm,
 * counterweight, and headshell are dark polished metal so they
 * don't compete with the album art. The whole composition is
 * tuned for a dark UI surface. */
const PALETTE = {
  pivotPlaying: "#7EE8B0", // mint
  pivotPaused: "#F5C56B",  // amber
  /* Arm / headshell / counterweight — a four-stop palette that
   * simulates polished black chrome. The highlights are warm
   * (champagne) so the arm reads as machined metal, not plastic. */
  metalHi: "#E8D9B5",       // warm champagne highlight
  metalBright: "#8E8475",   // brushed mid
  metalDark: "#2A2520",     // deep shadow
  metalEdge: "#A89668",     // subtle gold edge
} as const;

export default function Tonearm({ playing }: { playing: boolean }) {
  /* Reduced-motion preference is read once on mount and used to
   * set a class that overrides the swing transition. Doing it in
   * JS avoids a flash of full-motion on first render. */
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  /* Stable IDs for SVG defs so multiple instances on the same
   * page don't collide. */
  const uid = useId();
  const ids = {
    arm: `ta-arm-${uid}`,
    counterweight: `ta-cw-${uid}`,
    gimbal: `ta-gimbal-${uid}`,
    headshell: `ta-hs-${uid}`,
    fingerLift: `ta-fl-${uid}`,
    pivotGlow: `ta-pg-${uid}`,
    blur: `ta-blur-${uid}`,
  };

  const pivotColor = playing ? PALETTE.pivotPlaying : PALETTE.pivotPaused;

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
          {/* Arm tube — a vertical gradient that paints light
              along the top of the S-curve and shadow along the
              bottom. Looks like a polished cylinder from any
              angle because the highlight tracks the top edge of
              the path automatically. */}
          <linearGradient id={ids.arm} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={PALETTE.metalHi} />
            <stop offset="35%" stopColor={PALETTE.metalBright} />
            <stop offset="100%" stopColor={PALETTE.metalDark} />
          </linearGradient>

          {/* Counterweight — a slightly different palette to
              distinguish it from the arm. Warmer mid-stop, cooler
              dark-stop. Together with the rotation, the eye
              reads it as a separate knurled cylinder rather than
              just a darker section of the arm. */}
          <linearGradient id={ids.counterweight} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9A8E68" />
            <stop offset="50%" stopColor="#4A3F2A" />
            <stop offset="100%" stopColor="#15110A" />
          </linearGradient>

          {/* Gimbal pivot — a radial gradient with a top-left
              highlight and a bottom-right shadow, simulating
              light on a polished ball bearing. */}
          <radialGradient id={ids.gimbal} cx="32%" cy="28%" r="78%">
            <stop offset="0%" stopColor={PALETTE.metalHi} />
            <stop offset="40%" stopColor={PALETTE.metalBright} />
            <stop offset="80%" stopColor={PALETTE.metalDark} />
            <stop offset="100%" stopColor="#000" />
          </radialGradient>

          {/* Headshell — light grey, brushed-aluminium gradient. */}
          <linearGradient id={ids.headshell} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3A3D44" />
            <stop offset="100%" stopColor="#15171C" />
          </linearGradient>

          {/* Finger lift — small chrome tab. Bright on top, dim
              underneath. */}
          <linearGradient id={ids.fingerLift} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={PALETTE.metalHi} />
            <stop offset="100%" stopColor={PALETTE.metalEdge} />
          </linearGradient>

          {/* Pivot glow — the only saturated colour behind the
              gimbal. The colour comes from the JS palette. */}
          <radialGradient id={ids.pivotGlow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={pivotColor} stopOpacity="0.85" />
            <stop offset="55%" stopColor={pivotColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={pivotColor} stopOpacity="0" />
          </radialGradient>

          {/* Soft blur for shadows. */}
          <filter id={ids.blur} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
        </defs>

        {/* ── Cast shadow under the arm ─────────────────────────────
            A blurred, low-opacity copy of the arm path drawn
            1.5 units below. Reads as the arm casting a soft
            shadow onto the platter. */}
        <path
          d={ARM_PATH}
          fill="none"
          stroke="#000"
          strokeWidth="5"
          strokeLinecap="round"
          opacity="0.35"
          filter={`url(#${ids.blur})`}
          transform="translate(0.6 1.2)"
        />

        {/* ── COUNTERWEIGHT ──────────────────────────────────────────
            Drawn FIRST so the arm passes over it (the arm
            connects to the pivot, which is between the arm and
            the counterweight visually). On a real tonearm the
            counterweight is behind the pivot, opposite the arm. */}
        <g transform={`rotate(${COUNTERWEIGHT_ANGLE} ${PIVOT.x} ${PIVOT.y})`}>
          {/* Stub from pivot to counterweight — same gradient
              as the arm so the eye reads it as a continuation,
              not a separate part. */}
          <line
            x1={PIVOT.x}
            y1={PIVOT.y}
            x2={COUNTERWEIGHT_END.x}
            y2={COUNTERWEIGHT_END.y}
            stroke={`url(#${ids.arm})`}
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          {/* Counterweight barrel — a small rect rotated 45° in
              the counterweight's local frame (which itself is
              rotated by the wrapper) to give the cylinder some
              3D presence. The double rotation creates the
              impression of a knurled cylinder, even without
              drawing the knurling lines. */}
          <g transform={`rotate(40 ${COUNTERWEIGHT_END.x} ${COUNTERWEIGHT_END.y})`}>
            <rect
              x={COUNTERWEIGHT_END.x - 7}
              y={COUNTERWEIGHT_END.y - 5}
              width="14"
              height="10"
              rx="2.4"
              fill={`url(#${ids.counterweight})`}
              stroke="#000"
              strokeWidth="0.5"
            />
            {/* Top-edge highlight — a single thin warm line */}
            <rect
              x={COUNTERWEIGHT_END.x - 5.5}
              y={COUNTERWEIGHT_END.y - 4.4}
              width="11"
              height="0.8"
              rx="0.4"
              fill={PALETTE.metalHi}
              opacity="0.4"
            />
          </g>
        </g>

        {/* ── ARM TUBE (S-curve) ─────────────────────────────────────
            The signature element. A single stroked path, with
            the gradient painting the top edge as a highlight.
            On a real turntable the S-shape lets the headshell
            stay parallel to the record grooves across the
            playing surface; visually it's what makes the arm
            read as 'a real tonearm' rather than 'a stick'. */}
        <path
          d={ARM_PATH}
          fill="none"
          stroke={`url(#${ids.arm})`}
          strokeWidth="3.6"
          strokeLinecap="round"
        />
        {/* Specular highlight on top of the S — a thinner path
            with the same shape but offset upward, in warm
            champagne. Without this the arm reads as a flat
            grey line; with it, the arm reads as a polished
            tube. */}
        <path
          d={ARM_PATH}
          fill="none"
          stroke={PALETTE.metalHi}
          strokeWidth="0.8"
          strokeLinecap="round"
          opacity="0.55"
          transform="translate(0 -1.0)"
        />

        {/* ── HEAdSHELL + FINGER LIFT ────────────────────────────────
            The cartridge body. Slightly larger than the
            previous version to read as a real cartridge.
            Tilted -15° so it points forward off the arm. */}
        <g transform={`translate(${HEADSHELL.x} ${HEADSHELL.y}) rotate(-15)`}>
          {/* Finger lift — a small chrome tab at the back of the
              headshell. The single most recognisable detail of a
              real cartridge. */}
          <path
            d="M -7 -3 L -2 -7.5 L 0.5 -5.5 L -4.5 -1 Z"
            fill={`url(#${ids.fingerLift})`}
            stroke="#000"
            strokeWidth="0.4"
          />
          {/* Headshell body */}
          <rect
            x="-6.5"
            y="-5.5"
            width="13"
            height="11"
            rx="2.4"
            fill={`url(#${ids.headshell})`}
            stroke={PALETTE.metalEdge}
            strokeWidth="0.5"
          />
          {/* Top-edge highlight on the headshell */}
          <rect
            x="-5.5"
            y="-4.7"
            width="11"
            height="0.8"
            rx="0.4"
            fill="#FFFFFF"
            opacity="0.3"
          />
        </g>

        {/* ── GIMBAL PIVOT (on top of everything) ───────────────── */}
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
          r="4.5"
          fill={`url(#${ids.gimbal})`}
          stroke="#000"
          strokeWidth="0.6"
        />
        <circle
          cx={PIVOT.x}
          cy={PIVOT.y}
          r="1.6"
          fill={pivotColor}
          className="tonearm-pivot-dot"
        />
      </svg>
    </div>
  );
}

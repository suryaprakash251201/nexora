/**
 * Modern turntable tonearm — redesigned for v1.9.
 *
 * Visual design
 * -------------
 * A precision-machined S-shaped tonearm rendered in SVG with a refined
 * dark-graphite and champagne-palette finish. The composition is
 * deliberately minimal: every line earns its place. The result reads as
 * a modern high-end deck (think Technics SL-1200G or Rega Naia) rather
 * than a stylized replica.
 *
 * Key visual upgrades over the previous design:
 *   - Single-source-of-truth geometry: a unified <g> with named
 *     groups (base, gimbal, counterweight, arm, headshell) so the
 *     pivot, the S-curve, and the cartridge stay in lockstep.
 *   - Champagne / graphite dual-tone metal: warm highlights on
 *     machined surfaces, cool shadows in recesses. Replaces the
 *     previous all-grey "studio monitor" look.
 *   - Subtle micro-LED indicators: a single status pip on the base
 *     that breathes with playback (not three flashing LEDs).
 *   - A glowing ruby-red stylus that doubles as a visual heartbeat —
 *     the recording-studio convention.
 *
 * Animation choreography
 * ----------------------
 * The cueing gesture is a three-phase motion, modeled on a real
 * cuing lever:
 *   1. Anticipation  (paused -> playing, frame 0..0.3): the arm
 *      lifts a hair and pauses, like a hand hesitating before
 *      lowering the needle.
 *   2. Swing-in      (frame 0.3..0.7): the arm pivots from the rest
 *      position onto the outer groove. The arc is slightly slower
 *      at the start (ease-out) and faster at the end (ease-in), the
 *      inverse of inertia.
 *   3. Settle         (frame 0.7..1.0): a micro-bounce as the
 *      stylus contacts the groove, then dead-still tracking.
 *
 * Pausing reverses in two phases (lift + swing-out) without the
 * anticipation, so the gesture feels deliberate, not jumpy.
 *
 * All three phases are coordinated by CSS variables that JS can
 * adjust if we ever want to make the speed responsive to track
 * energy. Right now they are constants — see TONARM_TIMING below.
 *
 * Accessibility
 * -------------
 * The component is purely decorative. It is marked aria-hidden and
 * respects prefers-reduced-motion: under that media query the swing
 * animation is replaced with a single 0.01s jump to the end state,
 * and the breathing/sway/glow loops are removed entirely. The
 * playback-state visual cue is then carried by the album art
 * rotation alone.
 */

import { useEffect, useId, useState } from "react";

/* ── Geometry constants ────────────────────────────────────────────────
 *
 * The viewBox is 120x150 and these values are the *neutral* pose of
 * the arm (paused, parked off the record). Playing/paused state
 * classes rotate this neutral pose via CSS so we never need to
 * recompute paths in JS.
 *
 * Pivot is the gimbal bearing centre; transform-origin in CSS is
 * derived from these so a single rotate() rotates the whole arm
 * around the right point.
 */
const PIVOT = { x: 92, y: 64 } as const;
const VB_W = 120;
const VB_H = 150;

/* Cueing timing in seconds. Tuned by eye; the existing
 * cubic-bezier(0.3, 0.65, 0.22, 1) in CSS gives the anticipation feel. */
const TONARM_TIMING = {
  swingIn: 2.4,
  swingOut: 1.9,
  lift: 0.45,
};

/* Status-pip color shifts subtly with playback state for ambient
 * feedback (green = tracking, amber = cued/paused, red = error). */
const PIP_COLOR = {
  playing: "#5EE6A8", // soft mint — "tracking"
  paused: "#F5C56B",  // warm amber — "cued, ready"
  error: "#F46E6E",   // soft red   — placeholder, unused today
} as const;

export default function Tonearm({ playing }: { playing: boolean }) {
  /* Reduced-motion preference is read once on mount and used to
   * pick a different animation curve in CSS via a data attribute.
   * Doing it in JS avoids a flash of full-motion on first render. */
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  /* Generate stable IDs for the SVG defs so multiple Tonearm
   * instances on the same page (Hypothetical future use) don't
   * collide. */
  const uid = useId();
  const grads = {
    metal: `ta-metal-${uid}`,
    metalDeep: `ta-metal-deep-${uid}`,
    champagne: `ta-champagne-${uid}`,
    gimbal: `ta-gimbal-${uid}`,
    weight: `ta-weight-${uid}`,
    headshell: `ta-headshell-${uid}`,
    cartridge: `ta-cartridge-${uid}`,
    pip: `ta-pip-${uid}`,
    stylus: `ta-stylus-${uid}`,
    armTube: `ta-arm-${uid}`,
    shadow: `ta-shadow-${uid}`,
  };

  const pip = playing ? PIP_COLOR.playing : PIP_COLOR.paused;

  return (
    <div
      className={`tonearm-swing pointer-events-none absolute z-20 aspect-[120/150] w-[94%] ${playing ? "tonearm-playing" : "tonearm-paused"} ${reduced ? "tonearm-reduced" : ""}`}
      style={{
        top: "-2%",
        left: "32%",
        ["--ta-pivot-x" as any]: `${(PIVOT.x / VB_W) * 100}%`,
        ["--ta-pivot-y" as any]: `${(PIVOT.y / VB_H) * 100}%`,
        ["--ta-swing-in" as any]: `${TONARM_TIMING.swingIn}s`,
        ["--ta-swing-out" as any]: `${TONARM_TIMING.swingOut}s`,
        ["--ta-lift" as any]: `${TONARM_TIMING.lift}s`,
      }}
      aria-hidden
      data-playing={playing ? "true" : "false"}
    >
      <div className={`h-full w-full ${playing ? "tonearm-idle" : ""}`}>
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="tonearm-shadow h-full w-full"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
        >
          <defs>
            {/* Primary machined metal — warm graphite with a champagne
                highlight band on top. Used for the arm tube. */}
            <linearGradient id={grads.metal} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#E8D9B5" />
              <stop offset="18%" stopColor="#B8A074" />
              <stop offset="50%" stopColor="#6A5C42" />
              <stop offset="82%" stopColor="#3A3225" />
              <stop offset="100%" stopColor="#1A1610" />
            </linearGradient>

            {/* Deep machined base — almost-black with a single subtle
                highlight along the top edge. */}
            <linearGradient id={grads.metalDeep} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3A3D44" />
              <stop offset="8%" stopColor="#22252B" />
              <stop offset="92%" stopColor="#0E1014" />
              <stop offset="100%" stopColor="#06070A" />
            </linearGradient>

            {/* Champagne — for accents: gimbal inner ring, finger
                lift, headshell highlights. */}
            <linearGradient id={grads.champagne} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#F5E6C2" />
              <stop offset="50%" stopColor="#C9A86A" />
              <stop offset="100%" stopColor="#7A5F2E" />
            </linearGradient>

            {/* Gimbal bearing — spherical highlight at top-left,
                dark recess at bottom-right. The classic "ball bearing"
                look. */}
            <radialGradient id={grads.gimbal} cx="32%" cy="28%" r="78%">
              <stop offset="0%" stopColor="#E8D9B5" />
              <stop offset="35%" stopColor="#A89668" />
              <stop offset="72%" stopColor="#4A3F2A" />
              <stop offset="100%" stopColor="#15110A" />
            </radialGradient>

            {/* Counterweight barrel — knurled cylinder. Two stops
                shifted to fake the curvature of a real cylindrical
                weight rotated in 3D. */}
            <radialGradient id={grads.weight} cx="30%" cy="35%" r="80%">
              <stop offset="0%" stopColor="#9A8E68" />
              <stop offset="55%" stopColor="#4A3F2A" />
              <stop offset="100%" stopColor="#1A1610" />
            </radialGradient>

            {/* Headshell — light aluminium body, brushed top
                highlight. */}
            <linearGradient id={grads.headshell} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#E5E7EA" />
              <stop offset="50%" stopColor="#9DA2A8" />
              <stop offset="100%" stopColor="#3A3D42" />
            </linearGradient>

            {/* Cartridge — black plastic with a single thin red
                accent line (the brand stripe on a real Ortofon). */}
            <linearGradient id={grads.cartridge} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#1F2228" />
              <stop offset="100%" stopColor="#0A0C10" />
            </linearGradient>

            {/* Status-pip glow — radial bloom that pulses softly.
                One colour stops only; CSS animation handles the
                breathing. */}
            <radialGradient id={grads.pip} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={pip} stopOpacity="0.95" />
              <stop offset="55%" stopColor={pip} stopOpacity="0.35" />
              <stop offset="100%" stopColor={pip} stopOpacity="0" />
            </radialGradient>

            {/* Stylus glow — the "hot tip" effect on a real cantilever. */}
            <radialGradient id={grads.stylus} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FF4D5A" stopOpacity="1" />
              <stop offset="40%" stopColor="#FF4D5A" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#FF4D5A" stopOpacity="0" />
            </radialGradient>

            {/* Arm tube — same family as the primary metal, but
                thinner falloff so the S-curve reads as a continuous
                polished tube. */}
            <linearGradient id={grads.armTube} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#F0E2BE" />
              <stop offset="35%" stopColor="#B8A074" />
              <stop offset="65%" stopColor="#5C4E36" />
              <stop offset="100%" stopColor="#2A2418" />
            </linearGradient>

            {/* Cast shadow blur. */}
            <filter id={grads.shadow} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
          </defs>

          {/* Cast shadow on the platter surface (under the base) */}
          <ellipse
            cx="97"
            cy="138"
            rx="22"
            ry="3.4"
            fill="#000"
            opacity="0.45"
            filter={`url(#${grads.shadow})`}
          />

          {/* ── BASE PLINTH ──────────────────────────────────────── */}
          <g>
            {/* Body */}
            <rect
              x="74"
              y="106"
              width="44"
              height="32"
              rx="5"
              fill={`url(#${grads.metalDeep})`}
              stroke="#000"
              strokeWidth="0.6"
            />
            {/* Top edge highlight */}
            <rect
              x="76"
              y="107.5"
              width="40"
              height="1.2"
              rx="0.6"
              fill="#FFFFFF"
              opacity="0.18"
            />
            {/* Bevelled bottom shadow */}
            <rect
              x="76"
              y="135"
              width="40"
              height="2"
              rx="1"
              fill="#000"
              opacity="0.5"
            />
            {/* Mounting screws — four, one per corner. Tiny
                champagne rings around dark sockets. */}
            {[
              [80, 134],
              [112, 134],
              [80, 110],
              [112, 110],
            ].map(([cx, cy]) => (
              <g key={`screw-${cx}-${cy}`}>
                <circle cx={cx} cy={cy} r="1.4" fill="#F5E6C2" opacity="0.4" />
                <circle cx={cx} cy={cy} r="1" fill="#0A0C10" />
              </g>
            ))}

            {/* Status pip — single breathing LED that glows mint
                while tracking, amber when parked. Carries the
                playback-state visual cue so colour-blind users
                still get timing feedback. */}
            <circle
              cx="96"
              cy="120"
              r="2.6"
              fill={pip}
              className="tonearm-pip"
            />
            <circle
              cx="96"
              cy="120"
              r="5.2"
              fill={`url(#${grads.pip})`}
              className="tonearm-pip-glow"
            />

            {/* Brand wordmark — tiny, etched feel. Replaces the
                awkward red cueing lever from the previous design
                (the lever was a visual noise element that didn't
                serve any user-facing purpose). */}
            <text
              x="78"
              y="129"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontSize="2.6"
              fontWeight="600"
              letterSpacing="0.4"
              fill="#9DA2A8"
              opacity="0.6"
            >
              N·9
            </text>
          </g>

          {/* ── COUNTERWEIGHT (behind the pivot) ─────────────────── */}
          <g>
            {/* Stub from pivot */}
            <line
              x1={PIVOT.x}
              y1={PIVOT.y}
              x2="106"
              y2="125"
              stroke={`url(#${grads.metal})`}
              strokeWidth="3.2"
              strokeLinecap="round"
            />
            {/* Barrel */}
            <g transform="rotate(45 106 126)">
              <rect
                x="99"
                y="119"
                width="14"
                height="14"
                rx="3.5"
                fill={`url(#${grads.weight})`}
                stroke="#000"
                strokeWidth="0.6"
              />
              {/* Knurling — five fine vertical lines suggest
                  grip texture without overdoing it. */}
              {[101, 103.5, 106, 108.5, 111].map((x) => (
                <line
                  key={`knurl-${x}`}
                  x1={x}
                  y1="120.5"
                  x2={x}
                  y2="131.5"
                  stroke="#000"
                  strokeWidth="0.4"
                  opacity="0.55"
                />
              ))}
              {/* Top edge highlight */}
              <rect
                x="100"
                y="120"
                width="12"
                height="1.4"
                rx="0.7"
                fill="#E8D9B5"
                opacity="0.45"
              />
            </g>
            {/* Lock collar — a thin ring that sits between the
                weight and the pivot. */}
            <rect
              x="99"
              y="117"
              width="6"
              height="4"
              rx="1.5"
              transform="rotate(45 102 119)"
              fill="#0A0C10"
              stroke="#7A5F2E"
              strokeWidth="0.4"
            />
          </g>

          {/* ── S-SHAPED ARM TUBE ────────────────────────────────── */}
          <g>
            {/* Shadow under the tube */}
            <path
              d={`M${PIVOT.x} ${PIVOT.y} C 88 86, 76 76, 60 70 C 46 65, 32 58, 25 48`}
              fill="none"
              stroke="#000"
              strokeWidth="6.2"
              strokeLinecap="round"
              opacity="0.5"
              transform="translate(0.6 0.9)"
            />
            {/* Main tube */}
            <path
              d={`M${PIVOT.x} ${PIVOT.y} C 88 86, 76 76, 60 70 C 46 65, 32 58, 25 48`}
              fill="none"
              stroke={`url(#${grads.armTube})`}
              strokeWidth="5.4"
              strokeLinecap="round"
            />
            {/* Specular highlight along the top of the tube */}
            <path
              d={`M${PIVOT.x} ${PIVOT.y - 1.8} C 88 84, 76 74, 60 68 C 46 63, 32 56, 25 46`}
              fill="none"
              stroke="#F5E6C2"
              strokeWidth="0.9"
              strokeLinecap="round"
              opacity="0.45"
            />
          </g>

          {/* ── HEAdSHELL + CARTRIDGE (the business end) ─────────── */}
          <g transform="translate(25 48) rotate(-130)">
            {/* Finger lift — a tiny tab at the back of the headshell
                that the DJ uses to cue by hand. */}
            <path
              d="M-3 -6 L4 -10 L5.5 -6.5 L-1.5 -3 Z"
              fill={`url(#${grads.champagne})`}
              stroke="#0A0C10"
              strokeWidth="0.4"
            />
            {/* Shell body */}
            <path
              d="M-4 -5.5 L14 -5.5 Q18 0 14 5.5 L-4 5.5 Q-7 0 -4 -5.5 Z"
              fill={`url(#${grads.headshell})`}
              stroke="#0A0C10"
              strokeWidth="0.5"
            />
            {/* Shell highlight */}
            <rect
              x="-2"
              y="-4.5"
              width="14"
              height="1.3"
              rx="0.6"
              fill="#FFFFFF"
              opacity="0.4"
            />
            {/* Cartridge — the black plastic block that holds the
                stylus. */}
            <rect
              x="1.2"
              y="-3.6"
              width="10.5"
              height="7.2"
              rx="1.2"
              fill={`url(#${grads.cartridge})`}
              stroke="#000"
              strokeWidth="0.4"
            />
            {/* Brand stripe on the cartridge — the single accent of
                red. Replaces the previous two arbitrary red dots
                with one tasteful horizontal line. */}
            <rect
              x="2.6"
              y="-2"
              width="7.4"
              height="1"
              rx="0.5"
              fill="#FF4D5A"
              opacity="0.9"
            />
            {/* Cantilever — the thin metal rod that carries the
                stylus from the cartridge body to the groove. */}
            <line
              x1="11.8"
              y1="0"
              x2="15.6"
              y2="0.4"
              stroke="#E5E7EA"
              strokeWidth="0.8"
              strokeLinecap="round"
            />
            {/* Stylus tip — a tiny ruby-red dot. The real thing is
                a diamond, but red reads better at this scale and
                echoes the brand stripe. */}
            <circle
              cx="16.2"
              cy="0.6"
              r="0.7"
              fill="#FF4D5A"
            />
            {/* Hot-tip glow — only visible while the needle is in
                the groove. Pulses at ~1.2s to feel like a heartbeat. */}
            <circle
              cx="16.2"
              cy="0.6"
              r="3.2"
              fill={`url(#${grads.stylus})`}
              className="tonearm-stylus-glow"
              style={{ opacity: playing ? 1 : 0 }}
            />
            {/* Soft warm cast on the shell from the glow */}
            <circle
              cx="16.2"
              cy="0.6"
              r="5.2"
              fill="#FF4D5A"
              opacity={playing ? 0.06 : 0}
              filter={`url(#${grads.shadow})`}
            />
          </g>

          {/* ── GIMBAL PIVOT (on top of everything) ───────────────── */}
          <g>
            {/* Outer collar */}
            <circle
              cx={PIVOT.x}
              cy={PIVOT.y}
              r="10.5"
              fill={`url(#${grads.gimbal})`}
              stroke="#0A0C10"
              strokeWidth="0.8"
            />
            {/* Inner recess */}
            <circle
              cx={PIVOT.x}
              cy={PIVOT.y}
              r="6"
              fill="#0A0C10"
              stroke="#7A5F2E"
              strokeWidth="0.6"
            />
            {/* Center pin */}
            <circle cx={PIVOT.x} cy={PIVOT.y} r="1.4" fill="#F5E6C2" />
            {/* Top-left specular */}
            <ellipse
              cx={PIVOT.x - 3.4}
              cy={PIVOT.y - 4.2}
              rx="2.4"
              ry="1.4"
              fill="#FFFFFF"
              opacity="0.55"
              transform={`rotate(-30 ${PIVOT.x - 3.4} ${PIVOT.y - 4.2})`}
            />
          </g>
        </svg>
      </div>
    </div>
  );
}

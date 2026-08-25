/**
 * Tiny module-level UI bus shared across navigation boundaries.
 *
 * The fullscreen video overlay renders inside a stack screen, which lives in
 * a different native view subtree than the MiniPlayer (rendered alongside the
 * navigator in App.tsx) — an absolutely-positioned child cannot cover it.
 * The bus lets the player announce "immersive mode is on" so App.tsx can hide
 * the MiniPlayer without threading props through every screen.
 */

type Listener = (active: boolean) => void;

let active = false;
const listeners = new Set<Listener>();

export function setVideoOverlayActive(value: boolean): void {
  if (value === active) return;
  active = value;
  listeners.forEach((l) => {
    try {
      l(value);
    } catch {}
  });
}

export function isVideoOverlayActive(): boolean {
  return active;
}

export function subscribeVideoOverlay(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

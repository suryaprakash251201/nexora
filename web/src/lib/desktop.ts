/**
 * Desktop (Tauri) helpers. All functions are no-ops / safe fallbacks when
 * running in a plain browser, so the web build never breaks.
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);
}

let platformPromise: Promise<{ os: string; arch: string; family: string } | null> | null = null;

export interface DesktopPlatform {
  os: string;
  arch: string;
  family: string;
}

/** Cached result of the native `get_platform` command (null in browser). */
export function getPlatform(): Promise<DesktopPlatform | null> {
  if (!isTauri()) return Promise.resolve(null);
  if (!platformPromise) {
    platformPromise = import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke<DesktopPlatform>("get_platform").catch(() => null)
      )
      .catch(() => null);
  }
  return platformPromise;
}

/** True when the app is talking to a server on this machine. */
export function isLocalServer(): boolean {
  const url = localStorage.getItem("nexora-api-url") || "";
  return /localhost|127\.0\.0\.1|::1/.test(url);
}

/** Opens a folder (or file) in the OS file manager / default app. */
export async function revealInFileManager(absolutePath: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(absolutePath);
  } catch (e) {
    console.debug("[desktop] reveal failed:", e);
  }
}

/** Opens the configured Nexora server in the default web browser. */
export async function openInBrowser(): Promise<void> {
  if (!isTauri()) return;
  const url = localStorage.getItem("nexora-api-url") || "http://localhost:8080";
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch (e) {
    console.debug("[desktop] open-in-browser failed:", e);
  }
}

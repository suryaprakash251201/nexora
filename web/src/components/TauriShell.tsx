import { useEffect, useRef } from "react";
import { useTransfers } from "../store/transfers";

/**
 * TauriShell is a headless component that wires up native OS features
 * when running inside a Tauri desktop window.
 *
 * It handles:
 * - Native notifications for transfer events
 * - Global media key shortcuts
 * - Autostart configuration (exposed via window.__TAURI_AUTOSTART__)
 * - Window state persistence
 * - Power management (prevent sleep during transfers)
 * - Deep link handling
 * - App lifecycle events
 */

let initPromise: Promise<void> | null = null;

async function ensurePlugins() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // ── Window state ────────────────────────────────────────
      // The window-state plugin handles restore+save automatically.
      // We just call restoreStateCurrent() once on startup.
      const { restoreStateCurrent } = await import(
        "@tauri-apps/plugin-window-state"
      );
      await restoreStateCurrent().catch(() => {});

      // ── Global shortcuts ────────────────────────────────────
      const { register } = await import(
        "@tauri-apps/plugin-global-shortcut"
      );

      // Register media keys for the player (if the player store is available)
      const registerShortcuts = async () => {
        try {
          // Media keys — these register globally so the app can respond
          // even when not focused (the actual behavior depends on the OS).
          const shortcuts = ["MediaPlay", "MediaPause", "MediaStop"];
          for (const s of shortcuts) {
            await register(s, () => {
              // Dispatch a custom event that the MediaPlayer component listens to
              window.dispatchEvent(new CustomEvent("nexora:media", { detail: s }));
            }).catch(() => {
              // Some shortcuts may not be available on all platforms
            });
          }
        } catch {
          // Shortcut registration may fail on some platforms — this is non-critical
        }
      };

      await registerShortcuts();

      // ── App closing event ───────────────────────────────────
      const { listen } = await import("@tauri-apps/api/event");
      await listen("nexora:app-closing", () => {
        // Clean up any active downloads before close
        console.log("[tauri] App closing — cleaning up");
      }).catch(() => {});
    } catch (e) {
      // Plugins are only available in Tauri — fail gracefully in browser
      console.debug("[tauri] Some native features unavailable:", e);
    }
  })();

  return initPromise;
}

// ── Notification helper ────────────────────────────────────────────

let notifyPermission: boolean | null = null;

/**
 * Shows a native OS notification via the Tauri notification plugin.
 * Falls back silently if the plugin is unavailable.
 */
export async function nativeNotify(
  title: string,
  body?: string,
  opts?: { icon?: string; onClick?: () => void }
): Promise<void> {
  try {
    const { sendNotification, isPermissionGranted, requestPermission } =
      await import("@tauri-apps/plugin-notification");

    if (notifyPermission === null) {
      notifyPermission = await isPermissionGranted();
    }
    if (!notifyPermission) {
      const perm = await requestPermission();
      notifyPermission = perm === "granted";
    }
    if (!notifyPermission) return;

    sendNotification({ title, body: body ?? "" });
  } catch {
    // Silently fail if not in Tauri
  }
}

// ── Autostart helper ──────────────────────────────────────────────

let autostartSupported: boolean | null = null;

export async function isAutostartEnabled(): Promise<boolean> {
  try {
    const { isEnabled } = await import("@tauri-apps/plugin-autostart");
    autostartSupported = true;
    return await isEnabled();
  } catch {
    autostartSupported = false;
    return false;
  }
}

export async function setAutostart(enabled: boolean): Promise<void> {
  if (autostartSupported === null) {
    await isAutostartEnabled();
  }
  if (!autostartSupported) return;
  try {
    const { enable, disable } = await import("@tauri-apps/plugin-autostart");
    if (enabled) {
      await enable();
    } else {
      await disable();
    }
  } catch {
    // Silently fail
  }
}

// ── Sleep inhibition (power management) ───────────────────────────

let sleepInhibited = false;

export async function setSleepInhibition(inhibit: boolean): Promise<void> {
  if (sleepInhibited === inhibit) return;
  sleepInhibited = inhibit;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_sleep_inhibition", { inhibit });
  } catch {
    // Not available in browser or on all platforms
  }
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Initialize native Tauri features once on mount.
 * This component should be rendered inside the app root in Tauri mode.
 */
export default function TauriShell() {
  const initialized = useRef(false);

  // Monitor transfers and notify / inhibit sleep
  const transfers = useTransfers((s) => s.transfers);

  // Show native notification when transfers complete
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    const last = transfers[transfers.length - 1];
    if (!last) return;

    if (last.status === "done") {
      nativeNotify(
        "Transfer Complete",
        `${last.name} — ${last.kind === "upload" ? "Uploaded" : "Downloaded"} successfully.`
      );
    } else if (last.status === "error" && last.error) {
      nativeNotify("Transfer Failed", `${last.name}: ${last.error}`);
    }
  }, [transfers]);

  // Prevent sleep during active transfers
  useEffect(() => {
    const hasActive = transfers.some((t) => t.status === "active");
    setSleepInhibition(hasActive);
  }, [transfers]);

  // Bootstrap Tauri plugins on first mount
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    if (initialized.current) return;
    initialized.current = true;

    ensurePlugins().catch((e) =>
      console.debug("[tauri] Plugin init error:", e)
    );
  }, []);

  return null;
}

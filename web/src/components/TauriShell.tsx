import { useEffect, useRef } from "react";
import { useTransfers } from "../store/transfers";
import { usePlayer } from "../store/player";

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
      // Restore size/position/etc. but NEVER restore a hidden window:
      // if the previous session hid the window to the tray and quit, the
      // saved state contains visible=false, which would make the app start
      // with no visible window ("app won't open").
      const { restoreStateCurrent, StateFlags } = await import(
        "@tauri-apps/plugin-window-state"
      );
      await restoreStateCurrent(StateFlags.ALL & ~StateFlags.VISIBLE).catch(() => {});

      // Guarantee the window is visible and focused on every launch.
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      await win.show().catch(() => {});
      await win.unminimize().catch(() => {});
      await win.setFocus().catch(() => {});

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

      // ── System tray: Play / Pause toggles the audio player ──
      await listen("nexora:tray-play-pause", () => {
        usePlayer.getState().toggle();
      }).catch(() => {});

      // ── Window hidden to tray: notify once so users know it's still alive ──
      let trayNotified = false;
      await listen("nexora:hidden-to-tray", () => {
        if (trayNotified) return;
        trayNotified = true;
        void nativeNotify(
          "Nexora is still running",
          "Playback continues in the system tray. Click the tray icon or relaunch the app to bring it back."
        );
      }).catch(() => {});

      // ── Safety net: a second launch asked us to show the window ──
      await listen("nexora:show-window", () => {
        win.show();
        win.unminimize();
        win.setFocus();
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

  // Track which transfers have already been notified to avoid duplicate OS notifications
  const notifiedIds = useRef<Set<string>>(new Set());

  // Show native notification when transfers complete (only once per transfer)
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    for (const t of transfers) {
      if (notifiedIds.current.has(t.id)) continue;
      if (t.status === "done") {
        notifiedIds.current.add(t.id);
        nativeNotify(
          "Transfer Complete",
          `${t.name} — ${t.kind === "upload" ? "Uploaded" : "Downloaded"} successfully.`
        );
      } else if (t.status === "error" && t.error) {
        notifiedIds.current.add(t.id);
        nativeNotify("Transfer Failed", `${t.name}: ${t.error}`);
      }
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

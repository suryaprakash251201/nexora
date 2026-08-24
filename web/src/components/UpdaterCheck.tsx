import { useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { toast } from "../lib/toast";
import { getPlatform } from "../lib/desktop";

/**
 * One-shot update check on startup (Tauri desktop only).
 *
 * Note: on Linux the updater plugin can only self-install AppImage builds;
 * deb/rpm installs are surfaced with a "download from releases" hint instead
 * of a button that would silently fail.
 */
export default function UpdaterCheck() {
  useEffect(() => {
    async function checkForUpdates() {
      try {
        const update = await check();
        if (!update) return;

        const platform = await getPlatform();
        const linuxNonAppImage =
          platform?.os === "linux" &&
          !window.location.pathname.includes("/tmp/.mount_"); // AppImage mounts under /tmp/.mount_*

        toast(`Update v${update.version} available!`, {
          description: linuxNonAppImage
            ? "Download the new version from GitHub Releases, then reinstall via your package manager."
            : "A new version of Nexora is ready to install.",
          duration: linuxNonAppImage ? Infinity : 10000,
              action: linuxNonAppImage
            ? undefined
            : {
                label: "Install & Restart",
                onClick: async () => {
                  toast.loading(`Downloading update v${update.version}...`);
                  try {
                    await update.downloadAndInstall();
                    toast.success("Update installed! Restarting…");
                    const { relaunch } = await import("@tauri-apps/plugin-process");
                    await relaunch();
                  } catch (e) {
                    toast.error(`Failed to install update: ${e}`);
                  }
                },
              },
        });
      } catch (e) {
        // Update checks must never interrupt startup — log and move on.
        console.error("Failed to check for updates:", e);
      }
    }
    checkForUpdates();
  }, []);

  return null;
}

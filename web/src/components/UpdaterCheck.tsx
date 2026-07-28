import { useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";


export default function UpdaterCheck() {
  useEffect(() => {
    async function checkForUpdates() {
      try {
        const update = await check();
        if (update) {
          toast(`Update v${update.version} available!`, {
            description: "A new version of Nexora is ready to install.",
            duration: 10000,
            action: {
              label: "Install & Restart",
              onClick: async () => {
                const toastId = toast.loading(`Downloading update v${update.version}...`);
                try {
                  await update.downloadAndInstall();
                  toast.success("Update installed!", { id: toastId });
                  // In Tauri v2, we should use the process plugin to restart, or let the updater restart automatically.
                  // Typically, `downloadAndInstall` handles the restart if supported, or we can use:
                  const { relaunch } = await import("@tauri-apps/plugin-process");
                  await relaunch();
                } catch (e) {
                  toast.error(`Failed to install update: ${e}`, { id: toastId });
                }
              },
            },
          });
        }
      } catch (e) {
        console.error("Failed to check for updates:", e);
      }
    }
    checkForUpdates();
  }, []);

  return null;
}

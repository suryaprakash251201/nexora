import { Platform, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
// StorageAccessFramework lives in the legacy entry of expo-file-system (SDK 54).
// It is Android-only and is the permission-free way to write into any
// user-picked folder (e.g. Downloads) on API 29+.
import * as LegacyFS from "expo-file-system/legacy";

const KEY_SAF_DIR = "nexora.safDownloadDir";

export type SaveResult = "saved" | "shared" | "cancelled";

/** Sanitizes a file name for the device filesystem / SAF display name. */
function safeName(name: string): string {
  return name.replace(/[^\w.\- ()\[\]]+/g, "_").slice(0, 120) || "file";
}

/**
 * Downloads `url` (already authenticated) into the shared app cache and
 * returns the local File. Callers use it for share/save/open flows.
 */
export async function downloadToCache(
  url: string,
  name: string
): Promise<File> {
  const target = new File(Paths.cache, "nexora-" + safeName(name));
  await File.downloadFileAsync(url, target);
  return target;
}

/**
 * Saves a downloaded cache file to a real user-visible location.
 *
 * Android — uses the Storage Access Framework: the first save asks the user
 * to pick a destination folder (typically Downloads); the grant is persisted
 * so subsequent saves land there without re-prompting. No storage permission
 * is needed on API 29+.
 *
 * iOS — opens the system share sheet where "Save to Files" (and per-type
 * targets like Photos) are offered by the OS.
 */
export async function saveToDevice(
  cacheFile: File,
  fileName: string,
  mimeType?: string
): Promise<SaveResult> {
  if (Platform.OS === "android") {
    try {
      let dirUri = await AsyncStorage.getItem(KEY_SAF_DIR);
      if (!dirUri) {
        const perms =
          await LegacyFS.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perms.granted) return "cancelled";
        dirUri = perms.directoryUri;
        await AsyncStorage.setItem(KEY_SAF_DIR, dirUri);
      }

      const displayName = safeName(fileName);
      const mime = mimeType || "application/octet-stream";
      // SAF refuses duplicate names with an unclear error — uniquify.
      const finalName = await uniqueSafName(dirUri!, displayName, mime);
      const fileUri =
        await LegacyFS.StorageAccessFramework.createFileAsync(
          dirUri!,
          finalName,
          mime
        );
      await LegacyFS.copyAsync({ from: cacheFile.uri, to: fileUri });
      return "saved";
    } catch (e: any) {
      // A persisted grant can become stale after app data clears or the
      // folder is removed — drop it so the next attempt re-prompts.
      await AsyncStorage.removeItem(KEY_SAF_DIR).catch(() => {});
      throw e;
    }
  }

  // iOS: the system share sheet exposes "Save to Files" / "Save Image".
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(cacheFile.uri, { mimeType });
    return "shared";
  }
  throw new Error("Sharing is not available on this device");
}

/**
 * Appends " (1)", " (2)", … before the extension until the SAF directory no
 * longer contains the name. Cheap because document trees are small.
 */
async function uniqueSafName(
  dirUri: string,
  fileName: string,
  mime: string
): Promise<string> {
  try {
    const existing = new Set(
      (await LegacyFS.StorageAccessFramework.readDirectoryAsync(dirUri)).map(
        (u: string) => decodeURIComponent(u.split("/").pop() || "").toLowerCase()
      )
    );
    if (!existing.has(fileName.toLowerCase())) return fileName;
    const dot = fileName.lastIndexOf(".");
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : "";
    for (let i = 1; i < 1000; i++) {
      const candidate = `${stem} (${i})${ext}`;
      if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return `${stem}-${Date.now()}${ext}`;
  } catch {
    void mime;
    return fileName;
  }
}

/** Shared success/cancel alerting for screens. */
export function reportSaveResult(result: SaveResult, fileName: string) {
  if (result === "saved") {
    Alert.alert("Saved", `"${fileName}" was saved to your selected folder.`);
  } else if (result === "cancelled") {
    Alert.alert(
      "Folder needed",
      "Pick a destination folder (e.g. Downloads) to save files. You can also open Settings to reset the saved location.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset folder",
          style: "destructive",
          onPress: async () => {
            await AsyncStorage.removeItem(KEY_SAF_DIR).catch(() => {});
          },
        },
      ]
    );
  }
}

/**
 * Deep link parser — see LoginScreen.
 *
 * Accepts `nexora://connect?url=<encoded server url>` so desktop/web users can
 * hand their server address to the phone (e.g. via a QR code). Returns the
 * server URL, or null when the link isn't a connect link.
 */
export function parseServerDeepLink(url: string | null): string | null {
  if (!url || !url.toLowerCase().startsWith("nexora:")) return null;
  try {
    const u = new URL(url);
    if ((u.hostname || u.host) !== "connect") return null;
    const target = u.searchParams.get("url");
    return target && /^https?:\/\//i.test(target) ? target : null;
  } catch {
    return null;
  }
}

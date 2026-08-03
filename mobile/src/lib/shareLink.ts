import { Alert } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Api } from "../api/client";

/** Create a public share link for a file and copy it to the clipboard. */
export async function copyShareLink(api: Api, rootId: string, path: string): Promise<string | null> {
  try {
    const res = await api.createShare(rootId, path, "preview");
    const url = res.share.url;
    await Clipboard.setStringAsync(url);
    return url;
  } catch (e: any) {
    Alert.alert("Could not create link", e?.message || "Something went wrong.");
    return null;
  }
}

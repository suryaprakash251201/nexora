import { getMediaUrl } from "@/api/client";

/** Thumbnail URL for a photo (root + path). */
export function photoThumb(rootId: string, path: string, size = 640): string {
  return getMediaUrl("/files/thumbnail", { root: rootId, path, size });
}

/** Full-resolution URL, optionally with download disposition. */
export function photoRaw(rootId: string, path: string, download = false): string {
  return getMediaUrl("/files/raw", { root: rootId, path, download: download ? 1 : undefined });
}

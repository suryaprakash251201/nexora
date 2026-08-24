import { startDownload } from "../../lib/transfer";
import { isTauriRuntime } from "../../lib/preview";
import type { FileItem } from "../../api/types";

/** Clamp a number into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** "01" style two-digit page label used by the signature page counter. */
export function padPage(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Parse a PDF date string ("D:20260104120530+05'30'") into an ISO-ish
 * displayable string. Hand-rolled so pdf.js stays a lazy import.
 */
export function parsePdfDate(raw?: string): string | undefined {
  if (!raw || !raw.startsWith("D:")) return undefined;
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(raw);
  if (!m) return undefined;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00"] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

/**
 * Subsequence fuzzy match used by the document command bar. Returns a score
 * (higher = better) or -1 when the query isn't a subsequence of the text.
 * Consecutive and word-boundary hits score higher; case-insensitive.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      streak++;
      // Word-start bonus.
      const wordStart = ti === 0 || /\s|[-_/]/.test(t[ti - 1]);
      score += wordStart ? 3 : 1;
      // Consecutive-character bonus grows the longer the run.
      score += streak * 0.5;
      qi++;
    } else {
      streak = 0;
    }
  }
  if (qi < q.length) return -1;
  // Prefer shorter labels for equal matches.
  return score - t.length * 0.01;
}

/** Trigger a download through the app's streaming transfer pipeline. */
export function downloadItem(item: FileItem): void {
  startDownload(item.root_id, item.path, item.name);
}

/**
 * Open a URL in a new browser tab, or via the OS shell inside Tauri.
 */
export async function openInNewTab(url: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    } catch (e) {
      console.error("DocumentSpace: shell open failed", e);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Print the PDF by loading it into a hidden iframe and invoking the browser's
 * native print dialog on it — canvas-rendered pages can't use window.print().
 * The iframe is removed afterwards. Returns false if printing could not start.
 */
export function printPdfUrl(url: string): boolean {
  try {
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.opacity = "0";
    frame.style.border = "0";
    frame.src = url;
    frame.addEventListener("load", () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch (e) {
        console.error("DocumentSpace: print failed", e);
      }
      setTimeout(() => frame.remove(), 60_000);
    });
    document.body.appendChild(frame);
    return true;
  } catch (e) {
    console.error("DocumentSpace: print failed", e);
    return false;
  }
}

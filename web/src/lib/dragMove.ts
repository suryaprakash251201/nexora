/**
 * Internal move-drag engine for the file workspace.
 *
 * A tiny module-level store describes the drag in flight so ANY surface —
 * folder rows/cards, breadcrumbs, sidebar storage entries — can validate
 * and accept it without prop threading.
 *
 * Identification: drags set the `application/x-nexora-move` dataTransfer
 * type. Surfaces treat that as an internal MOVE; anything advertising
 * `Files` is an OS upload drag; plain text is a text selection. This
 * replaces the old fragile heuristics.
 */
import { create } from "zustand";
import type { FileItem } from "../api/types";

export const MOVE_MIME = "application/x-nexora-move";

export interface DragMovePayload {
  paths: string[];
  /** Display names parallel to paths (for the preview chip). */
  names: string[];
  /** Primary item kind (controls folder/file icon in preview). */
  primaryIsDir: boolean;
  primaryName: string;
}

interface DragMoveState {
  active: boolean;
  paths: string[];
  names: string[];
  count: number;
  primaryIsDir: boolean;
  primaryName: string;
  begin: (p: DragMovePayload) => void;
  end: () => void;
}

export const useDragMove = create<DragMoveState>((set) => ({
  active: false,
  paths: [],
  names: [],
  count: 0,
  primaryIsDir: false,
  primaryName: "",
  begin: (p) => set({ active: true, paths: p.paths, names: p.names, count: p.paths.length, primaryIsDir: p.primaryIsDir, primaryName: p.primaryName }),
  end: () => set({ active: false, paths: [], names: [], count: 0, primaryIsDir: false, primaryName: "" }),
}));

/** True when this drag event carries an internal Nexora move payload. */
export function isInternalMoveDrag(e: { dataTransfer: DataTransfer | null; types?: readonly string[] }): boolean {
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : (e.types as readonly string[] | undefined);
  return !!types?.includes(MOVE_MIME);
}

/**
 * dragover/drop-safe variant of isInternalMoveDrag. Some engines (notably
 * older WebKitGTK on Linux desktop) hide custom dataTransfer types until
 * drop, so a types-only check would never preventDefault and the drop
 * would never fire there. The module store is set on dragstart for every
 * internal move drag, making it an exact fallback: an OS-file drag never
 * activates it, so upload-vs-move discrimination is preserved.
 */
export function isInternalMoveDragEvent(e: { dataTransfer: DataTransfer | null }): boolean {
  if (isInternalMoveDrag(e)) return true;
  return useDragMove.getState().active;
}

/**
 * Start a move drag from a source item/selection: publishes the payload to
 * the store, stamps the dataTransfer, and installs a premium floating
 * preview as the native drag image.
 */
export function beginDragMove(
  e: React.DragEvent | DragEvent,
  payload: DragMovePayload,
): void {
  const dt = e.dataTransfer;
  if (!dt) return;
  dt.effectAllowed = "move";
  try {
    dt.setData(MOVE_MIME, JSON.stringify({ paths: payload.paths }));
    // Fallback text for targets that only understand text.
    dt.setData("text/plain", payload.paths.join("\n"));
  } catch {
    /* some engines restrict setData during synthetic events — store still drives us */
  }

  useDragMove.getState().begin(payload);

  // Premium drag image: glass chip with icon + name (+ "+N more").
  // Built imperatively so it exists painted at setDragImage() time.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;top:-9999px;left:-9999px;z-index:-1;";
  const chip = document.createElement("div");
  chip.className =
    "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium " +
    "text-white bg-[#141724ee] border border-[#5b8cff66] shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-md";
  const icon = document.createElement("span");
  icon.textContent = payload.primaryIsDir ? "📁" : "📄";
  icon.style.cssText = "font-size:15px;line-height:1;";
  const label = document.createElement("span");
  label.textContent = truncateName(payload.primaryName, 28);
  chip.append(icon, label);

  if (payload.paths.length > 1) {
    const badge = document.createElement("span");
    badge.className =
      "rounded-full bg-[#5b8cff33] border border-[#5b8cff55] px-2 py-0.5 text-[11px] font-semibold text-[#a9c3ff]";
    badge.textContent = `+${payload.paths.length - 1} more`;
    chip.append(badge);
    // Stacked-card hint behind the chip.
    const stack = document.createElement("div");
    stack.style.cssText =
      "position:absolute;inset:6px -6px -6px 8px;border-radius:12px;" +
      "background:#10131fee;border:1px solid #ffffff14;z-index:-1;";
    chip.style.position = "relative";
    host.appendChild(stack);
  }
  host.appendChild(chip);
  document.body.appendChild(host);
  try {
    e.dataTransfer?.setDragImage(host, 18, 18);
  } catch {
    /* default snapshot fallback */
  }
  window.setTimeout(() => host.remove(), 0);
}

/**
 * Drop validation: a folder may receive a drag only if no dragged path IS
 * the folder or an ancestor of it (never drop into yourself/descendants).
 */
export function canDropInto(targetDir: string, paths: string[]): boolean {
  return !paths.some((p) => p === targetDir || targetDir.startsWith(p + "/"));
}

/** Current live payload (paths) for validation inside dragover handlers. */
export function currentDragPaths(): string[] {
  return useDragMove.getState().paths;
}

/** Clear any active drag (call from drop + dragend). */
export function endDragMove(): void {
  useDragMove.getState().end();
}

function truncateName(name: string, max: number): string {
  return name.length <= max ? name : name.slice(0, max - 1) + "…";
}

/** Convenience used by FileBrowser to assemble a payload from a selection. */
export function payloadFromItems(items: FileItem[]): DragMovePayload {
  const primary = items[0];
  return {
    paths: items.map((i) => i.path),
    names: items.map((i) => i.name),
    primaryIsDir: !!primary?.is_dir,
    primaryName: primary?.name ?? "",
  };
}

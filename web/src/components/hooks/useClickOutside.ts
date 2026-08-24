import { useEffect, useRef, type RefObject } from "react";

export function useClickOutside(
  refs: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[],
  onOutside: () => void,
  enabled = true,
  options?: { escape?: boolean; scroll?: boolean },
) {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  const refList = useRef<RefObject<HTMLElement | null>[]>([]);
  refList.current = Array.isArray(refs) ? refs : [refs];

  useEffect(() => {
    if (!enabled) return;
    const isInside = (t: Node | null) =>
      !!t && refList.current.some((r) => r.current?.contains(t));
    const onDown = (e: MouseEvent) => {
      if (!isInside(e.target as Node)) cb.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (options?.escape !== false && e.key === "Escape") cb.current();
    };
    // Close when the page behind scrolls, but never when the element's own
    // scrollable content scrolls (e.g. the playlist picker's track list) —
    // otherwise the first wheel tick inside the menu would dismiss it.
    const onScroll = (e: Event) => {
      if (!isInside(e.target as Node)) cb.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    if (options?.scroll !== false) window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      if (options?.scroll !== false) window.removeEventListener("scroll", onScroll, true);
    };
  }, [enabled, options?.escape, options?.scroll]);
}

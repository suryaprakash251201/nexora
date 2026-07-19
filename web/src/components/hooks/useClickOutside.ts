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
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (refList.current.some((r) => r.current?.contains(t))) return;
      cb.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (options?.escape !== false && e.key === "Escape") cb.current();
    };
    const onScroll = () => { if (options?.scroll !== false) cb.current(); };
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

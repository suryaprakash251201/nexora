import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

export default function ContextMenu({
  x, y, items, onClose,
}: {
  x: number; y: number; items: MenuItem[]; onClose: () => void;
}) {
  const [pos, setPos] = useState({ x, y });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = 220;
    const h = items.length * 36 + 16;
    let nx = x;
    let ny = y;
    if (x + w > window.innerWidth) nx = window.innerWidth - w - 8;
    if (y + h > window.innerHeight) ny = window.innerHeight - h - 8;
    setPos({ x: nx, y: ny });
  }, [x, y, items.length]);

  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      const menu = menuRef.current;
      if (!menu) return;
      const entries = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const idx = entries.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); entries[(idx + 1 + entries.length) % entries.length]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); entries[(idx - 1 + entries.length) % entries.length]?.focus(); }
      else if (e.key === "Home") { e.preventDefault(); entries[0]?.focus(); }
      else if (e.key === "End") { e.preventDefault(); entries[entries.length - 1]?.focus(); }
    };
    const el = menuRef.current;
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  }, [onClose, items.length]);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.95, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -4 }}
        transition={{ duration: 0.12, ease: [0.25, 0.1, 0.25, 1] }}
        role="menu"
        aria-label="File actions"
        className="fixed z-50 min-w-[220px] glass-strong rounded-xl py-1.5 shadow-2xl outline-none"
        style={{ left: pos.x, top: pos.y, transformOrigin: "top left" }}
        tabIndex={-1}
      >
        {items.map((it, i) => {
          if (it.divider) return <div key={i} className="h-px w-full glass-divider my-1" />;
          return (
            <button
              key={i}
              role="menuitem"
              disabled={it.disabled}
              onClick={() => { it.onClick?.(); onClose(); }}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-left outline-none transition-colors
                ${it.disabled ? "opacity-40 cursor-not-allowed" : "cursor-default"}
                ${it.danger ? "text-danger hover:bg-danger/10 focus:bg-danger/10" : "text-content hover:bg-accent/15 hover:text-accent focus:bg-accent/15 focus:text-accent"}`}
            >
              <span className={`opacity-80 ${it.danger ? "text-danger" : ""}`}>{it.icon}</span>
              <span className="flex-1">{it.label}</span>
            </button>
          );
        })}
      </motion.div>
    </AnimatePresence>
  );
}

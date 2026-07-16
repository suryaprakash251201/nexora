import { useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const [pos, setPos] = useState({ x, y });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Keep menu on-screen.
    const w = 200;
    const h = items.length * 36 + 12;
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
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        entries[(idx + 1 + entries.length) % entries.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        entries[(idx - 1 + entries.length) % entries.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        entries[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        entries[entries.length - 1]?.focus();
      }
    };
    menuRef.current?.addEventListener("keydown", onKey);
    return () => menuRef.current?.removeEventListener("keydown", onKey);
  }, [onClose, items.length]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={menuRef}
        role="menu"
        aria-label="File actions"
        className="fixed z-50 min-w-[200px] glass-strong rounded-lg py-1 text-sm"
        style={{ left: pos.x, top: pos.y }}
      >
        {items.map((it, i) => (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => { it.onClick(); onClose(); }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left disabled:opacity-40 ${
              it.danger ? "text-red-500 hover:bg-red-500/10" : "glass-hover"
            }`}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}

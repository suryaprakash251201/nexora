import { useEffect, useState } from "react";

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

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 min-w-[200px] bg-surface-elevated border rounded-lg shadow-lg py-1 text-sm"
        style={{ left: pos.x, top: pos.y }}
      >
        {items.map((it, i) => (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => { it.onClick(); onClose(); }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left disabled:opacity-40 ${
              it.danger ? "text-red-500 hover:bg-red-500/10" : "hover:bg-surface-muted"
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

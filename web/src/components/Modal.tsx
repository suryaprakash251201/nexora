import { ReactNode, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../lib/useFocusTrap";

export function Modal({ title, onClose, children, footer }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panelRef, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md glass-strong rounded-xl outline-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b glass-divider">
          <h2 id={titleId} className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="p-1 rounded glass-hover">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="px-4 py-3 border-t flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

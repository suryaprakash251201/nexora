import { ReactNode, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../lib/useFocusTrap";

export function Modal({ title, description, icon, onClose, children, footer }: {
  title: string;
  description?: string;
  icon?: ReactNode;
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
        <div className="flex items-start justify-between px-6 py-4 border-b border-border/50 bg-surface/30">
          <div className="flex gap-4">
            {icon && (
              <div className="h-12 w-12 rounded-2xl bg-accent/10 flex items-center justify-center shrink-0 border border-accent/20">
                {icon}
              </div>
            )}
            <div>
              <h2 id={titleId} className="font-bold text-lg">{title}</h2>
              {description && <p className="text-sm text-content-muted mt-1">{description}</p>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="p-1 rounded glass-hover">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-border/50 bg-surface/50 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}

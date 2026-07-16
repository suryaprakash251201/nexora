import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useUI } from "../store";

export default function Toaster() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]"
      role="region"
      aria-label="Notifications"
      aria-live={toasts.some((t) => t.kind === "error") ? "assertive" : "polite"}
    >
      {toasts.map((t) => (
        <div key={t.id} className="toast-in flex items-start gap-2 glass-strong rounded-lg p-3" role="status">
          {t.kind === "success" && <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />}
          {t.kind === "error" && <AlertCircle className="h-4 w-4 text-red-500 mt-0.5" />}
          {t.kind === "info" && <Info className="h-4 w-4 text-accent mt-0.5" />}
          <span className="text-sm flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="text-content-muted hover:text-content glass-hover rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

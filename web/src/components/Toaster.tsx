import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useUI } from "../store";

export default function Toaster() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);

  return (
    <div
      className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-[100] flex flex-col gap-3 w-80 max-w-[calc(100vw-2rem)] pointer-events-none"
      role="region"
      aria-label="Notifications"
      aria-live={toasts.some((t) => t.kind === "error") ? "assertive" : "polite"}
    >
      {toasts.map((t) => (
        <div 
          key={t.id} 
          className="pointer-events-auto animate-slide-in-right glass-strong rounded-xl shadow-2xl flex flex-col overflow-hidden border border-border/50 bg-surface/80 backdrop-blur-xl" 
          role="status"
        >
          <div className="flex items-start gap-3 p-4">
            {t.kind === "success" && <CheckCircle2 className="h-5 w-5 text-success shrink-0" />}
            {t.kind === "error" && <AlertCircle className="h-5 w-5 text-danger shrink-0" />}
            {t.kind === "info" && <Info className="h-5 w-5 text-accent shrink-0" />}
            
            <span className="text-sm flex-1 font-medium leading-tight pt-0.5">{t.message}</span>
            
            <button 
              onClick={() => dismiss(t.id)} 
              aria-label="Dismiss notification" 
              className="text-content-muted hover:text-content glass-hover p-1.5 rounded-lg transition-colors -mt-1 -mr-1 shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          
          <div className="h-1 w-full bg-border/50">
            <div className={`h-full animate-[n-progress-bar_4s_linear_forwards] origin-left
              ${t.kind === "success" ? "bg-success" : t.kind === "error" ? "bg-danger" : "bg-accent"}`} 
            />
          </div>
        </div>
      ))}
    </div>
  );
}

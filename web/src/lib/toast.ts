/**
 * Single toast API for the whole app, backed by the custom themed Toaster
 * (useUI store). Replaces the parallel sonner instance so notifications have
 * one visual system and one auto-dismiss policy.
 *
 * Callable directly (`toast("Saved")`) and via kind helpers
 * (`toast.success/error/info/loading`). Works outside React components
 * through getState().
 */
import { useUI } from "../store";

type Options = {
  description?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
};

function emit(kind: "success" | "error" | "info", message: string, opts?: Options) {
  const text = opts?.description ? `${message} — ${opts.description}` : message;
  useUI.getState().pushToast(kind, text, opts?.action, opts?.duration);
}

interface ToastFn {
  (message: string, opts?: Options): void;
  success: (message: string, opts?: Options) => void;
  error: (message: string, opts?: Options) => void;
  info: (message: string, opts?: Options) => void;
  /** Loading toasts become plain info notices in the unified system. */
  loading: (message: string, opts?: Options) => void;
}

const toast: ToastFn = ((message: string, opts?: Options) => emit("info", message, opts)) as ToastFn;
toast.success = (m, o) => emit("success", m, o);
toast.error = (m, o) => emit("error", m, o);
toast.info = (m, o) => emit("info", m, o);
toast.loading = (m, o) => emit("info", m, o);

export { toast };

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const message = this.state.error?.message || "An unexpected error occurred";
      const stack = this.state.error?.stack || "";
      return (
        <div className="h-screen grid place-items-center bg-background p-8">
          <div className="text-center max-w-md w-full">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-danger/10 border border-danger/20 flex items-center justify-center text-danger mb-4">
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
            </div>
            <h1 className="text-2xl font-bold text-content mb-2">Something went wrong</h1>
            <p className="text-content-muted text-sm mb-4">{message}</p>
            {stack && (
              <details className="text-left mb-4 max-h-40 overflow-y-auto custom-scrollbar rounded-xl border border-border/50 bg-surface/40 p-3">
                <summary className="text-xs font-medium text-content-muted cursor-pointer select-none">Error details</summary>
                <pre className="mt-2 text-[10px] font-mono text-content-muted whitespace-pre-wrap break-all">{stack}</pre>
              </details>
            )}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { this.reset(); window.location.reload(); }}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
              >
                Reload page
              </button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`${message}

${stack}`);
                  } catch { /* ignore */ }
                }}
                className="px-4 py-2 rounded-xl border border-glass-border text-sm font-medium text-content-muted hover:text-content hover:bg-glass-bg transition"
              >
                Copy error details
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

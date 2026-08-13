import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "./Button";

export function QueryError({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center animate-fade-in">
      <div className="h-12 w-12 rounded-2xl bg-danger/10 flex items-center justify-center text-danger border border-danger/20">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div>
        <p className="font-semibold text-content">Couldn't load data</p>
        <p className="text-sm text-content-muted mt-1 max-w-sm">
          {message || "Something went wrong while loading this view. Please try again."}
        </p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} icon={<RotateCcw className="h-3.5 w-3.5" />}>
          Try again
        </Button>
      )}
    </div>
  );
}

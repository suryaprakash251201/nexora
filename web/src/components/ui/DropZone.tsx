import { Upload } from 'lucide-react';

interface DropZoneProps {
  active: boolean;
  message?: string;
  subMessage?: string;
}

export function DropZone({ active, message = 'Drop files to upload', subMessage }: DropZoneProps) {
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center scrim backdrop-blur-sm pointer-events-none animate-fade-in">
      <div className="glass-strong rounded-2xl px-10 py-12 text-center animate-scale-in">
        <div className="empty-state-icon w-20 h-20 mx-auto mb-4">
          <Upload className="h-10 w-10 text-accent" />
        </div>
        <p className="text-lg font-semibold mb-1">{message}</p>
        {subMessage && <p className="text-sm text-content-muted">{subMessage}</p>}
      </div>
    </div>
  );
}

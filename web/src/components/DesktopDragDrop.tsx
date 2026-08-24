import { useEffect, useState } from "react";
import { UploadCloud, FolderOpen } from "lucide-react";
import { useUI, type Toast } from "../store";
import { isTauri } from "../lib/desktop";

interface DesktopDragDropProps {
  rootId: string | null;
  path: string;
  canWrite: boolean;
  onUpload: (files: File[]) => void;
}

/**
 * Enables dragging files from the OS file manager straight into the app.
 * Dropped files are read from disk (Tauri fs plugin) and uploaded to the
 * currently open folder through the normal multipart upload pipeline, so
 * progress, notifications and error handling all keep working.
 */
export default function DesktopDragDrop({ rootId, path, canWrite, onUpload }: DesktopDragDropProps) {
  const [over, setOver] = useState(false);
  const [folder, setFolder] = useState("");
  const pushToast = useUI((s) => s.pushToast);

  useEffect(() => {
    if (!isTauri() || !rootId) return;
    let un: (() => void) | undefined;

    import("@tauri-apps/api/webviewWindow")
      .then(async ({ getCurrentWebviewWindow }) => {
        const win = getCurrentWebviewWindow();
        un = await win.onDragDropEvent((event) => {
          const type = event.payload.type;
          if ((type === "enter" || type === "over") && canWrite) {
            setFolder(path || "/");
            setOver(true);
          } else if (type === "leave") {
            setOver(false);
          } else if (type === "drop") {
            setOver(false);
            if (!rootId || !canWrite) return;
            void handleDrop(event.payload.paths, rootId, path, onUpload, pushToast);
          }
        });
      })
      .catch(() => {});

    return () => {
      un?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, path, canWrite]);

  if (!over) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-float)] pointer-events-none grid place-items-center p-8">
      <div className="w-full max-w-md rounded-2xl border-2 border-dashed border-accent/70 bg-glass-bg-strong/80 backdrop-blur-md shadow-glass-strong p-8 text-center">
        <div className="mx-auto grid place-items-center h-14 w-14 rounded-full bg-accent/15 text-accent">
          <UploadCloud className="h-7 w-7" />
        </div>
        <p className="mt-4 font-semibold text-lg">Drop to upload</p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-content-muted">
          <FolderOpen className="h-4 w-4" />
          {folder || "/"}
        </p>
        <p className="mt-3 text-xs text-content-muted/60">
          Files will be uploaded to this folder with transfer progress shown below.
        </p>
      </div>
    </div>
  );
}

async function handleDrop(
  paths: string[],
  rootId: string,
  path: string,
  onUpload: (files: File[]) => void,
  pushToast: (kind: Toast["kind"], message: string, action?: Toast["action"]) => void
) {
  try {
    const { stat, readFile } = await import("@tauri-apps/plugin-fs");
    const files: File[] = [];
    const skippedFolders: string[] = [];
    let denied = 0;

    for (const p of paths) {
      try {
        const info = await stat(p);
        if (!info.isFile) {
          skippedFolders.push(p.split(/[\\/]/).pop() || p);
          continue;
        }
        const bytes = await readFile(p);
        const name = p.split(/[\\/]/).pop() || "file";
        files.push(new File([bytes], name, { lastModified: info.mtime?.getTime() ?? Date.now() }));
      } catch (e) {
        // Permission denials are the common case here: fs reads are scoped
        // to Downloads/temp/app dirs. Never swallow them — a dead-looking
        // drop zone is far worse than an honest message.
        denied++;
        console.debug("[desktop] drop read failed:", p, e);
      }
    }

    if (skippedFolders.length) {
      pushToast("info", `Skipped ${skippedFolders.length} folder${skippedFolders.length > 1 ? "s" : ""} — folder drag & drop isn't supported yet`);
    }
    if (denied) {
      pushToast(
        "error",
        `${denied} file${denied > 1 ? "s" : ""} couldn't be read (access denied) — copy ${denied > 1 ? "them" : "it"} into Downloads or use the upload button.`,
      );
    }
    if (files.length) onUpload(files);
  } catch (e) {
    pushToast("error", `Drag & drop upload failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

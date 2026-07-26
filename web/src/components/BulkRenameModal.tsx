import { useState, useMemo } from "react";
import { Modal } from "./Modal";
import { Button } from "./ui/Button";
import { RefreshCw } from "lucide-react";
import { post } from "../api/client";
import { useUI } from "../store";

interface BulkRenameModalProps {
  rootId: string;
  items: Array<{ name: string; path: string }>;
  onClose: () => void;
  onDone: () => void;
}

export function BulkRenameModal({ rootId, items, onClose, onDone }: BulkRenameModalProps) {
  const pushToast = useUI((s) => s.pushToast);
  const [mode, setMode] = useState<"replace" | "prefix" | "suffix" | "regex">("replace");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [regex, setRegex] = useState("^(.+)$");
  const [regexReplace, setRegexReplace] = useState("$1");
  const [renaming, setRenaming] = useState(false);

  const previewNames = useMemo(() => {
    if (mode === "replace") {
      return items.map(item => ({
        ...item,
        newName: find ? item.name.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replace) : item.name,
      }));
    }
    if (mode === "prefix") {
      return items.map(item => ({
        ...item,
        newName: replace ? replace + item.name : item.name,
      }));
    }
    if (mode === "suffix") {
      return items.map(item => {
        const dotIdx = item.name.lastIndexOf(".");
        if (dotIdx > 0) {
          const base = item.name.substring(0, dotIdx);
          const ext = item.name.substring(dotIdx);
          return { ...item, newName: replace ? base + replace + ext : item.name };
        }
        return { ...item, newName: replace ? item.name + replace : item.name };
      });
    }
    if (mode === "regex") {
      try {
        const re = new RegExp(regex);
        return items.map(item => ({
          ...item,
          newName: item.name.replace(re, regexReplace),
        }));
      } catch {
        return items.map(item => ({ ...item, newName: item.name }));
      }
    }
    return items.map(item => ({ ...item, newName: item.name }));
  }, [items, mode, find, replace, regex, regexReplace]);

  const hasChanges = previewNames.some((item, idx) => item.newName !== items[idx].name);

  const handleRename = async () => {
    if (!hasChanges) return;
    setRenaming(true);
    let success = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const newName = previewNames[i].newName;
      if (newName === item.name) continue;

      try {
        await post("/files/rename", { root: rootId, path: item.path, name: newName });
        success++;
      } catch {
        failed++;
      }
    }

    if (failed === 0) {
      pushToast("success", `Renamed ${success} file${success !== 1 ? "s" : ""}`);
    } else {
      pushToast("error", `Renamed ${success}, failed ${failed}`);
    }
    setRenaming(false);
    onDone();
  };

  return (
    <Modal
      title={`Bulk Rename (${items.length} files)`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleRename} disabled={!hasChanges || renaming}>
            {renaming ? "Renaming..." : "Apply"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Mode tabs */}
        <div className="flex rounded-xl overflow-hidden bg-glass-bg-subtle p-0.5 border border-glass-border-soft">
          {(["replace", "prefix", "suffix", "regex"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                mode === m ? "bg-glass-bg-strong text-foreground shadow-sm" : "text-text-tertiary hover:text-foreground"
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Inputs based on mode */}
        {mode === "replace" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1 opacity-80">Find text</label>
              <input
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder="Find..."
                className="w-full rounded-lg glass-input px-3 py-2 outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-xs mb-1 opacity-80">Replace with</label>
              <input
                value={replace}
                onChange={(e) => setReplace(e.target.value)}
                placeholder="Replace..."
                className="w-full rounded-lg glass-input px-3 py-2 outline-none text-sm"
              />
            </div>
          </div>
        )}

        {(mode === "prefix" || mode === "suffix") && (
          <div>
            <label className="block text-xs mb-1 opacity-80">
              {mode === "prefix" ? "Add prefix" : "Add suffix"}
            </label>
            <input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder={mode === "prefix" ? "e.g. IMG_" : "e.g. _backup"}
              className="w-full rounded-lg glass-input px-3 py-2 outline-none text-sm"
            />
          </div>
        )}

        {mode === "regex" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1 opacity-80">Pattern (regex)</label>
              <input
                value={regex}
                onChange={(e) => setRegex(e.target.value)}
                placeholder="^(.+)$"
                className="w-full rounded-lg glass-input px-3 py-2 outline-none text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs mb-1 opacity-80">Replacement</label>
              <input
                value={regexReplace}
                onChange={(e) => setRegexReplace(e.target.value)}
                placeholder="$1"
                className="w-full rounded-lg glass-input px-3 py-2 outline-none text-sm font-mono"
              />
            </div>
          </div>
        )}

        {/* Preview */}
        {hasChanges && (
          <div>
            <label className="block text-xs mb-2 opacity-80">Preview</label>
            <div className="max-h-40 overflow-y-auto space-y-1 bg-surface/50 rounded-xl p-2">
              {previewNames.slice(0, 10).map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm">
                  <span className="text-content-muted line-through shrink-0 truncate">{item.name}</span>
                  <RefreshCw className="h-3 w-3 text-content-muted shrink-0" />
                  <span className="text-accent-tertiary font-medium truncate">{item.newName}</span>
                </div>
              ))}
              {previewNames.length > 10 && (
                <p className="text-xs text-content-muted px-2 py-1">
                  + {previewNames.length - 10} more files
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

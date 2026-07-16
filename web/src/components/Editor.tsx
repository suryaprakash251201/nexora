import { useEffect, useRef, useState } from "react";
import { X, Save, Loader2, AlertTriangle } from "lucide-react";
import { get, post } from "../api/client";
import { useUI } from "../store";
import { codeLanguage } from "../lib/preview";
import type { FileItem } from "../api/types";

interface ContentResponse {
  content: string;
  version: string;
  name: string;
  path: string;
  extension: string;
}

export default function Editor({ item, rootId, onClose }: { item: FileItem; rootId: string; onClose: () => void }) {
  const pushToast = useUI((s) => s.pushToast);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [version, setVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const dirty = content !== original;

  useEffect(() => {
    setLoading(true);
    get<ContentResponse>("/files/content", { root: rootId, path: item.path })
      .then((r) => {
        setContent(r.content);
        setOriginal(r.content);
        setVersion(r.version);
      })
      .catch((e: any) => setError(e.message || "Could not open file"))
      .finally(() => setLoading(false));
  }, [item.path, rootId]);

  const save = async (force = false) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await post<{ version: string }>("/files/save", {
        root: rootId,
        path: item.path,
        content,
        version: force ? "" : version,
      });
      setVersion(res.version);
      setOriginal(content);
      pushToast("success", "Saved");
    } catch (e: any) {
      if (e.code === "version_conflict") {
        if (confirm("This file changed on disk since you opened it. Overwrite with your version?")) {
          await save(true);
        }
      } else {
        pushToast("error", e.message || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  // Save shortcut + close. Refs keep the latest handlers without rebinding on
  // every render (which would also swallow in-flight key events).
  const saveRef = useRef(save);
  const tryCloseRef = useRef(() => {});
  useEffect(() => {
    saveRef.current = save;
    tryCloseRef.current = tryClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
      if (e.key === "Escape") tryCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Warn before unloading with unsaved changes.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const tryClose = () => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    onClose();
  };

  const lineCount = content.split("\n").length;
  const syncScroll = () => {
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70" onMouseDown={tryClose}>
      <div className="w-full max-w-5xl h-[88vh] flex flex-col glass-strong rounded-xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b glass-divider">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium truncate">{item.name}</span>
            <span className="text-xs text-content-muted px-1.5 py-0.5 rounded glass-chip">{codeLanguage(item.extension)}</span>
            {dirty && <span className="text-xs text-amber-500">● unsaved</span>}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => save()} disabled={saving || !dirty} className="flex items-center gap-1 rounded-lg accent-glass px-3 py-1.5 text-sm disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </button>
            <button onClick={tryClose} className="p-2 rounded-lg glass-hover"><X className="h-4 w-4" /></button>
          </div>
        </div>
        {loading ? (
          <div className="flex-1 grid place-items-center text-content-muted"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : error ? (
          <div className="flex-1 grid place-items-center text-content-muted">
            <div className="text-center"><AlertTriangle className="h-6 w-6 mx-auto mb-2 text-amber-500" />{error}</div>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden font-mono text-sm">
            <div ref={gutterRef} className="overflow-hidden select-none text-right py-3 px-2 text-content-muted bg-surface-muted border-r" style={{ minWidth: "3.5rem" }}>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} className="leading-6">{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={taRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onScroll={syncScroll}
              spellCheck={false}
              autoFocus
              className="flex-1 resize-none outline-none bg-transparent py-3 px-3 leading-6 whitespace-pre"
              style={{ tabSize: 2 }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

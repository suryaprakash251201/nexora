import { useEffect, useRef, useState } from "react";
import { X, Save, Loader2, AlertTriangle, FileCode2 } from "lucide-react";
import { get, post } from "../api/client";
import { useUI } from "../store";
import { codeLanguage } from "../lib/preview";
import type { FileItem } from "../api/types";
import { Button } from "./ui/Button";

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
      pushToast("success", "File saved successfully");
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = taRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      
      setContent(val.substring(0, start) + "  " + val.substring(end));
      
      // Put cursor right after the inserted tab
      setTimeout(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      }, 0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-6 bg-black/60 backdrop-blur-sm animate-fade-in" onMouseDown={tryClose}>
      <div className="w-full h-full max-w-7xl max-h-[90vh] flex flex-col bg-[#0d1117] rounded-2xl shadow-2xl overflow-hidden border border-[#30363d] animate-scale-in" onMouseDown={(e) => e.stopPropagation()}>
        
        {/* Editor Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#30363d] bg-[#161b22]">
          <div className="flex items-center gap-3 min-w-0">
            <FileCode2 className="h-5 w-5 text-accent opacity-80 shrink-0" />
            <span className="font-semibold text-[#e6edf3] truncate text-sm md:text-base">{item.name}</span>
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#8b949e] px-2 py-0.5 rounded-md bg-[#21262d] border border-[#30363d] hidden sm:block">
              {codeLanguage(item.extension)}
            </span>
            {dirty && <span className="text-xs font-medium text-[#D29922] bg-[#D29922]/10 px-2 py-0.5 rounded-md flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#D29922] animate-pulse" /> Unsaved</span>}
          </div>
          
          <div className="flex items-center gap-2 shrink-0 pl-4">
            <span className="text-xs text-[#8b949e] hidden md:block mr-2 font-mono">
              Ctrl+S to save
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => save()}
              disabled={saving || !dirty}
              icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            >
              Save
            </Button>
            <button onClick={tryClose} className="p-2 rounded-lg text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors ml-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Editor Body */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-[#8b949e]">
            <Loader2 className="h-8 w-8 animate-spin mb-4 text-accent" />
            <p className="font-mono text-sm">Loading file contents...</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center text-[#8b949e]">
            <AlertTriangle className="h-10 w-10 mb-4 text-[#F85149]" />
            <p className="text-[#F85149] font-medium">{error}</p>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden font-mono text-[13px] leading-relaxed relative bg-[#0d1117]">
            {/* Line Numbers Gutter */}
            <div 
              ref={gutterRef} 
              className="overflow-hidden select-none text-right py-4 px-3 text-[#6e7681] bg-[#0d1117] border-r border-[#30363d] shrink-0" 
              style={{ minWidth: "3.5rem" }}
            >
              {Array.from({ length: Math.max(1, lineCount) }, (_, i) => (
                <div key={i} className="leading-6 opacity-60">{i + 1}</div>
              ))}
            </div>
            
            {/* Main Textarea */}
            <textarea
              ref={taRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onScroll={syncScroll}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              autoFocus
              className="flex-1 resize-none outline-none bg-transparent py-4 px-4 text-[#e6edf3] whitespace-pre custom-scrollbar"
              style={{ tabSize: 2, lineHeight: "1.5rem" }}
            />
          </div>
        )}
        
        {/* Editor Footer */}
        <div className="h-7 border-t border-[#30363d] bg-[#161b22] flex items-center justify-between px-3 text-[11px] font-mono text-[#8b949e]">
          <div className="flex gap-4">
            <span>{loading ? 0 : lineCount} lines</span>
            <span>{content.length} chars</span>
          </div>
          <div className="flex gap-4">
            <span>UTF-8</span>
            <span>Spaces: 2</span>
          </div>
        </div>
      </div>
    </div>
  );
}

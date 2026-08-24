/**
 * TextEditor — the edit-mode surface of the text workspace.
 *
 * Layered approach (textarea for native IME/undo/copy/paste + a transparent
 * highlight <pre> underneath + a subdued line-number gutter that scrolls in
 * sync). Word-wrap toggle, current-line tint, search & replace overlay with
 * match navigation, and Tab/Shift+Tab indentation.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowDown, CaseSensitive, Regex, X } from "lucide-react";
import { highlight } from "./highlight";
import { cn } from "@/lib/utils";
import { Button } from "../ui/Button";

export interface TextEditorProps {
  value: string;
  onChange: (v: string) => void;
  language: string;          // highlighter language key ("plain" disables)
  wrap: boolean;
  onWrapChange: (w: boolean) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onCaret?: (line: number, col: number, selCount: number) => void;
  readOnly?: boolean;
}

interface SearchState {
  open: boolean;
  replace: boolean;
  query: string;
  replacement: string;
  matchCase: boolean;
  regex: boolean;
}

export default function TextEditor({
  value,
  onChange,
  language,
  wrap,
  onWrapChange,
  textareaRef,
  onCaret,
}: TextEditorProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState({ line: 1, col: 1 });
  const [search, setSearch] = useState<SearchState>({
    open: false, replace: false, query: "", replacement: "", matchCase: false, regex: false,
  });

  const lines = useMemo(() => value.split("\n"), [value]);
  const html = useMemo(
    () => highlight(value, language) + "\n",
    [value, language]
  );

  // ── caret tracking ──
  const reportCaret = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const upto = ta.value.slice(0, ta.selectionStart);
    const ls = upto.split("\n");
    setCaret({ line: ls.length, col: ls[ls.length - 1].length + 1 });
    onCaret?.(ls.length, ls[ls.length - 1].length + 1, ta.selectionEnd - ta.selectionStart);
  };

  // ── scroll sync (gutter + highlight layer follow the textarea) ──
  const syncScroll = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop;
    }
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = wrap ? 0 : ta.scrollLeft;
    }
    reportCurrentLine();
  };

  // Current-line tint overlay position (single-line files → hide).
  const [lineTop, setLineTop] = useState<number | null>(null);
  const LINE_H = 24; // must match leading-6 (1.5rem)
  const PAD_Y = 16;  // py-4
  const reportCurrentLine = () => {
    const ta = textareaRef.current;
    if (!ta || wrap) { setLineTop(null); return; }
    setLineTop(PAD_Y + (caret.line - 1) * LINE_H - ta.scrollTop);
  };
  useLayoutEffect(reportCaret, [value]);

  // ── indentation ──
  const indent = (outdent: boolean) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    if (start === end && !outdent) {
      onChange(value.slice(0, start) + "  " + value.slice(end));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
      return;
    }
    const sStart = value.lastIndexOf("\n", start - 1) + 1;
    const block = value.slice(sStart, end);
    const adjusted = outdent
      ? block.replace(/^ {1,2}/gm, "")
      : block.replace(/^/gm, "  ");
    onChange(value.slice(0, sStart) + adjusted + value.slice(end));
    requestAnimationFrame(() => { ta.selectionStart = sStart; ta.selectionEnd = sStart + adjusted.length; });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") { e.preventDefault(); indent(e.shiftKey); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setSearch((s) => ({ ...s, open: true }));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setSearch((s) => ({ ...s, open: true, replace: true }));
      return;
    }
    if (e.key === "Escape" && search.open) {
      e.preventDefault();
      setSearch((s) => ({ ...s, open: false }));
    }
  };

  // ── search matches ──
  const matches = useMemo(() => {
    if (!search.open || search.query.length === 0) return [] as number[];
    const out: number[] = [];
    try {
      if (search.regex) {
        const re = new RegExp(search.query, search.matchCase ? "g" : "gi");
        let m: RegExpExecArray | null;
        while ((m = re.exec(value))) {
          out.push(m.index);
          if (m[0].length === 0) re.lastIndex++;
          if (out.length > 2000) break;
        }
      } else {
        const hay = search.matchCase ? value : value.toLowerCase();
        const needle = search.matchCase ? search.query : search.query.toLowerCase();
        let i = hay.indexOf(needle);
        while (i !== -1) {
          out.push(i);
          i = hay.indexOf(needle, i + Math.max(1, needle.length));
          if (out.length > 2000) break;
        }
      }
    } catch { /* invalid regex */ }
    return out;
  }, [search.open, search.query, search.matchCase, search.regex, value]);
  const matchIdxRef = useRef(-1);

  const jumpTo = (index: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(index, index + search.query.length);
    // Scroll cursor into view.
    const before = value.slice(0, index).split("\n").length - 1;
    const targetTop = before * LINE_H - ta.clientHeight / 2 + LINE_H;
    ta.scrollTop = Math.max(0, targetTop);
    syncScroll();
    reportCaret();
  };
  const stepMatch = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const cur = textareaRef.current?.selectionStart ?? 0;
    let nextIdx = matchIdxRef.current;
    if (dir === 1) {
      nextIdx = matches.findIndex((i) => i > cur);
      if (nextIdx === -1) nextIdx = 0;
    } else {
      const before = matches.filter((i) => i < cur);
      nextIdx = before.length ? before.length - 1 : matches.length - 1;
    }
    matchIdxRef.current = nextIdx;
    jumpTo(matches[nextIdx]);
  };
  const replaceOne = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const sel = value.slice(ta.selectionStart, ta.selectionEnd);
    const isMatch = matches.includes(ta.selectionStart) ||
      (search.matchCase ? sel === search.query : sel.toLowerCase() === search.query.toLowerCase());
    if (isMatch) {
      onChange(value.slice(0, ta.selectionStart) + search.replacement + value.slice(ta.selectionEnd));
    }
    setTimeout(() => stepMatch(1), 0);
  };
  const replaceAll = () => {
    if (!search.query) return;
    try {
      if (search.regex) {
        const re = new RegExp(search.query, search.matchCase ? "g" : "gi");
        onChange(value.replace(re, search.replacement));
      } else {
        const parts = (search.matchCase ? value : value.toLowerCase()).split(search.matchCase ? search.query : search.query.toLowerCase());
        // Rebuild preserving original casing via split on original text:
        let out = "";
        let from = 0;
        const hay = search.matchCase ? value : value.toLowerCase();
        let i = hay.indexOf(search.query.toLowerCase());
        while (i !== -1 && search.query) {
          out += value.slice(from, i) + search.replacement;
          from = i + search.query.length;
          i = hay.indexOf(search.query.toLowerCase(), from);
        }
        out += value.slice(from);
        void parts;
        onChange(out);
      }
    } catch { /* invalid regex */ }
  };

  useEffect(() => {
    if (search.open) {
      const el = document.getElementById("tw-search-input") as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }
  }, [search.open]);

  const gutterWidth = `${Math.max(3, String(lines.length).length + 1.5)}ch`;

  return (
    <div className="relative h-full flex min-h-0">
      {/* Gutter */}
      <div
        ref={gutterRef}
        aria-hidden
        className="shrink-0 overflow-hidden select-none border-r border-border/40 bg-surface-muted/40 text-right"
        style={{ width: `calc(${gutterWidth} + 1.5rem)`, scrollbarWidth: "none" }}
      >
        <div className="py-4 pr-3 pl-2 font-mono text-xs leading-6 text-content-muted/50">
          {lines.map((_, i) => (
            <div key={i} className={cn(i + 1 === caret.line && "text-accent/70")}>{i + 1}</div>
          ))}
        </div>
      </div>

      {/* Surface */}
      <div className="relative min-w-0 flex-1">
        {/* Current-line tint (non-wrapped mode) */}
        {!wrap && lineTop !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bg-accent/[0.05] border-y border-accent/[0.07]"
            style={{ top: lineTop, height: LINE_H }}
          />
        )}

        {/* Highlight layer */}
        {language !== "plain" && (
          <pre
            ref={preRef}
            aria-hidden
            className={cn(
              "absolute inset-0 m-0 overflow-hidden px-4 py-4 font-mono text-[13px] leading-6 text-content pointer-events-none",
              wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
            )}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={syncScroll}
          onClick={() => { reportCaret(); reportCurrentLine(); }}
          onKeyUp={reportCaret}
          onSelect={reportCaret}
          spellCheck={false}
          wrap={wrap ? "soft" : "off"}
          aria-label="File content"
          className={cn(
            "relative z-[1] h-full w-full resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-6 text-content outline-none placeholder:text-content-muted/60",
            wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre",
            language !== "plain" && "text-transparent caret-accent"
          )}
          style={{ tabSize: 2 }}
        />

        {/* Wrap toggle */}
        <button
          onClick={() => onWrapChange(!wrap)}
          title={wrap ? "Disable word wrap" : "Enable word wrap"}
          aria-pressed={wrap}
          className="absolute right-3 top-2 z-10 rounded-md border border-border/40 bg-surface-muted/70 p-1 text-content-muted backdrop-blur-sm transition-colors hover:text-content hover:border-border"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {wrap ? (
              <>
                <path d="M3 6h18M3 12h13a3 3 0 1 1 0 6h-3l2-2m-2 2 2 2" />
                <path d="M3 18h7" />
              </>
            ) : (
              <>
                <path d="M3 6h18M3 12h18M3 18h18" />
              </>
            )}
          </svg>
        </button>

        {/* Search / replace overlay */}
        {search.open && (
          <div
            role="search"
            className="absolute right-3 top-10 z-20 w-[min(26rem,calc(100%-1.5rem))] rounded-xl border border-border/60 bg-surface-elevated shadow-lg p-2 space-y-2 animate-scale-in"
          >
            <div className="flex items-center gap-1.5">
              <input
                id="tw-search-input"
                value={search.query}
                onChange={(e) => { setSearch((s) => ({ ...s, query: e.target.value })); matchIdxRef.current = -1; }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); }
                  if (e.key === "Escape") setSearch((s) => ({ ...s, open: false }));
                }}
                placeholder="Find…"
                className="min-w-0 flex-1 rounded-lg border border-border/50 bg-surface-muted/60 px-2.5 py-1.5 text-sm outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/25"
              />
              <span className="shrink-0 text-[11px] tabular-nums text-content-muted w-14 text-center">
                {matches.length ? `${matchIdxRef.current < 0 ? 1 : matchIdxRef.current + 1}/${matches.length}` : "0"}
              </span>
              <IconBtn label="Previous match" onClick={() => stepMatch(-1)}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
              <IconBtn label="Next match" onClick={() => stepMatch(1)}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
              <IconBtn label="Match case" active={search.matchCase} onClick={() => setSearch((s2) => ({ ...s2, matchCase: !s2.matchCase }))}>
                <CaseSensitive className="h-4 w-4" />
              </IconBtn>
              <IconBtn label="Regular expression" active={search.regex} onClick={() => setSearch((s2) => ({ ...s2, regex: !s2.regex }))}>
                <Regex className="h-4 w-4" />
              </IconBtn>
              <IconBtn label="Close search" onClick={() => setSearch((s2) => ({ ...s2, open: false }))}><X className="h-3.5 w-3.5" /></IconBtn>
            </div>
            {search.replace && (
              <div className="flex items-center gap-1.5">
                <input
                  value={search.replacement}
                  onChange={(e) => setSearch((s2) => ({ ...s2, replacement: e.target.value }))}
                  placeholder="Replace with…"
                  className="min-w-0 flex-1 rounded-lg border border-border/50 bg-surface-muted/60 px-2.5 py-1.5 text-sm outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/25"
                />
                <Button variant="secondary" size="sm" disabled={!matches.length} onClick={replaceOne}>Replace</Button>
                <Button variant="secondary" size="sm" disabled={!matches.length} onClick={replaceAll}>All</Button>
              </div>
            )}
            <div className="flex items-center gap-3 px-0.5 pb-0.5">
              <button className="text-[11px] text-content-muted hover:text-content transition-colors" onClick={() => setSearch((s2) => ({ ...s2, replace: !s2.replace }))}>
                {search.replace ? "Hide replace" : "Replace…"}
              </button>
              <span className="ml-auto text-[10px] text-content-muted/70">Enter · next · Shift+Enter · prev</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({ children, label, active, onClick }: {
  children: React.ReactNode; label: string; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-md p-1.5 transition-colors",
        active ? "bg-accent/15 text-accent" : "text-content-muted hover:bg-glass-bg hover:text-content"
      )}
    >
      {children}
    </button>
  );
}

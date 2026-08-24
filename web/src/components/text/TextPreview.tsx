/**
 * TextPreview — read-mode renderers, chosen per file type:
 *   Markdown → rendered document · JSON → collapsible tree
 *   CSV/TSV  → clean table        · logs → timestamp-emphasized viewer
 *   everything else → comfortable reading surface for plain text/code.
 */
import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { renderMarkdown } from "../../lib/markdown";
import { looksLikeLog, tryPrettyJson } from "./highlight";
import { cn } from "@/lib/utils";

export type PreviewFlavor = "markdown" | "json" | "csv" | "log" | "plain";

export function pickFlavor(extension: string, content: string): PreviewFlavor {
  const ext = extension.toLowerCase();
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (ext === "json" || ext === "geojson") return "json";
  if (["csv", "tsv"].includes(ext)) return "csv";
  if (["log", "out"].includes(ext) || looksLikeLog(content)) return "log";
  return "plain";
}

const MAX_PREVIEW = 400_000;

export default function TextPreview({ content, flavor }: { content: string; flavor: PreviewFlavor }) {
  const shown = content.length > MAX_PREVIEW ? content.slice(0, MAX_PREVIEW) : content;
  switch (flavor) {
    case "markdown":
      return <MarkdownView src={shown} />;
    case "json":
      return <JsonView src={shown} />;
    case "csv":
      return <TableView src={shown} />;
    case "log":
      return <LogView src={shown} />;
    default:
      return <PlainView src={shown} />;
  }
}

/* ── Markdown ── */
function MarkdownView({ src }: { src: string }) {
  return (
    <div className="h-full overflow-auto">
      <div
        className="markdown-body mx-auto max-w-[46rem] px-6 py-8 md:px-10 md:py-10"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(src) }}
      />
    </div>
  );
}

/* ── Plain / code reading ── */
function PlainView({ src }: { src: string }) {
  return (
    <div className="h-full overflow-auto">
      <pre className="mx-auto max-w-[52rem] whitespace-pre-wrap break-words px-6 py-6 font-mono text-[13px] leading-6 text-content/90 md:px-10">
        {src}
      </pre>
    </div>
  );
}

/* ── CSV / TSV table ── */
function TableView({ src }: { src: string }) {
  const rows = useMemo(() => {
    const delim = src.includes("\t") && !src.includes(",") ? "\t" : ",";
    const lines = src.split(/\r?\n/).filter((l) => l.length > 0).slice(0, 5000);
    return lines.map((line) => {
      // Simple split honoring double-quoted fields.
      const out: string[] = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') inQ = false;
          else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === delim) { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    });
  }, [src]);
  const [head, ...body] = rows;

  return (
    <div className="h-full overflow-auto">
      <table className="w-max min-w-full border-collapse text-sm">
        <thead>
          <tr>
            {head?.map((h, i) => (
              <th key={i} className="sticky top-0 border-b border-border bg-surface-elevated px-4 py-2.5 text-left font-semibold text-content">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className={cn(ri % 2 === 1 && "bg-surface-muted/30", "hover:bg-accent/[0.04]")}>
              {head?.map((_, ci) => (
                <td key={ci} className="whitespace-nowrap border-b border-border/30 px-4 py-2 text-content/80">
                  {r[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length >= 5000 && (
        <p className="p-4 text-xs text-content-muted">Preview truncated at 5,000 rows.</p>
      )}
    </div>
  );
}

/* ── Log viewer ── */
function LogView({ src }: { src: string }) {
  const [query, setQuery] = useState("");
  const lines = useMemo(() => src.split(/\r?\n/), [src]);
  const filtered = query ? lines.filter((l) => l.toLowerCase().includes(query.toLowerCase())) : lines;
  const tsRe = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\w{3} +\d{1,2} \d{2}:\d{2}:\d{2})/;
  const levelRe = /\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|ERR)\b/;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/40 px-4 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter lines…"
          aria-label="Filter log lines"
          className="w-full max-w-md rounded-lg border border-border/50 bg-surface-muted/60 px-3 py-1.5 text-sm outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/25"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-3 font-mono text-xs leading-6">
        {filtered.map((l, i) => {
          const ts = l.match(tsRe);
          const level = l.match(levelRe)?.[1]?.toUpperCase();
          const levelCls =
            level === "ERROR" || level === "FATAL" || level === "ERR" ? "text-danger"
            : level === "WARN" || level === "WARNING" ? "text-warning"
            : level === "DEBUG" || level === "TRACE" ? "text-content-muted/70"
            : "text-info";
          return (
            <div key={i} className="flex gap-3 whitespace-pre px-4 hover:bg-accent/[0.04]">
              <span className="w-12 shrink-0 select-none text-right text-content-muted/40">{i + 1}</span>
              {ts ? <span className="shrink-0 text-info/80">{ts[1]}</span> : null}
              {level && <span className={cn("shrink-0 font-semibold w-12", levelCls)}>{level}</span>}
              <span className={cn("min-w-0 flex-1 break-all text-content/85", ts && "")}>{l}</span>
            </div>
          );
        })}
        {filtered.length !== lines.length && (
          <p className="px-4 pt-3 text-[11px] text-content-muted">
            {filtered.length.toLocaleString()} of {lines.length.toLocaleString()} lines match.
          </p>
        )}
      </div>
    </div>
  );
}

/* ── JSON tree ── */
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function parseJsonSafe(src: string): JsonValue | null {
  try { return JSON.parse(src); } catch { return null; }
}

function JsonView({ src }: { src: string }) {
  const data = useMemo(() => parseJsonSafe(src), [src]);
  const pretty = tryPrettyJson(src);

  if (data === null) {
    return <PlainView src={pretty ?? src} />;
  }

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };

  const Node = ({ k, v, depth, last }: { k?: string; v: JsonValue; depth: number; last?: boolean }) => {
    const [open, setOpen] = useState(depth < 2);
    const isObj = v !== null && typeof v === "object";
    const entries: [string, JsonValue][] = Array.isArray(v)
      ? v.map((x, i) => [String(i), x])
      : Object.entries(v as Record<string, JsonValue>);
    const path = k ?? "";

    return (
      <div style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
        <div className="group flex items-start gap-1.5 rounded px-1.5 py-px hover:bg-accent/[0.05]">
          {isObj ? (
            <button
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="mt-[3px] shrink-0 text-content-muted hover:text-content transition-colors"
              aria-label={`${open ? "Collapse" : "Expand"} ${k ?? "root"}`}
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : <span className="w-[18px] shrink-0" />}
          {k !== undefined && (
            <>
              <span className="font-mono text-[13px] text-accent/90">"{k}"</span>
              <span className="text-content-muted/60">:</span>
            </>
          )}
          {!isObj && <Scalar v={v} />}
          {isObj && !open && (
            <button onClick={() => setOpen(true)} className="font-mono text-[13px] text-content-muted hover:text-content">
              {Array.isArray(v) ? `[${entries.length}]` : `{${entries.length}}`}
              <span className="ml-2 opacity-0 transition-opacity group-hover:opacity-100 text-[11px]">expand</span>
            </button>
          )}
          {isObj && open && <span className="font-mono text-[13px] text-content-muted">{Array.isArray(v) ? "[" : "{"}</span>}
          {/* copy actions */}
          <span className="ml-auto hidden shrink-0 items-center gap-1 group-hover:flex">
            <button onClick={() => copy(JSON.stringify(v))} title={`Copy value of ${path || "root"}`}
              className="rounded p-0.5 text-content-muted/70 hover:text-content">copy</button>
            {k !== undefined && (
              <button onClick={() => copy(k)} title="Copy key" className="rounded p-0.5 text-content-muted/70 hover:text-content">key</button>
            )}
          </span>
        </div>
        {isObj && open && (
          <div>
            {entries.map(([ck, cv], i) => (
              <Node key={ck + i} k={Array.isArray(v) ? undefined : ck} v={cv} depth={depth + 1} />
            ))}
            <div className="flex items-start gap-1.5 px-1.5">
              <span className="w-[18px] shrink-0" />
              <span className="font-mono text-[13px] text-content-muted">{Array.isArray(v) ? "]" : "}"}</span>
              {!last && depth > 0 && <span className="font-mono text-[13px] text-content-muted/50">,</span>}
            </div>
          </div>
        )}
        {!isObj && !last && depth > 0 && <span className="sr-only">,</span>}
      </div>
    );
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="mx-auto max-w-[56rem] rounded-xl border border-border/40 bg-surface-muted/20 p-3">
        <Node v={data} depth={0} />
      </div>
    </div>
  );
}

function Scalar({ v }: { v: any }) {
  if (typeof v === "string") return <span className="font-mono text-[13px] text-success">"{v}"</span>;
  if (typeof v === "number") return <span className="font-mono text-[13px] text-warning">{String(v)}</span>;
  if (typeof v === "boolean") return <span className="font-mono text-[13px] text-accent">{String(v)}</span>;
  return <span className="font-mono text-[13px] text-content-muted">null</span>;
}

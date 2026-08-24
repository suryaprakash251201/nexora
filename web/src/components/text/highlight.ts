/**
 * Tiny dependency-free syntax highlighter for the text workspace preview and
 * editor highlight layer. Produces HTML with <span class="tk-*"> tokens.
 * Input is ALWAYS escaped first — safe for dangerouslySetInnerHTML.
 */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

type Rule = { re: RegExp; cls: string };

const JSON_RULES: Rule[] = [
  { re: /"(?:[^"\\]|\\.)*"(?=\s*:)/g, cls: "tk-key" },
  { re: /"(?:[^"\\]|\\.)*"/g, cls: "tk-str" },
  { re: /\b(?:true|false|null)\b/g, cls: "tk-kw" },
  { re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, cls: "tk-num" },
];

const YAML_RULES: Rule[] = [
  { re: /^[ \t]*[-#]?[ \t]*[\w.$-]+(?=\s*:)/gm, cls: "tk-key" },
  { re: /"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/g, cls: "tk-str" },
  { re: /\b(?:true|false|null|yes|no|on|off)\b/gi, cls: "tk-kw" },
  { re: /-?\b\d+(?:\.\d+)?\b/g, cls: "tk-num" },
  { re: /#[^\n]*/g, cls: "tk-cmt" },
];

const XML_RULES: Rule[] = [
  { re: /<!--[\s\S]*?-->/g, cls: "tk-cmt" },
  { re: /<\/?[\w:.-]+/g, cls: "tk-tag" },
  { re: /[\w:-]+=/g, cls: "tk-attr" },
  { re: /"(?:[^"]*)"/g, cls: "tk-str" },
  { re: />|\/>/g, cls: "tk-tag" },
];

const MD_RULES: Rule[] = [
  { re: /^#{1,6}[^\n]*/gm, cls: "tk-h" },
  { re: /^>[^\n]*/gm, cls: "tk-quote" },
  { re: /^\s*[-*+]\s|\s*\d+\.\s/gm, cls: "tk-list" },
  { re: /`[^`\n]+`/g, cls: "tk-str" },
  { re: /\*\*[^*\n]+\*\*/g, cls: "tk-bold" },
  { re: /\[[^\]\n]*\]\([^)\n]*\)/g, cls: "tk-link" },
];

const SHELL_RULES: Rule[] = [
  { re: /#[^\n]*/g, cls: "tk-cmt" },
  { re: /"(?:[^"\\]|\\.)*"|'(?:[^'])*'/g, cls: "tk-str" },
  { re: /^\s*\w+(?==)/gm, cls: "tk-key" },
  { re: /\$\{?\w+\}?/g, cls: "tk-num" },
];

const JS_RULES: Rule[] = [
  { re: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, cls: "tk-cmt" },
  { re: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, cls: "tk-str" },
  { re: /\b(?:const|let|var|function|return|if|else|for|while|class|new|import|from|export|default|async|await|try|catch|throw|typeof|interface|type|extends|implements|public|private|readonly|static|switch|case|break|continue|do|in|of|delete|void|yield)\b/g, cls: "tk-kw" },
  { re: /\b\d+(?:\.\d+)?\b/g, cls: "tk-num" },
  { re: /[A-Za-z_$][\w$]*(?=\()/g, cls: "tk-fn" },
];

const SQL_RULES: Rule[] = [
  { re: /--[^\n]*/g, cls: "tk-cmt" },
  { re: /'(?:[^']|'')*'/g, cls: "tk-str" },
  { re: /\b(?:SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|LIMIT|OFFSET|AND|OR|NOT|NULL|AS|INDEX|PRIMARY|KEY|FOREIGN|REFERENCES|DISTINCT|COUNT|SUM|AVG|MIN|MAX)\b/gi, cls: "tk-kw" },
  { re: /\b\d+(?:\.\d+)?\b/g, cls: "tk-num" },
];

const RULES_BY_LANG: Record<string, Rule[]> = {
  json: JSON_RULES,
  yaml: YAML_RULES,
  yml: YAML_RULES,
  toml: SHELL_RULES,
  ini: SHELL_RULES,
  env: SHELL_RULES,
  xml: XML_RULES,
  html: XML_RULES,
  svg: XML_RULES,
  markdown: MD_RULES,
  md: MD_RULES,
  sql: SQL_RULES,
  js: JS_RULES,
  ts: JS_RULES,
  jsx: JS_RULES,
  tsx: JS_RULES,
  css: [
    { re: /\/\*[\s\S]*?\*\//g, cls: "tk-cmt" },
    { re: /[.#]?[\w-]+(?=\s*\{)/g, cls: "tk-tag" },
    { re: /[\w-]+(?=\s*:)/g, cls: "tk-key" },
    { re: /#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw)?\b/g, cls: "tk-num" },
  ],
  py: [
    { re: /#[^\n]*/g, cls: "tk-cmt" },
    { re: /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, cls: "tk-str" },
    { re: /\b(?:def|class|import|from|as|return|if|elif|else|for|while|try|except|finally|with|lambda|None|True|False|and|or|not|in|is|pass|raise|yield|global|assert)\b/g, cls: "tk-kw" },
    { re: /\b\d+(?:\.\d+)?\b/g, cls: "tk-num" },
  ],
  sh: SHELL_RULES,
};

/** Tokenize `src` into highlighted HTML. Long inputs short-circuit to escaped text. */
export function highlight(src: string, lang: string): string {
  const rules = RULES_BY_LANG[lang];
  if (!rules || src.length > 400_000) return escapeHtml(src);

  // Mask pass: find all tokens, sort by position, emit spans around escapes.
  type Tok = { start: number; end: number; cls: string };
  const toks: Tok[] = [];
  for (const { re, cls } of rules) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      // Skip overlaps with earlier tokens.
      let overlap = false;
      for (const t of toks) {
        if (m.index < t.end && m.index + m[0].length > t.start) { overlap = true; break; }
      }
      if (!overlap) toks.push({ start: m.index, end: m.index + m[0].length, cls });
      if (!re.global) break;
    }
  }
  if (toks.length === 0) return escapeHtml(src);
  toks.sort((a, b) => a.start - b.start);

  let out = "";
  let pos = 0;
  for (const t of toks) {
    out += escapeHtml(src.slice(pos, t.start));
    out += `<span class="${t.cls}">${escapeHtml(src.slice(t.start, t.end))}</span>`;
    pos = t.end;
  }
  out += escapeHtml(src.slice(pos));
  return out;
}

/** Pretty-print JSON when parseable; returns null otherwise. */
export function tryPrettyJson(src: string): string | null {
  try {
    const parsed = JSON.parse(src);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/** Detect RFC3339/syslog-style timestamps at line starts (log viewer). */
export function looksLikeLog(src: string): boolean {
  const sample = src.slice(0, 4000);
  const hits = sample.match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/gm) || sample.match(/^[A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2}/gm);
  return !!hits && hits.length >= Math.min(3, sample.split("\n").length);
}

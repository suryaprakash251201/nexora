// A tiny, dependency-free Markdown renderer. Security model: the raw input is
// HTML-escaped FIRST, so any embedded HTML/script is neutralized. We then apply
// a controlled set of inline/block transformations that only ever emit a small,
// known set of safe tags. Links are restricted to http(s)/mailto schemes.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(url: string): string {
  const u = url.trim();
  if (/^(https?:\/\/|mailto:|\/)/i.test(u)) return u;
  return "#";
}

function inline(text: string): string {
  let t = text;
  // Inline code
  t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // Images ![alt](src)
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => `<img src="${safeHref(src)}" alt="${alt}" loading="lazy" />`);
  // Links [text](href)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, href) => `<a href="${safeHref(href)}" target="_blank" rel="noopener noreferrer">${txt}</a>`);
  // Bold then italic
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return t;
}

export function renderMarkdown(src: string): string {
  const escaped = escapeHtml(src);
  const lines = escaped.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let listType: "ul" | "ol" | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    // Fenced code blocks
    if (/^```/.test(line.trim())) {
      flushParagraph();
      closeList();
      if (!inCode) {
        out.push("<pre><code>");
        inCode = true;
      } else {
        out.push("</code></pre>");
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      out.push(line + "\n");
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      closeList();
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph();
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^(\*\*\*|---|___)\s*$/.test(line)) {
      flushParagraph();
      closeList();
      out.push("<hr />");
      continue;
    }

    // Blockquote
    const bq = line.match(/^&gt;\s?(.*)$/);
    if (bq) {
      flushParagraph();
      closeList();
      out.push(`<blockquote>${inline(bq[1])}</blockquote>`);
      continue;
    }

    // Unordered list
    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      flushParagraph();
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    // Ordered list
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushParagraph();
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

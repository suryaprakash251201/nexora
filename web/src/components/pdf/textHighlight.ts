import type { MatchSegment } from "./types";

/**
 * Search-match highlighting over a rendered pdf.js text layer.
 *
 * The text layer is a flat list of `<span role="presentation">` elements (one
 * per non-empty text item, in content order) plus `<br>` markers. Highlighting
 * wraps matched character ranges inside the affected spans with
 * `<mark class="nx-mark">` elements; clearing unwraps them and re-normalizes.
 */

const MARK_SELECTOR = "mark.nx-mark";
const SPAN_SELECTOR = "span[role='presentation']";

/** Remove every highlight mark inside a text layer container. */
export function clearHighlights(container: HTMLElement): void {
  const marks = container.querySelectorAll(MARK_SELECTOR);
  if (marks.length === 0) return;
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
  });
  // Merge adjacent text nodes so future offset math stays exact.
  container.normalize();
}

/**
 * Wrap `segments` with highlight marks. `activeOrdinal` marks one segment as
 * the current match (stronger styling). Returns the active mark element, or
 * null when nothing was highlighted.
 */
export function applyHighlights(
  container: HTMLElement,
  segments: MatchSegment[],
  activeOrdinal: number
): HTMLElement | null {
  clearHighlights(container);
  if (segments.length === 0) return null;
  const spans = container.querySelectorAll(SPAN_SELECTOR);
  let activeEl: HTMLElement | null = null;

  // Group ranges per span: inserting a mark shifts text-node offsets, so
  // ranges inside one span must be applied right-to-left.
  const bySpan = new Map<number, { s: number; e: number; active: boolean }[]>();
  segments.forEach((seg, i) => {
    const list = bySpan.get(seg.domIndex) ?? [];
    list.push({ s: seg.s, e: seg.e, active: i === activeOrdinal });
    bySpan.set(seg.domIndex, list);
  });

  for (const [domIndex, ranges] of bySpan) {
    const span = spans[domIndex] as HTMLElement | undefined;
    if (!span) continue;
    ranges.sort((a, b) => b.s - a.s);
    for (const range of ranges) {
      const mark = wrapRange(span, range.s, range.e, range.active);
      if (range.active && mark) activeEl = mark;
    }
  }
  return activeEl;
}

/**
 * Wrap character range [s, e) of an element's first text node with a
 * `<mark>`. pdf.js spans contain exactly one text node in practice; if the
 * range lands elsewhere we walk child text nodes defensively.
 */
function wrapRange(span: HTMLElement, s: number, e: number, active: boolean): HTMLElement | null {
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  let offset = 0;

  while ((node = walker.nextNode() as Text | null)) {
    const len = node.data.length;
    const nodeStart = offset;
    const nodeEnd = offset + len;
    offset = nodeEnd;

    if (nodeEnd <= s || nodeStart >= e || len === 0) continue;

    const localS = Math.max(0, s - nodeStart);
    const localE = Math.min(len, e - nodeStart);

    // Split off the tail beyond the match.
    if (localE < len) node.splitText(localE);
    const target: Text = localS > 0 ? (node.splitText(localS) as Text) : node;
    if (target.data.length === 0) continue;

    const mark = document.createElement("mark");
    mark.className = "nx-mark" + (active ? " nx-active" : "");
    target.parentNode?.insertBefore(mark, target);
    mark.appendChild(target);
    return mark;
  }
  return null;
}

/**
 * Locate the currently-active mark inside a container (for scrolling it into
 * view after application).
 */
export function findActiveMark(container: HTMLElement): HTMLElement | null {
  return container.querySelector("mark.nx-active");
}

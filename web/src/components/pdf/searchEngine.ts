import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { MatchSegment, SearchMatch } from "./types";

/**
 * Document full-text search for the PDF workspace.
 *
 * Pages are scanned sequentially so results stream in progressively, the
 * scan is generation-cancellable (a new query supersedes the old one), and
 * per-page text extractions are cached on the document proxy so repeated
 * searches don't re-hit the worker.
 *
 * Matching strategy: each page's text items are lowercased and joined with a
 * single space; offsets in the joined string map back to individual items so
 * matches that cross item boundaries can still be highlighted span-by-span.
 * Item order equals DOM span order in the rendered text layer (pdf.js emits
 * one span per non-empty item), which gives us `domIndex` for highlighting.
 */

const MAX_RESULTS = 200;

interface PageTextData {
  /** Lowercased item strings (non-empty ones only), aligned with domIndex. */
  parts: string[];
  /** Cumulative start offset of each part inside `norm`. */
  starts: number[];
  /** Joined searchable text. */
  norm: string;
  /** First domIndex offset — parts[i] corresponds to spans[parts0 + i]. */
  baseDomIndex: number;
}

const cache = new WeakMap<PDFDocumentProxy, Map<number, PageTextData>>();

function getCache(doc: PDFDocumentProxy): Map<number, PageTextData> {
  let m = cache.get(doc);
  if (!m) {
    m = new Map();
    cache.set(doc, m);
  }
  return m;
}

export async function getPageTextData(doc: PDFDocumentProxy, pageNumber: number): Promise<PageTextData> {
  const cached = getCache(doc).get(pageNumber);
  if (cached) return cached;
  const content = await doc.getPage(pageNumber).then((p) => p.getTextContent());
  const parts: string[] = [];
  const starts: number[] = [];
  let norm = "";
  // Spans exist only for items with non-empty strings → track the ordinal.
  let domIndex = 0;
  let baseDomIndex = -1;
  for (const item of content.items as TextItem[]) {
    if (!("str" in item)) continue; // marked-content markers
    if (!item.str) continue; // empty items produce no span
    if (baseDomIndex === -1) baseDomIndex = domIndex;
    if (parts.length > 0) norm += " ";
    starts.push(norm.length);
    norm += item.str.toLowerCase();
    parts.push(item.str.toLowerCase());
    domIndex++;
  }
  const data: PageTextData = { parts, starts, norm, baseDomIndex };
  getCache(doc).set(pageNumber, data);
  return data;
}

export interface SearchCallbacks {
  /** Fired after each scanned page with running results. */
  onPartial(resultsByPage: Map<number, SearchMatch[]>, flat: SearchMatch[], total: number): void;
  /** Progress tick: which page was just finished. */
  onProgress(page: number, total: number): void;
}

export interface SearchRun {
  cancel(): void;
}

/** Binary-search which part contains the given norm-space offset. */
function partForStart(data: PageTextData, offset: number): number {
  let lo = 0;
  let hi = data.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (data.starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const SNIPPET = 34;

function buildSegments(data: PageTextData, start: number, end: number): MatchSegment[] {
  const segments: MatchSegment[] = [];
  let cursor = start;
  while (cursor < end) {
    const i = partForStart(data, cursor);
    const partEnd = i + 1 < data.starts.length ? data.starts[i + 1] : data.norm.length;
    const s = cursor - data.starts[i];
    const e = Math.min(end, partEnd) - data.starts[i];
    if (e > s) segments.push({ domIndex: data.baseDomIndex + i, s, e });
    cursor = Math.min(partEnd, end);
  }
  return segments;
}

/**
 * Run an async, cancellable search across every page of the document.
 * Returns the final result set. `isCancelled` is polled between pages.
 */
export async function searchDocument(
  doc: PDFDocumentProxy,
  rawQuery: string,
  cb: SearchCallbacks,
  isCancelled: () => boolean
): Promise<{ byPage: Map<number, SearchMatch[]>; flat: SearchMatch[]; truncated: boolean }> {
  const query = rawQuery.toLowerCase().trim();
  const byPage = new Map<number, SearchMatch[]>();
  const flat: SearchMatch[] = [];
  let truncated = false;

  if (query.length === 0) return { byPage, flat, truncated };

  for (let page = 1; page <= doc.numPages; page++) {
    if (isCancelled()) return { byPage, flat, truncated };
    try {
      const data = await getPageTextData(doc, page);
      if (isCancelled()) return { byPage, flat, truncated };
      cb.onProgress(page, doc.numPages);

      const matches: SearchMatch[] = [];
      let idx = data.norm.indexOf(query);
      while (idx !== -1) {
        if (flat.length >= MAX_RESULTS) {
          truncated = true;
          break;
        }
        const end = idx + query.length;
        const before = data.norm.slice(Math.max(0, idx - SNIPPET), idx);
        const after = data.norm.slice(end, end + SNIPPET);
        matches.push({
          page,
          segments: buildSegments(data, idx, end),
          before,
          match: data.norm.slice(idx, end),
          after,
        });
        idx = data.norm.indexOf(query, end);
      }
      if (matches.length) {
        byPage.set(page, matches);
        flat.push(...matches);
        cb.onPartial(byPage, flat, flat.length);
      }
      if (truncated) break;
    } catch (e) {
      console.error(`DocumentSpace: text extraction failed for page ${page}`, e);
    }
  }
  return { byPage, flat, truncated };
}

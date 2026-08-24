import type { PDFDocumentProxy } from "pdfjs-dist";

export type FitMode = "width" | "page" | "none";

/** Unrotated page dimensions in CSS points (viewport at scale 1). */
export interface PageSize {
  width: number;
  height: number;
}

/** Metadata extracted from the PDF's info dictionary. */
export interface PdfDocMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  created?: string;
  modifiedPdf?: string;
  version?: string;
}

/** One contiguous piece of a match inside a single text-layer span. */
export interface MatchSegment {
  /** Ordinal of the target span among the text layer's rendered spans. */
  domIndex: number;
  /** Start offset within the span's text (inclusive). */
  s: number;
  /** End offset within the span's text (exclusive). */
  e: number;
}

/** A single search hit with everything needed to list + highlight it. */
export interface SearchMatch {
  page: number;
  segments: MatchSegment[];
  before: string;
  match: string;
  after: string;
}

export interface SearchResultPage {
  matches: SearchMatch[];
}

/** Type alias so components don't import pdf.js types directly. */
export type PdfDoc = PDFDocumentProxy;

/** Fallback page size (ISO A4 in points) used before sizes are known. */
export const DEFAULT_PAGE_SIZE: PageSize = { width: 612, height: 792 };

import { createContext, useContext } from "react";
import type { FileItem } from "../../api/types";
import type { FitMode, PageSize, PdfDocMeta, PdfDoc, SearchMatch } from "./types";

/**
 * Central "Document Space" state, provided by PdfWorkspace and consumed by
 * every floating layer (header, dock, panels, palette). Keeping it in one
 * context keeps the component tree flat and re-renders targeted.
 */
export interface ViewerContextValue {
  item: FileItem;
  /** Inline raw-file URL for the document. */
  url: string;

  // ── Document ──
  doc: PdfDoc | null;
  numPages: number;
  loading: boolean;
  progress: number;
  error: string | null;
  meta: PdfDocMeta | null;
  reload(): void;
  /** Unrotated page dimensions; filled progressively (page 1 first). */
  sizes: (PageSize | undefined)[];

  // ── View state ──
  page: number;
  goToPage(page: number): void;
  /** Silent current-page set coming from canvas scroll sync (no scrolling). */
  setPage(page: number): void;
  /** Effective CSS scale computed by the canvas from fit + viewport size. */
  effectiveScale: number;
  /** Called by the canvas whenever its computed scale changes. */
  setEffectiveScale(scale: number): void;
  /** Zoom to an explicit manual scale (wheel path; keeps cursor anchor). */
  wheelZoomTo(scale: number): void;
  fit: FitMode;
  setFit(mode: FitMode): void;
  zoom: number; // manual scale, applied when fit === "none"
  zoomBy(factor: number): void;
  resetZoom(): void;
  rotation: number; // user rotation in degrees (0/90/180/270)
  rotate(dir: 1 | -1): void;

  // ── Canvas wiring ──
  /** The canvas scroll container, for scroll-aware overlays. */
  attachScrollEl(el: HTMLDivElement | null): void;
  /** Current canvas scroll element (null until mounted). */
  scrollEl: HTMLDivElement | null;
  /** The Document Space root element — portal target for menus/tooltips so
   * they stack inside the host dialog instead of under it. */
  attachShellEl(el: HTMLDivElement | null): void;
  shellEl: HTMLDivElement | null;

  // ── Panels ──
  pagesOpen: boolean;
  togglePages(force?: boolean): void;
  infoOpen: boolean;
  toggleInfo(force?: boolean): void;
  shareOpen: boolean;
  toggleShare(force?: boolean): void;
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
  searchOpen: boolean;

  // ── Search ──
  query: string;
  setQuery(q: string): void;
  resultsByPage: Map<number, SearchMatch[]>;
  flatResults: SearchMatch[];
  resultsTruncated: boolean;
  searching: boolean;
  searchProgressPage: number;
  activeResult: number; // index into flatResults, -1 = none
  openSearch(prefill?: string): void;
  closeSearch(): void;
  gotoResult(index: number): void;
  nextResult(): void;
  prevResult(): void;

  // ── Modes ──
  focusMode: boolean;
  toggleFocus(): void;
  isFullscreen: boolean;
  toggleFullscreen(): void;
  /** Chrome (header/dock) currently visible per the adaptive-UI timer. */
  chromeVisible: boolean;
  /** Note recent user interaction so chrome stays visible. */
  reportActivity(): void;

  // ── Host integration ──
  hasShareFlow: boolean;
  requestShare(): void;
  closeViewer(): void;
  /** Stream-download this document via the app transfer pipeline. */
  download(): void;
  /** Open the browser print dialog for this PDF. */
  print(): void;
  /** Open the raw document in a new browser tab / OS shell. */
  openInNewTab(): void;
}

export const ViewerContext = createContext<ViewerContextValue | null>(null);

export function useViewer(): ViewerContextValue {
  const ctx = useContext(ViewerContext);
  if (!ctx) throw new Error("useViewer must be used inside <PdfWorkspace>");
  return ctx;
}

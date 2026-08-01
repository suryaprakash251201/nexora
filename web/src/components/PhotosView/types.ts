export interface PhotoResult {
  id: string;
  root_id: string;
  path: string;
  name: string;
  date_taken: string;
  lat?: number;
  lng?: number;
  make?: string;
  model?: string;
  is_favorite?: boolean;
  width?: number;
  height?: number;
}

export interface PhotosResponse {
  items: PhotoResult[];
  has_more: boolean;
  total_count?: number;
}

export interface PhotoFilters {
  year?: number;
  month?: number;
  cameraMake?: string;
  hasLocation?: boolean;
  favoritesOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
  sort: "date_desc" | "date_asc" | "name";
}

/** Gallery density: taller rows vs. more photos per screen. */
export type Density = "cozy" | "compact";

/** Top-level views of the photos section. */
export type ViewMode = "gallery" | "map";

/** Target row height (px) used to pack photo rows for each density. */
export const DENSITY_ROW_HEIGHT: Record<Density, number> = {
  cozy: 248,
  compact: 168,
};

/** Gap between tiles inside a photo row, in px. */
export const ROW_GAP = 6;

export interface RowItem {
  photo: PhotoResult;
  aspect: number;
}

export interface PhotoRow {
  items: RowItem[];
  height: number;
}

export interface DayGroup {
  key: string; // YYYY-MM-DD
  label: string; // "Today", "Yesterday", "Jun 14"
  sublabel: string; // "Monday · 24 photos"
  rows: PhotoRow[];
}

/** True when the photo has usable EXIF dimensions. */
export function hasDimensions(p: PhotoResult): boolean {
  return !!p.width && !!p.height && p.width > 0 && p.height > 0;
}

/** Display aspect ratio: real pixel ratio when known, otherwise 4:3. */
export function aspectOf(p: PhotoResult): number {
  if (hasDimensions(p)) return p.width! / p.height!;
  return 4 / 3;
}

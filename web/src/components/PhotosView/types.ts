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
  is_video?: boolean;
  size?: number;
  width?: number;
  height?: number;
}

export interface PhotosResponse {
  items: PhotoResult[];
  next_cursor?: string;
  total_count: number;
  facets?: {
    years: Array<{ year: number; count: number }>;
    cameras: Array<{ make: string; model: string; count: number }>;
    locations: Array<{ lat: number; lng: number; count: number }>;
  };
}

export interface PhotoFilters {
  year?: number;
  month?: number;
  cameraMake?: string;
  hasLocation?: boolean;
  favoritesOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
  sort?: "date_desc" | "date_asc" | "name";
  query?: string;
}

export interface PhotoMeta {
  id: string;
  exif: {
    make?: string;
    model?: string;
    lens?: string;
    aperture?: string;
    shutter_speed?: string;
    iso?: number;
    focal_length?: string;
    exposure_compensation?: string;
    flash?: boolean;
    white_balance?: string;
    metering_mode?: string;
    orientation?: number;
    color_space?: string;
  };
  gps?: {
    lat: number;
    lng: number;
    altitude?: number;
    address?: string;
  };
  file: {
    size: number;
    dimensions: { width: number; height: number };
    mime: string;
    created_at: string;
    modified_at: string;
  };
  video?: {
    duration: number;
    codec: string;
    bitrate: number;
    frame_rate: number;
    audio_codec?: string;
  };
}

export type Density = "compact" | "comfortable" | "spacious";
export type ViewMode = "grid" | "timeline";

export const DENSITY_CONFIG: Record<Density, { 
  cols: { base: number; sm: number; md: number; lg: number; xl: number }; 
  gap: number; 
  cardWidth: number;
  aspectRatio: number;
}> = {
  compact: { cols: { base: 3, sm: 4, md: 5, lg: 6, xl: 8 }, gap: 4, cardWidth: 140, aspectRatio: 4 / 3 },
  comfortable: { cols: { base: 2, sm: 3, md: 4, lg: 5, xl: 6 }, gap: 8, cardWidth: 180, aspectRatio: 4 / 3 },
  spacious: { cols: { base: 2, sm: 2, md: 3, lg: 4, xl: 4 }, gap: 16, cardWidth: 240, aspectRatio: 3 / 2 },
};
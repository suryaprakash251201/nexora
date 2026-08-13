export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role: "admin" | "user" | "viewer";
  status: string;
  totp_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Root {
  id: string;
  name: string;
  icon?: string;
  path?: string;
  type: "local" | "s3";
  config?: string;
  read_only: boolean;
  enabled: boolean;
  permission: "read" | "write";
}

export interface FileItem {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  modified: string;
  mime: string;
  root_id: string;
  extension: string;
  tags?: Tag[];
}

export interface FileListResponse {
  root: string;
  path: string;
  items: FileItem[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export interface TrashItem {
  id: string;
  root_id: string;
  root_name: string;
  original_path: string;
  name: string;
  size: number;
  is_dir: boolean;
  deleted_at: string;
}

export interface ShareItem {
  id: string;
  token: string;
  url: string;
  root_id: string;
  path: string;
  name: string;
  scope: "download" | "preview";
  has_password: boolean;
  expires_at: string | null;
  max_downloads: number;
  download_count: number;
  created_at: string;
}

export interface SharePublicInfo {
  name: string;
  scope: "download" | "preview";
  has_password: boolean;
  status: "ok" | "expired" | "exhausted";
  extension: string;
  mime: string;
  max_downloads: number;
  downloads: number;
  expires_at: string | null;
}

export interface AuditItem {
  id: string;
  user_id: string;
  action: string;
  target: string;
  ip: string;
  detail: string;
  created_at: string;
}

export interface FileMetadata extends FileItem {
  editable?: boolean;
  width?: number;
  height?: number;
}

export interface JobItem {
  id: string;
  type: "archive" | "extract";
  status: "pending" | "running" | "done" | "failed";
  progress: number;
  error: string;
  result?: string;
  root_id: string;
  created_at: string;
  updated_at: string;
}

export interface FavoriteItem {
  root_id: string;
  root_name: string;
  path: string;
  name: string;
  created_at: string;
}

export interface RecentItem {
  root_id: string;
  root_name: string;
  path: string;
  name: string;
  accessed_at: string;
}

export interface SearchResult {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  mime: string;
  extension: string;
  root_id: string;
  modified: string;
}

export interface ApiError {
  error: string;
  message?: string;
  request?: string;
}

export interface HomeData {
  recent: RecentItem[];
  added: RecentItem[];
  documents: RecentItem[];
  music: RecentItem[];
  video: RecentItem[];
  playlists: Playlist[];
  share_count?: number;
}

export interface PlaylistItem {
  id: string;
  playlist_id: string;
  root_id: string;
  path: string;
  created_at: string;
  name: string;
  extension: string;
  mime: string;
}

export interface Playlist {
  id: string;
  name: string;
  cover_root_id: string;
  cover_path: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  items: PlaylistItem[];
}

export interface PlaylistCollaborator {
  playlist_id: string;
  user_id: string;
  role: string;
  created_at: string;
  username?: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  count?: number;
  created_at: string;
}

export interface FileTag {
  tag_id: string;
  root_id: string;
  path: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters: string;
  sort: string;
  sort_order: string;
  root_id?: string;
  icon?: string;
  color?: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface SavedSearchInput {
  name: string;
  query: string;
  filters?: string;
  sort?: string;
  sort_order?: string;
  root_id?: string;
  icon?: string;
  color?: string;
  is_pinned?: boolean;
}

export interface FileVersion {
  id: string;
  root_id: string;
  path: string;
  version: number;
  size: number;
  checksum: string;
  note: string;
  created_at: string;
}

export interface StorageStats {
  total_files: number;
  total_size: number;
  breakdown: Record<string, { count: number; size: number }>;
  largest: Array<{ name: string; path: string; size: number; root_id: string }>;
}

export interface DuplicateGroup {
  groups: Array<{
    name: string;
    path: string;
    size: number;
    root_id: string;
  }>[];
}

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
  has_more: boolean;
  next_cursor?: string;
  total_count?: number;
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


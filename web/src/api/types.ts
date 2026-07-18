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
}

export interface FileList {
  root: string;
  path: string;
  items: FileItem[];
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

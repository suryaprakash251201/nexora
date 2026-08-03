export interface Tag {
  id: string;
  name: string;
  color: string;
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

export interface Root {
  id: string;
  name: string;
  icon?: string;
  path: string;
  type: string;
  read_only: boolean;
  enabled: boolean;
  permission: string;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  role: string;
  display_name?: string;
}

export interface ApiError {
  error: string;
  message: string;
}

export interface SearchResult {
  id: string;
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  modified: string;
  mime: string;
  root_id: string;
  extension: string;
  score?: number;
}

export interface SearchResponse {
  items: SearchResult[];
  has_more: boolean;
}

// ── Admin ────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  username: string;
  email?: string;
  display_name?: string;
  role: string;
  status: string;
  totp_enabled: boolean;
  created_at: string;
}

export interface AdminRoot {
  id: string;
  name: string;
  path: string;
  icon?: string;
  type: string;
  config?: string;
  read_only: boolean;
  enabled: boolean;
  indexed: boolean;
  created_at?: string;
}

export interface UsageInfo {
  id: string;
  name: string;
  total: number;
  available: number;
  used: number;
}

export interface AdminUsage {
  roots: UsageInfo[];
  total: number;
  available: number;
  used: number;
}

export interface AuditEntry {
  id: string;
  user_id?: string;
  action: string;
  target?: string;
  ip?: string;
  detail?: string;
  created_at: string;
}

export interface FavoriteItem {
  root_id: string;
  root_name: string;
  path: string;
  name: string;
  created_at: string;
}

export interface TrashItem {
  id: string;
  root_id: string;
  root_name?: string;
  original_path: string;
  name: string;
  size: number;
  is_dir: boolean;
  deleted_at: string;
}

export interface ShareInfo {
  id: string;
  token: string;
  url: string;
  root_id: string;
  path: string;
  name: string;
  scope: string;
  has_password: boolean;
  expires_at?: string | null;
  max_downloads: number;
  download_count: number;
  created_at: string;
}

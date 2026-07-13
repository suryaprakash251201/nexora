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
  root_id: string;
  path: string;
  scope: "download" | "preview";
  expires_at: string | null;
  max_downloads: number;
  download_count: number;
  created_at: string;
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

export interface ApiError {
  error: string;
  message?: string;
  request?: string;
}

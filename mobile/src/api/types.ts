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
  results: SearchResult[];
  total: number;
  query: string;
}

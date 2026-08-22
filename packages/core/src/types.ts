/** Canonical shared types — web (`web/src/api/types.ts`) and mobile (`mobile/src/api/types.ts`) should import from here. */

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

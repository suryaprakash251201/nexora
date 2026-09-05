/**
 * Centralized typed API endpoint modules.
 *
 * Structure decision: single file `web/src/api/endpoints.ts` (rather than
 * per-domain `web/src/api/{files,favorites,...}.ts`) — justification:
 *   • Small-to-mid sized codebase (~30 inline call sites); a single file keeps
 *     all path strings in one grep-able location and enforces the "no literal
 *     /favorites in consumers" invariant trivially.
 *   • Single import path (`from "../api/endpoints"`) avoids barrel re-export
 *     complexity and circular-import risk with `client.ts`.
 *   • Easy to split into per-domain files later without breaking call sites:
 *     each `*Api` object is already isolated; extracting it to `files.ts` is a
 *     pure move + barrel `export *`.
 *
 * This module is the single source for path strings. No other file should
 * contain literals like "/favorites", "/roots", "/trash", "/home", "/recents",
 * "/files", "/shares" etc — import the typed helper instead.
 *
 * Each function is typed (`Promise<T>`) using types from `web/src/api/types.ts`
 * and delegates to the generic `get`/`post`/`del`/`put`/`patch` helpers in
 * `web/src/api/client.ts` so auth, CSRF and base-url handling stay centralized.
 */

import { get, post, del, put, patch, upload } from "./client";
import type {
	BackupEntry,  FavoriteItem,
  RecentItem,
  TrashItem,
  ShareItem,
  HomeData,
  FileListResponse,
  Root,
  AuditItem,
  User,
  Tag,
  SearchResult,
  Playlist,
  PlaylistCollaborator,
  PhotosResponse,
} from "./types";

// ── Favorites ───────────────────────────────────────────────────────────
export const favoritesApi = {
  /** GET /favorites */
  list: () => get<{ items: FavoriteItem[] }>("/favorites"),
  /** POST /favorites { root, path } */
  add: (root: string, path: string) => post<{ ok: boolean }>("/favorites", { root, path }),
  /** DELETE /favorites?root=&path= */
  remove: (root: string, path: string) => del<{ ok: boolean }>("/favorites", { root, path }),
  /** GET /favorites/check?root=&path= — server may report { is_favorite: boolean } */
  check: (root: string, path: string) => get<{ is_favorite: boolean }>("/favorites/check", { root, path }),
};

// ── Roots ───────────────────────────────────────────────────────────────
export const rootsApi = {
  /** GET /roots */
  list: () => get<{ roots: Root[] }>("/roots"),
};

// ── Files ───────────────────────────────────────────────────────────────
export interface FileListParams {
  root: string;
  path: string;
  sort?: string;
  order?: string;
  offset?: string | number;
  limit?: string | number;
  dirs_first?: string | boolean;
}
export const filesApi = {
  /** GET /files?root=&path=&sort=&order=&offset= */
  list: (params: FileListParams) =>
    get<FileListResponse>("/files", params as unknown as Record<string, string | number | undefined>),
  /** GET /files/stat?root=&path= — returns FileItem plus optional metadata */
  stat: (root: string, path: string) => get<any>("/files/stat", { root, path }),
  /** DELETE /files?root=&path= — moves to trash */
  delete: (root: string, path: string) => del<{ ok: boolean }>("/files", { root, path }),
  /** Comments thread attached to a file/folder path. */
  comments: {
    list: (root: string, path: string) =>
      get<{ items: FileComment[] }>("/files/comments", { root, path }),
    add: (root: string, path: string, body: string) =>
      post<{ item: FileComment }>("/files/comments", { root, path, body }),
    remove: (id: string) => del<{ ok: boolean }>(`/files/comments/${id}`),
  },
  /** POST /files/directory { root, path } */
  createDirectory: (root: string, path: string) => post<{ ok: boolean; path: string }>("/files/directory", { root, path }),
  /** POST /files/file { root, path, content } */
  createFile: (root: string, path: string, content: string) =>
    post<{ ok: boolean }>("/files/file", { root, path, content }),
  /** POST /files/rename { root, path, name } */
  rename: (root: string, path: string, name: string) =>
    post<{ ok: boolean }>("/files/rename", { root, path, name }),
  /** POST /files/move { root, paths, dest } — generic bulk move */
  move: (root: string, paths: string[], dest: string) =>
    post<{ ok: boolean }>("/files/move", { root, paths, dest }),
  /** POST /files/copy { root, paths, dest } */
  copy: (root: string, paths: string[], dest: string) =>
    post<{ ok: boolean }>("/files/copy", { root, paths, dest }),
  /** GET /files/content?root=&path= */
  content: (root: string, path: string) =>
    get<{ content: string; version?: string; mime?: string }>("/files/content", { root, path }),
  /** POST /files/save { root, path, content, version } */
  save: (root: string, path: string, content: string, version?: string) =>
    post<{ version: string }>("/files/save", { root, path, content, version }),
  /** GET /files/metadata?root=&path= */
  metadata: (root: string, path: string) => get<any>("/files/metadata", { root, path }),
  /** GET /files/checksum?root=&path= */
  checksum: (root: string, path: string) => get<{ checksum: string }>("/files/checksum", { root, path }),
  /** POST /files/upload — FormData (query-string root & path) */
  upload: (root: string, path: string, form: FormData) =>
    upload<{ ok: boolean }>(`/files/upload?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`, form),
};

// ── Trash ───────────────────────────────────────────────────────────────
export const trashApi = {
  /** GET /trash */
  list: () => get<{ items: TrashItem[] }>("/trash"),
  /** POST /trash/restore { id } */
  restore: (id: string) => post<{ ok: boolean }>("/trash/restore", { id }),
  /** DELETE /trash?id= */
  delete: (id: string) => del<{ ok: boolean }>("/trash", { id }),
};

// ── Shares ──────────────────────────────────────────────────────────────
export const sharesApi = {
  /** GET /shares — optional filter by root/path */
  list: (query?: { root?: string; path?: string }) =>
    get<{ items: ShareItem[] }>("/shares", query as Record<string, string | undefined>),
  /** POST /shares { root, path, scope, expires_in_hours, max_downloads, password } */
  create: (params: { root: string; path: string; scope?: string; expires_in_hours?: number; max_downloads?: number; password?: string }) =>
    post<{ share: ShareItem }>("/shares", params),
  /** DELETE /shares/{id} — server expects path param; fallback query param for backward compat */
  delete: (id: string) => del<{ ok: boolean }>(`/shares/${id}`),
  /** DELETE /shares?id= (legacy query-param form, used by some consumers) */
  deleteByQuery: (id: string) => del<{ ok: boolean }>("/shares", { id }),
};

// ── Home / Recents ──────────────────────────────────────────────────────
export interface HomeUsage {
  total: number;
  available: number;
  used: number;
  file_count: number;
  breakdown: Record<string, { count: number; size: number }>;
}
export const homeApi = {
  /** GET /home */
  get: () => get<HomeData>("/home"),
  /** GET /home/usage */
  usage: () => get<HomeUsage>("/home/usage"),
};

export const recentsApi = {
  /** GET /recents?limit= */
  list: (params?: { limit?: number }) =>
    get<{ items: RecentItem[] }>("/recents", params as Record<string, number | undefined>),
};

// ── Auth ────────────────────────────────────────────────────────────────
export const authApi = {
  /** GET /auth/needs-setup */
  needsSetup: () => get<{ configured: boolean }>("/auth/needs-setup"),
  /** GET /auth/session */
  session: () => get<{ user: User }>("/auth/session"),
  /** POST /auth/login { login, password } */
  login: (login: string, password: string) => post<{ token?: string }>("/auth/login", { login, password }),
  /** POST /auth/tailscale */
  tailscaleLogin: () => post<{ token?: string }>("/auth/tailscale"),
  /** POST /auth/logout */
  logout: () => post<{ ok?: boolean }>("/auth/logout"),
  /** POST /auth/setup { username, email, password, display_name } */
  setup: (payload: { username: string; email: string; password: string; display_name?: string }) =>
    post<{ token?: string }>("/auth/setup", payload),
  /** POST /auth/password { current, new } */
  changePassword: (current: string, pwNew: string) => post<{ ok?: boolean }>("/auth/password", { current, new: pwNew }),
  /** POST /auth/totp/setup */
  totpSetup: () => post<{ secret: string; uri: string; qr: string }>("/auth/totp/setup"),
  /** POST /auth/totp/verify { code } */
  totpVerify: (code: string) => post<{ ok?: boolean }>("/auth/totp/verify", { code }),
  /** POST /auth/totp/disable { password } */
  totpDisable: (password: string) => post<{ ok?: boolean }>("/auth/totp/disable", { password }),
  /** GET /auth/sessions — this user's live sessions (is_current flagged) */
  sessions: {
    list: () => get<{ items: SessionInfo[] }>("/auth/sessions"),
    revoke: (id: string) => del<{ ok?: boolean }>(`/auth/sessions/${id}`),
    revokeOthers: () => post<{ ok?: boolean; revoked: number }>("/auth/sessions/revoke-others", {}),
  },
  tokens: {
    list: () => get<{ items: TokenInfo[] }>("/auth/tokens"),
    create: (name: string, expires_in_days: number) => post<{ token: string }>("/auth/tokens", { name, expires_in_days }),
    revoke: (id: string) => del<{ ok?: boolean }>(`/auth/tokens/${id}`),
  },
};

// ── Auth/session types (client-safe views; no token material) ───────────
export interface SessionInfo {
  id: string;
  ip: string;
  user_agent: string;
  created_at: string;
  expires_at: string;
  is_current?: boolean;
}

export interface TokenInfo {
  id: string;
  name: string;
  created_at: string;
  last_used_at?: string | null;
  expires_at?: string | null;
}

export interface FileComment {
  id: string;
  user_id: string;
  username: string;
  body: string;
  created_at: string;
}

// ── Admin ───────────────────────────────────────────────────────────────
export const adminApi = {
  /** GET /admin/users */
  listUsers: () => get<{ users: User[] }>("/admin/users"),
  /** POST /admin/users */
  createUser: (form: Record<string, string>) => post<User>("/admin/users", form),
  /** PUT /admin/users/{id} */
  updateUser: (id: string, body: Record<string, unknown>) => put<{ ok?: boolean }>(`/admin/users/${id}`, body),
  /** DELETE /admin/users/{id} */
  deleteUser: (id: string) => del<{ ok?: boolean }>(`/admin/users/${id}`),
  /** GET /admin/users/{id}/roots */
  getUserRoots: (userId: string) => get<{ roots: any[] }>(`/admin/users/${userId}/roots`),
  /** POST /admin/users/{id}/roots */
  grantRoot: (userId: string, rootId: string, permission: string) =>
    post<{ ok?: boolean }>(`/admin/users/${userId}/roots`, { root_id: rootId, permission }),
  /** DELETE /admin/users/{userId}/roots/{rootId} */
  revokeRoot: (userId: string, rootId: string) => del<{ ok?: boolean }>(`/admin/users/${userId}/roots/${rootId}`),
  /** GET /admin/audit?limit= */
  listAudit: (limit = 200) => get<{ items: AuditItem[] }>("/admin/audit", { limit }),
  /** GET /admin/usage */
  getUsage: () => get<{ total: number; used: number; available: number }>("/admin/usage"),
  /** GET /admin/roots — admin view */
  listRoots: () => get<{ roots: Root[] }>("/admin/roots"),
  /** POST /admin/roots */
  createRoot: (body: Record<string, unknown>) => post<{ root: Root }>("/admin/roots", body),
  /** PUT /admin/roots/{id} */
  updateRoot: (id: string, body: Record<string, unknown>) => put<{ root: Root }>(`/admin/roots/${id}`, body),
  /** DELETE /admin/roots/{id} */
  deleteRoot: (id: string) => del<{ ok?: boolean }>(`/admin/roots/${id}`),
  /** POST /admin/search/reindex */
  reindex: () => post<{ ok?: boolean }>("/admin/search/reindex"),
  /** GET /admin/overview — dashboard aggregates */
  overview: () =>
    get<{
      users: number; roots: number; files: number; bytes: number;
      usage?: { total: number; used: number; available: number };
      rootUsage?: Array<{ id: string; name: string; total: number; available: number; used: number }>;
    }>("/admin/overview"),
  /** GET /admin/backups */
  listBackups: () =>
    get<{ enabled: boolean; dir: string; keep: number; hour: number; items: BackupEntry[] }>("/admin/backups"),
  /** POST /admin/backups — trigger a manual backup */
  createBackup: () => post<{ ok?: boolean }>("/admin/backups"),
  /** DELETE /admin/backups/{name} */
  deleteBackup: (name: string) => del<{ ok?: boolean }>(`/admin/backups/${encodeURIComponent(name)}`),
  /** GET /admin/settings */
  getSettings: () => get<{ settings: import("./types").SystemSetting[]; count: number }>("/admin/settings"),
  /** PUT /admin/settings { settings: { key: value } } */
  updateSettings: (settings: Record<string, string>) => put<{ ok: boolean; updated: string[] }>("/admin/settings", { settings }),
  /** DELETE /admin/settings/{key} — revert to default */
  deleteSetting: (key: string) => del<{ ok: boolean }>(`/admin/settings/${encodeURIComponent(key)}`),
};

// ── Tags ────────────────────────────────────────────────────────────────
export const tagsApi = {
  /** GET /tags */
  list: () => get<{ tags: Tag[] }>("/tags").then((d) => d.tags || [] as Tag[]),
  /** GET /tags — raw */
  listRaw: () => get<{ tags: Tag[] }>("/tags"),
  /** POST /tags */
  create: (data: Record<string, unknown>) => post<Tag>("/tags", data),
  /** PATCH /tags/{id} — rename/recolor */
  update: (id: string, data: { name?: string; color?: string }) => patch<Tag>(`/tags/${id}`, data),
  /** DELETE /tags/{id} */
  remove: (id: string) => del<{ ok: boolean }>(`/tags/${id}`),
  /** POST /files/tag { tag_id, root_id, paths } */
  tagFile: (params: { tag_id: string; root_id: string; paths: string | string[] }) =>
    post<{ ok: boolean }>("/files/tag", params),
  /** DELETE /files/tag?tag_id=&root_id=&paths= */
  untagFile: (params: { tag_id: string; root_id: string; paths: string }) =>
    del<{ ok: boolean }>("/files/tag", params as Record<string, string | undefined>),
};

// ── Search ──────────────────────────────────────────────────────────────
export const searchApi = {
  /** GET /search?q=&root=&limit=&offset=&mime=&type= */
  search: (params: Record<string, string | number | undefined>) =>
    get<{ items: SearchResult[] }>("/search", params),
};

// ── Playlists ───────────────────────────────────────────────────────────
export const playlistsApi = {
  /** GET /playlists */
  list: () => get<{ items: Playlist[] }>("/playlists"),
  /** GET /playlists/public */
  listPublic: () => get<{ items: Playlist[] }>("/playlists/public"),
  /** GET /playlists/cover-config */
  coverConfig: () => get<{ cover_path: string }>("/playlists/cover-config"),
  /** POST /playlists { name, description?, items } — returns 201 with the created playlist */
  create: (payload: { name: string; description?: string; items: { root_id: string; path: string }[] }) =>
    post<Playlist>("/playlists", payload),
  /** DELETE /playlists/{id} */
  delete: (id: string) => del<{ ok?: boolean }>(`/playlists/${id}`),
  /** PUT /playlists/{id} { name } */
  rename: (id: string, name: string) => put<{ ok?: boolean }>(`/playlists/${id}`, { name }),
  /** PATCH /playlists/{id} */
  update: (id: string, data: Record<string, unknown>) => patch<{ ok?: boolean }>(`/playlists/${id}`, data),
  /** POST /playlists/{id}/items { items } */
  addItems: (id: string, items: { root_id: string; path: string }[]) =>
    post<{ ok: boolean; added: number; skipped: number }>(`/playlists/${id}/items`, { items }),
  /** DELETE /playlists/{id}/items?item_id= */
  removeItem: (playlistId: string, itemId: string) =>
    del<{ ok?: boolean }>(`/playlists/${playlistId}/items`, { item_id: itemId }),
  /** PUT /playlists/{id}/items/order { item_ids } — full ordering after drag-and-drop */
  reorderItems: (id: string, itemIds: string[]) =>
    put<{ ok?: boolean }>(`/playlists/${id}/items/order`, { item_ids: itemIds }),
  /** GET /playlists/{id}/collaborators */
  listCollaborators: (id: string) =>
    get<{ collaborators: PlaylistCollaborator[] }>(`/playlists/${id}/collaborators`),
  /** POST /playlists/{id}/collaborators { action, user_id, role } */
  manageCollaborators: (id: string, payload: { action: string; user_id: string; role?: string }) =>
    post<{ collaborators: PlaylistCollaborator[] }>(`/playlists/${id}/collaborators`, payload),
};

// ── Version ─────────────────────────────────────────────────────────────
export const versionApi = {
  /** GET /version */
  get: () => get<{ version: string; go: string; product: string; tagline: string; transcode?: boolean }>("/version"),
  /** GET /version — lightweight for transcode check */
  checkTranscode: () => get<{ transcode?: boolean }>("/version"),
};

// ── Activity ────────────────────────────────────────────────────────────
export const activityApi = {
  /** GET /activity?root=&path= */
  list: (root: string, path: string) => get<{ items: any[] }>("/activity", { root, path }),
};

// ── Shares (public) & Photos / Audio helpers ───────────────────────────
export const photosApi = {
  /** GET /photos?... */
  list: (params: Record<string, string | number | boolean | undefined>) =>
    get<PhotosResponse>("/photos", params as Record<string, string | number | undefined>),
};

// Audio diagnostics (used by lib/audioQuality)
export const audioApi = {
  /** GET /audio/info?root=&path= — enriched song metadata + artist extraction */
  info: (root: string, path: string) => get<any>("/audio/info", { root, path }),
  /** POST /audio/info/batch { items: [{ root, path }] } — song-container batch */
  infoBatch: (items: Array<{ root: string; path: string }>) =>
    post<{ items: Array<{ root: string; path: string; ok: boolean; info?: any; error?: string }>; count: number }>(
      "/audio/info/batch",
      { items }
    ),
  /** GET /audio/formats — containers + transcode targets */
  formats: () => get<any>("/audio/formats"),
};

// Users directory
export const usersApi = {
  /** GET /users/search?q= */
  search: (q: string) => get<{ users: { id: string; username: string }[] }>(`/users/search?q=${encodeURIComponent(q)}`),
};

// ── Re-export existing domain helpers for single-source barrel ──────────
// These were previously defined in client.ts; keep them re-exported here so
// consumers can import everything from "@/api/endpoints" if desired.
export { savedSearchesApi, versionsApi, statsApi, lyricsApi } from "./client";

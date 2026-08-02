import type { FileListResponse, FileItem, Root, SearchResponse, User, ApiError } from "./types";

/**
 * Nexora mobile API client.
 *
 * Auth model: the backend accepts an `Authorization: Bearer <token>` header
 * (see internal/auth/middleware.go) for every API call, and media URLs accept
 * a `?token=` query param — both are used here. Tokens are returned by
 * POST /auth/login (and POST /auth/totp/verify-login).
 */

export class NexoraError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  isForm?: boolean;
  headers?: Record<string, string>;
}

function buildQuery(query?: Record<string, string | number | undefined>): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export class Api {
  baseUrl: string;
  token: string | null;

  constructor(baseUrl: string, token: string | null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  /** Absolute URL for a raw media/thumbnail endpoint, with token appended. */
  mediaUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const q: Record<string, string | number | undefined> = { ...query };
    if (this.token) q.token = this.token;
    return `${this.baseUrl}/api/v1${path}${buildQuery(q)}`;
  }

  rawFileUrl(rootId: string, path: string): string {
    return this.mediaUrl("/files/raw", { root: rootId, path });
  }

  thumbnailUrl(rootId: string, path: string, size = 256): string {
    return this.mediaUrl("/files/thumbnail", { root: rootId, path, size });
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method || "GET";
    const headers: Record<string, string> = { ...opts.headers };
    let body: BodyInit | undefined;

    if (opts.isForm) {
      body = opts.body as FormData;
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    const res = await fetch(`${this.baseUrl}/api/v1${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      body,
    });

    if (res.status === 204) return undefined as T;

    let data: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      const err = (data ?? {}) as ApiError;
      throw new NexoraError(err.error || "http_error", err.message || res.statusText, res.status);
    }
    return data as T;
  }

  get<T>(p: string, q?: RequestOptions["query"]) {
    return this.request<T>(p, { method: "GET", query: q });
  }
  post<T>(p: string, body?: unknown) {
    return this.request<T>(p, { method: "POST", body });
  }
  put<T>(p: string, body?: unknown) {
    return this.request<T>(p, { method: "PUT", body });
  }
  del<T>(p: string, q?: RequestOptions["query"]) {
    return this.request<T>(p, { method: "DELETE", query: q });
  }

  // ── Auth ────────────────────────────────────────────────────────────
  async checkNeedsSetup(): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/needs-setup`);
    if (!res.ok) return true; // assume unconfigured on any failure
    const data = (await res.json()) as { configured: boolean };
    return !data.configured;
  }

  async login(login: string, password: string): Promise<{ user: User; token?: string; totp_required?: boolean; user_id?: string }> {
    return this.post("/auth/login", { login, password });
  }

  async verifyTotp(login: string, password: string, code: string): Promise<{ user: User; token: string }> {
    return this.post("/auth/totp/verify-login", { login, password, code });
  }

  async session(): Promise<{ user: User | null }> {
    return this.get("/auth/session");
  }

  // ── Files ───────────────────────────────────────────────────────────
  listRoots(): Promise<{ roots: Root[] }> {
    return this.get("/roots");
  }

  listFiles(root: string, path: string, offset = 0, limit = 200): Promise<FileListResponse> {
    return this.get("/files", { root, path, offset, limit });
  }

  listRecents(): Promise<{ items: FileItem[] }> {
    return this.get("/recents");
  }

  search(q: string, root?: string): Promise<SearchResponse> {
    return this.get("/search", { q, root });
  }

  stat(root: string, path: string): Promise<FileItem> {
    return this.get("/files/stat", { root, path });
  }

  createDir(root: string, path: string, name: string): Promise<{ item: FileItem }> {
    return this.post("/files/directory", { root, path, name });
  }

  rename(root: string, path: string, newName: string): Promise<{ item: FileItem }> {
    return this.post("/files/rename", { root, path, new_name: newName });
  }

  remove(root: string, path: string): Promise<{ ok: boolean }> {
    return this.del("/files", { root, path });
  }

  upload(root: string, path: string, form: FormData, onProgress?: (pct: number) => void): Promise<{ uploaded: number }> {
    const xhr = new XMLHttpRequest();
    return new Promise((resolve, reject) => {
      xhr.open("POST", `${this.baseUrl}/api/v1/files/upload?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`);
      if (this.token) xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            resolve({ uploaded: 1 });
          }
        } else {
          let message = `Upload failed (${xhr.status})`;
          try {
            const d = JSON.parse(xhr.responseText);
            if (d?.message) message = d.message;
          } catch {
            /* ignore */
          }
          reject(new NexoraError("upload_failed", message, xhr.status));
        }
      };
      xhr.onerror = () => reject(new NexoraError("network_error", "Network error during upload"));
      xhr.send(form);
    });
  }
}

/** Format a byte count as a human string. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i += 1;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

/** Preview kinds, mirroring web/src/lib/preview.ts. */
export type PreviewKind = "image" | "video" | "audio" | "pdf" | "markdown" | "text" | "code" | "other";

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif", "avif"]);
const VIDEO_EXT = new Set(["mp4", "m4v", "webm", "mov", "mkv", "avi", "ogv", "3gp"]);
const AUDIO_EXT = new Set(["mp3", "flac", "wav", "aac", "m4a", "ogg", "opus", "wma", "alac"]);
const PDF_EXT = new Set(["pdf"]);
const MD_EXT = new Set(["md", "markdown"]);
const TEXT_EXT = new Set(["txt", "log", "csv", "json", "xml", "yaml", "yml", "ini", "conf", "env", "toml", "srt", "vtt"]);
const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "rb", "php", "java", "kt", "swift",
  "c", "h", "cpp", "hpp", "cs", "sh", "bash", "sql", "html", "css", "scss", "vue", "svelte",
]);

export function previewKind(item: FileItem): PreviewKind {
  const ext = (item.extension || "").toLowerCase().replace(/^\./, "");
  if (item.is_dir) return "other";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (PDF_EXT.has(ext)) return "pdf";
  if (MD_EXT.has(ext)) return "markdown";
  if (TEXT_EXT.has(ext)) return "text";
  if (CODE_EXT.has(ext)) return "code";
  return "other";
}

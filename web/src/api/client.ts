import type { ApiError, SavedSearch, SavedSearchInput, SearchResult, FileVersion, StorageStats } from "./types";

// ── Tailscale / server discovery ──────────────────────────────────
// Tailscale hosts are probed in order — the first to respond wins.
// HTTPS is handled by Caddy reverse proxy (self-signed cert).
// HTTP fallback is always available.
const TAILSCALE_HOSTS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "https://pms2.tail58d7ea.ts.net",
  "http://pms2.tail58d7ea.ts.net",
  "http://100.67.251.1:80",
];

/**
 * Get the base API URL for network requests.
 * In Tauri desktop environment, defaults to http://localhost:8080 if nexora-api-url is not set.
 */
export function getBaseUrl(): string {
  const isTauri = typeof window !== "undefined" && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);
  const storedUrl = localStorage.getItem("nexora-api-url");
  if (isTauri) {
    if (!storedUrl) {
      return "http://localhost:8080";
    }
    // Only http(s) origins are valid API bases. Anything else (e.g. a
    // `javascript:` value planted in localStorage) is rejected so DOM text
    // can never reach src/href/location sinks via the media URL helpers.
    const trimmed = storedUrl.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed.replace(/\/$/, "");
    }
    return "";
  }
  return "";
}

/**
 * Try to discover the Nexora server URL by probing known Tailscale hosts.
 * Returns the first responsive URL, or null if none respond.
 */
export async function discoverServerUrl(): Promise<string | null> {
  for (const url of TAILSCALE_HOSTS) {
    try {
      const res = await fetch(`${url}/api/v1/auth/needs-setup`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        return url;
      }
    } catch {
      // host unreachable — try next
    }
  }
  return null;
}

const CSRF_COOKIE = "nexora_csrf";

function readCookie(name: string): string {
  const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : "";
}

export function getCsrfToken(): string {
  return readCookie(CSRF_COOKIE);
}

export class NexoraError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface RequestOptions {
  method?: string;
  body?: any;
  query?: Record<string, string | number | undefined>;
  isForm?: boolean;
  signal?: AbortSignal;
}

function buildQuery(query?: Record<string, string | number | undefined>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") params.set(k, String(v));
  }
  const s = params.toString();
  return s ? "?" + s : "";
}

export function getMediaUrl(path: string, query?: Record<string, string | number | undefined | boolean>): string {
  const isTauri = typeof window !== "undefined" && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);
  const baseUrl = getBaseUrl();

  const params = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== false && v !== "") params.set(k, String(v));
    }
  }

  const storedToken = localStorage.getItem("nexora-token");
  if (storedToken && isTauri) {
    params.set("token", storedToken);
  }

  const s = params.toString();
  const url = baseUrl + "/api/v1" + path + (s ? "?" + s : "");
  // Only http(s) URLs may ever be returned. The stored API base is
  // user-controllable in Tauri mode, so anything else (e.g. a `javascript:`
  // value) must not reach src/href/location sinks. Resolving against the
  // current origin also normalizes relative URLs (browser mode).
  try {
    const u = new URL(url, window.location.origin);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return u.href;
    }
  } catch {
    // Invalid URL – ignore.
  }
  return "";
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method || "GET";
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (opts.isForm) {
    body = opts.body as FormData;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  // CSRF protection for state-changing requests.
  if (method !== "GET" && method !== "HEAD") {
    const csrf = getCsrfToken();
    if (csrf) {
      headers["X-CSRF-Token"] = csrf;
    }
  }

  const isTauri = typeof window !== "undefined" && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).isTauri);
  const baseUrl = getBaseUrl();

  const storedToken = localStorage.getItem("nexora-token");
  if (storedToken && isTauri) {
    headers["Authorization"] = "Bearer " + storedToken;
  }

  const res = await fetch(baseUrl + "/api/v1" + path + buildQuery(opts.query), {
    method,
    headers,
    body,
    credentials: "include",
    signal: opts.signal,
  });

  if (res.status === 204) return undefined as T;

  let data: any = null;
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
    throw new NexoraError(err.error || "http_error", err.message || res.statusText);
  }
  return data as T;
}

// Convenience helpers.
export const get = <T>(p: string, q?: RequestOptions["query"]) => api<T>(p, { method: "GET", query: q });
export const post = <T>(p: string, body?: any) => api<T>(p, { method: "POST", body });
export const put = <T>(p: string, body?: any) => api<T>(p, { method: "PUT", body });
export const patch = <T>(p: string, body?: any) => api<T>(p, { method: "PATCH", body });
export const del = <T>(p: string, q?: RequestOptions["query"]) => api<T>(p, { method: "DELETE", query: q });
export const upload = <T>(p: string, form: FormData) => api<T>(p, { method: "POST", body: form, isForm: true });

// Saved Searches API.
export const savedSearchesApi = {
  list: () => get<{ items: SavedSearch[] }>("/saved-searches"),
  create: (input: SavedSearchInput) => post<{ saved_search: SavedSearch }>("/saved-searches", input),
  update: (id: string, input: SavedSearchInput) => put<{ saved_search: SavedSearch }>(`/saved-searches/${id}`, input),
  delete: (id: string) => del<{ ok: boolean }>(`/saved-searches/${id}`),
  execute: (id: string, q?: { limit?: number; offset?: number; root?: string }) =>
    get<{ saved_search: SavedSearch; results: SearchResult[]; limit: number; offset: number; total: number }>(`/saved-searches/${id}/execute`, q),
};

// File Versions API.
export const versionsApi = {
  list: (root: string, path: string) => get<{ versions: FileVersion[] }>("/files/versions", { root, path }),
  create: (root: string, path: string, note?: string) => post<{ version: FileVersion }>("/files/versions", { root, path, note }),
  restore: (id: string) => post<{ ok: boolean }>(`/files/versions/${id}/restore`),
  delete: (id: string) => del<{ ok: boolean }>(`/files/versions/${id}`),
};

// Storage Stats API.
export const statsApi = {
  get: (root: string) => get<StorageStats>("/stats", { root }),
  duplicates: (root: string) => get<{ duplicates: Array<{ name: string; path: string; size: number; root_id: string }[]> }>("/files/duplicates", { root }),
};

import type { ApiError } from "./types";

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
    headers["X-CSRF-Token"] = getCsrfToken();
  }

  const res = await fetch("/api/v1" + path + buildQuery(opts.query), {
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
export const del = <T>(p: string, q?: RequestOptions["query"]) => api<T>(p, { method: "DELETE", query: q });
export const upload = <T>(p: string, form: FormData) => api<T>(p, { method: "POST", body: form, isForm: true });

/*
 * Nexora service worker — deliberately conservative.
 *
 * Strategy:
 *  - Navigations (HTML): network-first, fall back to the cached shell when
 *    offline. index.html is re-cached on every successful fetch, so app
 *    updates land on the next reload.
 *  - /assets/*: cache-first. Vite emits content-hashed filenames, so a
 *    cached asset is immutable — safe to serve forever.
 *  - /api/*, /healthz: NEVER cached (always network).
 *
 * Version bump the CACHE name to purge all runtime caches.
 */
const CACHE = "nexora-v1";
const SHELL = "/";

// The standalone PDF viewer shipped for the mobile WebView lives under this
// prefix. It is a separate document and must never be adopted as the app shell.
const EXCLUDED_NAV = ["/pdfviewer/"];

// Only a genuine, successful app-index response may become the cached shell.
// Caching an arbitrary navigation (a 404 page, an error page, a share page,
// the PDF viewer) would replace the app shell for every offline load.
function isCacheableShell(res) {
  if (!res || !res.ok || res.status !== 200) return false;
  if (res.type !== "basic" && res.type !== "default") return false;
  const type = res.headers.get("content-type") || "";
  return type.includes("text/html");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([SHELL])).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache writes must be handed to waitUntil or the worker can be terminated
// mid-write, leaving the cache permanently missing that entry.
function cachePut(request, response) {
  return caches.open(CACHE).then((c) => c.put(request, response));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") return;
  if (EXCLUDED_NAV.some((p) => url.pathname.startsWith(p))) return;

  // App shell / navigations → network-first with cached fallback.
  if (req.mode === "navigate" || url.pathname === "/") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (isCacheableShell(res)) {
            event.waitUntil(cachePut(SHELL, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r || Response.error()))
    );
    return;
  }

  // Hashed build assets → cache-first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) event.waitUntil(cachePut(req, res.clone()));
            return res;
          })
      )
    );
  }
});

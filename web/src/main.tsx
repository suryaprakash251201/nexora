import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { RouterProvider } from "react-router";
import { router } from "./router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// Initialize accent theme from localStorage
const savedAccent = localStorage.getItem("accent-theme") || "midnight";
document.documentElement.dataset.theme = savedAccent;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5000 },
  },
});

// Public share pages are served at /s/<token> and do not require auth.
// The Router handles routing between App and SharePage.

// PWA: register the service worker only for real production origins — never in
// Tauri (custom protocol), during `vite dev` (where it would shadow HMR and
// serve a stale shell), or in non-secure contexts.
const canUseServiceWorker =
  import.meta.env.PROD &&
  "serviceWorker" in navigator &&
  location.protocol.startsWith("http") &&
  !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

if (canUseServiceWorker) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is best-effort */
    });
  });
} else if ("serviceWorker" in navigator) {
  // Tear down a worker left behind by a previous production build being served
  // on this origin, otherwise it keeps serving the cached shell in dev.
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
}

// Keep the browser UI (address bar, mobile task switcher) in step with the
// active theme. A single static <meta theme-color> stays dark after switching
// to light mode, which looks broken on mobile.
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const light = document.documentElement.classList.contains("light");
  meta.setAttribute("content", light ? "#F8FAFC" : "#090B12");
}
syncThemeColor();
new MutationObserver(syncThemeColor).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class"],
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem themes={["dark", "light"]}>
        <ErrorBoundary>
          <RouterProvider router={router} />
        </ErrorBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

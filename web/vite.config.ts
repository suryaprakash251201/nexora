import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build the SPA to ../web/dist (relative to the Dockerfile's web context).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to the Go backend during development.
      "/api": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
});

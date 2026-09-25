import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// import.meta.dirname, not __dirname: Vite's native config loader does not
// define __dirname and warns about it on every dev/build start.
const rootDir = import.meta.dirname;

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  // Vitest: unit tests only — Playwright specs live in ./e2e
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
      "@nexora/core": path.resolve(rootDir, "../packages/core/src"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/react/")) return "vendor-react";
          if (id.includes("node_modules/react-dom/")) return "vendor-react";
          if (id.includes("node_modules/motion/")) return "vendor-motion";
          if (id.includes("node_modules/@tanstack/react-query/")) return "vendor-query";
          if (id.includes("node_modules/lucide-react/")) return "vendor-icons";
          if (id.includes("node_modules/@base-ui/react/")) return "vendor-ui";
          if (id.includes("node_modules/cmdk/")) return "vendor-ui";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
});

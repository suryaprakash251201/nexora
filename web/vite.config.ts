import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@nexora/core": path.resolve(__dirname, "../packages/core/src"),
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
          if (id.includes("node_modules/sonner/")) return "vendor-ui";
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

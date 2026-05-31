import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  appType: "spa",
  plugins: [preact({ devToolsEnabled: false }), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/mcp": "http://127.0.0.1:8080",
      "/docs": "http://127.0.0.1:8080",
      "/openapi.yaml": "http://127.0.0.1:8080",
      "/healthz": "http://127.0.0.1:8080",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "../internal/web/static",
    emptyOutDir: true,
  },
});

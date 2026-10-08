import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { onlineExamples } from "./tooling/onlineExamples";
import { onlineEntry } from "./tooling/onlineEntry";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react(), onlineExamples(), ...(mode === "online" ? [onlineEntry()] : [])],
  build: {
    outDir: mode === "online" ? "dist-online" : "dist",
    rollupOptions: { input: mode === "online" ? path.resolve(__dirname, "online.html") : {
      editor: path.resolve(__dirname, "index.html"), online: path.resolve(__dirname, "online.html"),
    } },
  },
  worker: { format: "es" },
  server: {
    watch: { ignored: ["**/release/**", "**/desktop-out/**", "**/dist-online/**"] },
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
  resolve: {
    alias: {
      "@ordinate/core": path.resolve(__dirname, "../../packages/core-ts/src/index.ts"),
    },
  },
}));

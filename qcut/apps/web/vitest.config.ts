/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(rootDir, "src/test/minimal-setup.js")],
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
});

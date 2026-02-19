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
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost:3000",
      },
    },
    globalSetup: path.resolve(rootDir, "src/test/global-setup.ts"),
    setupFiles: [
      path.resolve(rootDir, "src/test/preload-polyfills.ts"),
      path.resolve(rootDir, "src/test/setup-radix-patches.ts"),
      path.resolve(rootDir, "src/test/setup.ts"),
    ],
    include: [
      "**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "../../electron/__tests__/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "../../electron/claude/__tests__/**/*.{test,spec}.?(c|m)[jt]s?(x)",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
    isolate: true,
    pool: "forks",
    testTimeout: 5000,
    hookTimeout: 5000,
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
});

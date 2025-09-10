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
        // Enable additional JSDOM features for better compatibility
        pretendToBeVisual: true,
        resources: "usable"
      }
    },
    setupFiles: [
      path.resolve(rootDir, "src/test/simplified-setup.ts")
    ],
    isolate: false, // Disable test isolation to allow proper DOM setup
    pool: "threads", // Use threads instead of forks for better DOM sharing
    testTimeout: 10000, // Increase timeout for complex component tests
    hookTimeout: 10000,
    env: {
      // Force browser APIs to be available
      NODE_ENV: "test"
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
});

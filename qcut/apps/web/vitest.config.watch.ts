import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: "./src/test/setup.ts",
    watch: true,
    watchExclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/coverage/**",
      "**/dist-electron/**",
      "**/dist-packager*/**",
      "**/*.log",
    ],
    // Only re-run tests related to changed files
    passWithNoTests: true,
    // Faster feedback in watch mode
    isolate: false,
    threads: true,
    // API server configuration for Vitest v3.2.4
    api: 51_204, // Enable API server on port 51204
    open: false, // Don't auto-open browser
    coverage: {
      enabled: false, // Disable coverage in watch mode for performance
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "src/test/",
        "*.config.ts",
        "**/*.d.ts",
        "src/routes/**",
        "src/routeTree.gen.ts",
      ],
    },
    // Faster test execution in watch mode
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: false,
      },
    },
    // Reporter configuration for watch mode
    reporters: process.env.CI ? ["verbose"] : ["default"],
    // Fail fast in watch mode to get quicker feedback
    bail: 1,
    // Custom watch patterns
    forceRerunTriggers: [
      "**/vitest.config.*",
      "**/vite.config.*",
      "**/src/test/setup.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

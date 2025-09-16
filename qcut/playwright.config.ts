import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';

export default defineConfig({
  testDir: './apps/web/src/test/e2e',
  fullyParallel: false, // Electron tests need sequential execution due to port conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Force single worker for Electron to avoid port conflicts
  reporter: 'html',
  timeout: 60000, // 1 minute timeout for E2E tests
  expect: {
    timeout: 10000, // 10 seconds for assertions
  },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'electron',
      testDir: './apps/web/src/test/e2e',
      testMatch: '**/*.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Electron-specific configuration - tests launch Electron app directly from dist/
      },
    },
  ],

  // Explicitly ignore non-E2E test files
  testIgnore: [
    '**/node_modules/**',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '**/src/test/**/*.ts',
    '**/src/test/**/*.tsx',
    '!**/src/test/e2e/**/*.e2e.ts'
  ],

  // Note: No webServer needed - Electron tests launch the app directly from dist/electron/main.js
});
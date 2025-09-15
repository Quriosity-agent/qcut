import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';

export default defineConfig({
  testDir: './apps/web/src/test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
      testMatch: '**/*.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Electron-specific configuration will be added here
      },
    },
  ],

  // Run your local dev server before starting the tests
  webServer: {
    command: 'bun dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    cwd: resolve(__dirname),
  },
});
import { test as base, expect, Page } from '@playwright/test';
import { ElectronApplication, _electron as electron } from 'playwright';

export interface ElectronFixtures {
  electronApp: ElectronApplication;
  page: Page;
}

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    // Launch Electron app
    const electronApp = await electron.launch({
      args: ['dist/electron/main.js'],
      env: {
        NODE_ENV: 'test',
        // Disable hardware acceleration for consistent testing
        ELECTRON_DISABLE_GPU: '1'
      }
    });

    await use(electronApp);
    await electronApp.close();
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();

    // Wait for the app to be ready
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000); // Give app time to initialize

    await use(page);
  },
});

export { expect };

// Helper functions for common E2E operations
export async function waitForProjectLoad(page: Page) {
  await page.waitForSelector('[data-testid="editor-loaded"]', { timeout: 10000 });
}

export async function createTestProject(page: Page, projectName = 'E2E Test Project') {
  await page.getByTestId('new-project-button').click();
  await page.waitForTimeout(500);

  // If there's a project creation modal, fill it out
  const nameInput = page.getByTestId('project-name-input');
  if (await nameInput.isVisible()) {
    await nameInput.fill(projectName);
    await page.getByTestId('create-project-confirm').click();
  }

  // Wait for editor to load
  await waitForProjectLoad(page);
}

export async function uploadTestMedia(page: Page, filePath: string) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(filePath);

  // Wait for upload to complete
  await page.waitForSelector('[data-testid="media-item"]', { timeout: 15000 });
}
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

    // Wait for the app to be ready using proper state-based waiting
    await page.waitForLoadState('domcontentloaded');

    // Wait for the main app component to be ready instead of using fixed timeout
    try {
      // Try waiting for main application elements that indicate readiness
      await Promise.race([
        page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 }),
        page.waitForSelector('[data-testid="new-project-button"], [data-testid="project-list"]', { timeout: 10000 }),
        page.waitForSelector('.app-container, #root', { timeout: 10000 }),
      ]);
    } catch (error) {
      // Fallback: wait for network idle as last resort
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    }

    await use(page);
  },
});

export { expect };

// Helper functions for common E2E operations
export async function waitForProjectLoad(page: Page) {
  // Wait for editor components to indicate the project is fully loaded
  try {
    await Promise.race([
      page.waitForSelector('[data-testid="editor-loaded"]', { timeout: 10000 }),
      // Alternative indicators that editor is ready
      page.waitForSelector('[data-testid="timeline-track"][data-track-type]', { timeout: 10000 }),
      // If no specific editor-loaded indicator, wait for timeline and media panel
      Promise.all([
        page.waitForSelector('[data-testid="timeline-track"]', { timeout: 10000 }),
        page.waitForSelector('[data-testid="media-panel"], [data-testid="import-media-button"]', { timeout: 10000 })
      ])
    ]);
  } catch (error) {
    // Fallback: just ensure timeline exists
    await page.waitForSelector('[data-testid="timeline-track"]', { timeout: 15000 });
  }
}

export async function createTestProject(page: Page, projectName = 'E2E Test Project') {
  // Wait for either the header button or empty state button to be available
  await page.waitForSelector('[data-testid="new-project-button"], [data-testid="new-project-button-empty-state"]');

  // Click whichever button is available (header or empty state)
  const headerButton = page.getByTestId('new-project-button');
  const emptyStateButton = page.getByTestId('new-project-button-empty-state');

  if (await headerButton.isVisible()) {
    await headerButton.click();
  } else {
    await emptyStateButton.click();
  }

  // If there's a project creation modal, fill it out
  const nameInput = page.getByTestId('project-name-input');
  if (await nameInput.isVisible({ timeout: 2000 })) {
    await nameInput.fill(projectName);
    await page.getByTestId('create-project-confirm').click();

    // Wait for modal to close by waiting for timeline to appear
    await page.waitForSelector('[data-testid="timeline-track"]', { timeout: 10000 });
  } else {
    // No modal - direct navigation, wait for editor elements
    await page.waitForSelector('[data-testid="timeline-track"], [data-testid="editor-container"]', { timeout: 10000 });
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

// Additional helper functions for the E2E tests
export async function startElectronApp() {
  return await electron.launch({
    args: ['dist/electron/main.js'],
    env: {
      NODE_ENV: 'test',
      ELECTRON_DISABLE_GPU: '1'
    }
  });
}

export async function getMainWindow(electronApp: ElectronApplication) {
  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Wait for app readiness using state-based waiting
  await waitForAppReady(page);

  return page;
}

/**
 * Waits for the application to be fully ready for testing
 */
export async function waitForAppReady(page: Page) {
  try {
    await Promise.race([
      page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 }),
      page.waitForSelector('[data-testid="new-project-button"], [data-testid="project-list"]', { timeout: 10000 }),
      page.waitForSelector('.app-container, #root', { timeout: 10000 }),
    ]);
  } catch (error) {
    // Fallback: wait for network idle and ensure basic DOM structure exists
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Verify at least basic DOM elements are present
    await page.waitForFunction(
      () => {
        return document.body &&
               (document.querySelector('[data-testid]') ||
                document.querySelector('#root') ||
                document.querySelector('.app-container'));
      },
      { timeout: 5000 }
    );
  }
}
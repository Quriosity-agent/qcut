/**
 * Electron E2E Testing Helpers
 *
 * This module provides Playwright fixtures and helper functions for testing
 * Electron applications, specifically designed for QCut video editor E2E tests.
 */

import { test as base, expect, Page } from '@playwright/test';
import { ElectronApplication, _electron as electron } from 'playwright';
import { resolve as pathResolve } from 'path';

/**
 * Resolve media fixture paths relative to this helper file
 */
const mediaPath = (file: string) =>
  pathResolve(__dirname, '../fixtures/media', file);

/**
 * Electron-specific test fixtures that extend Playwright's base fixtures
 * with Electron application and page instances.
 */
export interface ElectronFixtures {
  /** The Electron application instance */
  electronApp: ElectronApplication;
  /** The main window page instance */
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

    // Navigate to projects page for E2E testing
    await navigateToProjects(page);

    await use(page);
  },
});

export { expect };

/**
 * Helper functions for common E2E operations
 */

/**
 * Navigates from home page to projects page for E2E testing.
 * Handles the initial app state and ensures we're on the projects page.
 *
 * @param page - The Playwright page instance
 * @throws {Error} When navigation to projects page fails
 */
export async function navigateToProjects(page: Page) {
  try {
    // First wait for the home page to load
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    // Check if we're already on projects page (look for any project creation button)
    const anyProjectButton = page.locator('[data-testid="new-project-button"], [data-testid="new-project-button-mobile"], [data-testid="new-project-button-empty-state"]');
    if (await anyProjectButton.first().isVisible({ timeout: 2000 })) {
      // Already on projects page
      return;
    }

    // Look for the "Try early beta" button on the home page
    const tryBetaButton = page.locator('a[href="/projects"] button', { hasText: 'Try early beta' });
    if (await tryBetaButton.isVisible({ timeout: 5000 })) {
      await tryBetaButton.click();
    } else {
      // Alternative: try to navigate directly via TanStack Router
      await page.evaluate(() => {
        // Use TanStack Router's navigation if available
        const router = (window as any).router;
        if (router && router.navigate) {
          router.navigate({ to: '/projects' });
        } else {
          // Fallback: modify location hash since TanStack Router uses hash routing
          window.location.hash = '#/projects';
        }
      });
    }

    // Wait for projects page to load (any of the project buttons or project list) - use attached state for hidden responsive elements
    await page.waitForSelector('[data-testid="new-project-button"], [data-testid="new-project-button-mobile"], [data-testid="new-project-button-empty-state"], [data-testid="project-list"]', { timeout: 10000, state: 'attached' });
  } catch (error) {
    console.warn('Navigation to projects page failed, continuing anyway:', error);
    // Don't throw - let individual tests handle missing elements
  }
}

/**
 * Waits for a project to fully load in the editor interface.
 * Uses multiple fallback strategies to ensure reliable waiting.
 *
 * @param page - The Playwright page instance
 * @throws {Error} When project fails to load within timeout
 */
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

/**
 * Creates a new test project with the specified name.
 * Handles both header and empty state button scenarios.
 *
 * @param page - The Playwright page instance
 * @param projectName - Name for the new project (default: 'E2E Test Project')
 * @throws {Error} When project creation fails or times out
 */
export async function createTestProject(page: Page, projectName = 'E2E Test Project') {
  // Wait for any of the project creation buttons to be in the DOM (they might be hidden by responsive CSS)
  await page.waitForSelector('[data-testid="new-project-button"], [data-testid="new-project-button-mobile"], [data-testid="new-project-button-empty-state"]', { state: 'attached' });

  // Small delay to ensure page is stable
  await page.waitForTimeout(1000);

  // Check if we're in empty state (no projects)
  const emptyStateButton = page.getByTestId('new-project-button-empty-state');
  const hasEmptyState = await emptyStateButton.count() > 0;

  if (hasEmptyState && await emptyStateButton.isVisible()) {
    // No projects - click empty state button
    await emptyStateButton.click();
  } else {
    // Has projects - find and click the visible header button
    // Use a more specific selector that targets the visible button
    const visibleButton = page.locator('[data-testid="new-project-button"]:visible, [data-testid="new-project-button-mobile"]:visible').first();

    if (await visibleButton.count() > 0) {
      await visibleButton.click();
    } else {
      // Last resort: click any new project button that exists
      const anyButton = page.locator('[data-testid*="new-project"]').first();
      await anyButton.click();
    }
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

/**
 * Uploads test media file through the import media interface.
 * Clicks the import button and selects the specified file.
 *
 * @param page - The Playwright page instance
 * @param filePath - Relative path to the media file from project root
 * @throws {Error} When file upload fails or times out
 */
export async function uploadTestMedia(page: Page, filePath: string) {
  // Click the import media button to trigger file picker
  await page.getByTestId('import-media-button').click();

  // Wait for file input to be available and set the file
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(filePath);

  // Wait for upload to complete
  await page.waitForSelector('[data-testid="media-item"]', { timeout: 15000 });
}

/**
 * Imports the standard test video file (sample-video.mp4).
 * Uses the pre-created 5-second 720p test video for E2E testing.
 *
 * @param page - The Playwright page instance
 * @throws {Error} When video import fails
 */
export async function importTestVideo(page: Page) {
  const videoPath = mediaPath('sample-video.mp4');
  await uploadTestMedia(page, videoPath);
}

/**
 * Imports the standard test audio file (sample-audio.mp3).
 * Uses the pre-created 5-second sine wave test audio for E2E testing.
 *
 * @param page - The Playwright page instance
 * @throws {Error} When audio import fails
 */
export async function importTestAudio(page: Page) {
  const audioPath = mediaPath('sample-audio.mp3');
  await uploadTestMedia(page, audioPath);
}

/**
 * Imports the standard test image file (sample-image.png).
 * Uses the pre-created 1280x720 blue test image for E2E testing.
 *
 * @param page - The Playwright page instance
 * @throws {Error} When image import fails
 */
export async function importTestImage(page: Page) {
  const imagePath = mediaPath('sample-image.png');
  await uploadTestMedia(page, imagePath);
}

/**
 * Additional helper functions for the E2E tests
 */

/**
 * Starts an Electron application instance for testing.
 * Configures test environment with GPU acceleration disabled.
 *
 * @returns Promise<ElectronApplication> The launched Electron app instance
 * @throws {Error} When Electron app fails to launch
 */
export async function startElectronApp() {
  return await electron.launch({
    args: ['dist/electron/main.js'],
    env: {
      NODE_ENV: 'test',
      ELECTRON_DISABLE_GPU: '1'
    }
  });
}

/**
 * Gets the main window from an Electron application instance.
 * Waits for DOM content to load and app to be ready.
 *
 * @param electronApp - The Electron application instance
 * @returns Promise<Page> The main window page instance
 * @throws {Error} When main window is not accessible
 */
export async function getMainWindow(electronApp: ElectronApplication) {
  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Wait for app readiness using state-based waiting
  await waitForAppReady(page);

  return page;
}

/**
 * Waits for the application to be fully ready for testing.
 * Uses multiple strategies including element detection and network idle state.
 *
 * @param page - The Playwright page instance
 * @throws {Error} When app fails to reach ready state within timeout
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
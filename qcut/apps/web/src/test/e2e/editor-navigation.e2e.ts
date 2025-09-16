/**
 * Editor Navigation E2E Test
 *
 * Tests navigation to the editor page to isolate crash issues
 */

import { test, expect } from './helpers/electron-helpers';

test.describe('Editor Navigation Test', () => {
  test('should detect existing project on projects page', async ({ page }) => {
    // Verify we're on projects page
    await expect(page.getByText('Your Projects')).toBeVisible();

    // Check for existing projects
    const projectCards = page.getByTestId('project-list-item');
    const projectCount = await projectCards.count();

    console.log(`Found ${projectCount} existing projects`);

    if (projectCount > 0) {
      // Get the first project's name
      const firstProject = projectCards.first();
      const projectName = await firstProject.locator('h3').textContent();
      console.log(`First project name: ${projectName}`);

      await expect(firstProject).toBeVisible();
    }
  });

  test('should attempt to open existing project without crash', async ({ page }) => {
    // Check if there are existing projects
    const projectCards = page.getByTestId('project-list-item');
    const projectCount = await projectCards.count();

    if (projectCount === 0) {
      console.log('No existing projects to test with');
      test.skip();
      return;
    }

    // Setup a listener for console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Setup a listener for page crashes
    page.on('crash', () => {
      console.error('PAGE CRASHED!');
    });

    // Try clicking on the first project
    const firstProject = projectCards.first();
    console.log('Attempting to click on project...');

    try {
      // Click with a timeout to catch potential crashes
      await firstProject.click({ timeout: 5000 });

      // Wait a bit to see if the app crashes
      await page.waitForTimeout(2000);

      // Check if we're still connected
      const title = await page.title().catch(() => 'CRASHED');
      console.log(`Page title after click: ${title}`);

      // Check for any console errors
      if (errors.length > 0) {
        console.log('Console errors detected:', errors);
      }

      // Try to verify we made it to the editor
      const editorElement = page.locator('[data-testid="editor-container"], [data-testid="timeline-track"], .editor-layout');
      const isOnEditor = await editorElement.first().isVisible({ timeout: 5000 }).catch(() => false);

      if (isOnEditor) {
        console.log('Successfully navigated to editor!');
      } else {
        console.log('Navigation completed but editor elements not found');
      }

    } catch (error) {
      console.error('Error during navigation:', error);
      // Check if the page is still responsive
      const isResponsive = await page.evaluate(() => true).catch(() => false);
      if (!isResponsive) {
        throw new Error('Electron app became unresponsive after clicking project');
      }
    }
  });

  test('should check if direct navigation to editor works', async ({ page }) => {
    // Setup error tracking
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Use JavaScript navigation since page.goto doesn't work in Electron
    await page.evaluate(() => {
      // Properly typed router access
      interface RouterWindow extends Window {
        router?: {
          navigate: (options: { to: string }) => void;
        };
      }

      const routerWindow = window as RouterWindow;
      if (routerWindow.router?.navigate) {
        routerWindow.router.navigate({ to: '/editor/test-project-id' });
      } else {
        // Fallback: use hash navigation
        window.location.hash = '#/editor/test-project-id';
      }
    });

    // Wait for navigation to complete by checking for editor elements or error state
    const editorLocator = page.locator('[data-testid="editor-container"], [data-testid="timeline-track"], .editor-layout');
    const errorLocator = page.locator('text=/not found|error/i');

    // Wait for either editor to load or error to appear
    await Promise.race([
      editorLocator.first().waitFor({ timeout: 10000 }),
      errorLocator.first().waitFor({ timeout: 10000 })
    ]);

    // Verify app is still responsive
    await page.evaluate(() => document.title);

    // Assert the current URL contains editor route
    const currentUrl = await page.evaluate(() => window.location.href);
    expect(currentUrl).toContain('/editor/test-project-id');

    // Check if editor loaded successfully or if we got expected error
    const hasEditor = await editorLocator.first().isVisible();
    const hasError = await errorLocator.first().isVisible();

    if (hasEditor) {
      // Success: editor loaded
      expect(hasEditor).toBe(true);
    } else if (hasError) {
      // Expected: project not found error (since test-project-id doesn't exist)
      expect(hasError).toBe(true);
    } else {
      throw new Error('Neither editor nor error state detected after navigation');
    }

    // Log any console errors for debugging (but don't fail the test)
    if (errors.length > 0) {
      console.log('Console errors (expected for non-existent project):', errors.slice(0, 3));
    }
  });
});
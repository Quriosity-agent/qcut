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
    // Try to navigate directly to a mock editor URL
    console.log('Testing direct editor navigation...');

    // Setup error tracking
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    try {
      // Use JavaScript navigation since page.goto doesn't work in Electron
      await page.evaluate(() => {
        // Try to navigate using the router if available
        const router = (window as any).router;
        if (router && router.navigate) {
          console.log('Using router to navigate to editor');
          router.navigate({ to: '/editor/test-project-id' });
        } else {
          console.log('Router not available, using location change');
          window.location.hash = '#/editor/test-project-id';
        }
      });

      // Wait to see what happens
      await page.waitForTimeout(3000);

      // Check if we're still connected
      const isResponsive = await page.evaluate(() => true).catch(() => false);

      if (isResponsive) {
        console.log('App is still responsive after navigation attempt');

        // Check what page we're on
        const currentUrl = await page.evaluate(() => window.location.href);
        console.log('Current URL:', currentUrl);

        // Check for errors
        if (errors.length > 0) {
          console.log('Console errors:', errors);
        }
      } else {
        throw new Error('App became unresponsive');
      }

    } catch (error) {
      console.error('Direct navigation test failed:', error);
      throw error;
    }
  });
});
/**
 * Simple Navigation E2E Test
 *
 * Tests basic navigation without going to editor page to isolate the crash
 */

import { test, expect } from './helpers/electron-helpers';

test.describe('Simple Navigation Test', () => {
  test('should navigate to projects page successfully', async ({ page }) => {
    // The page fixture automatically navigates to projects page
    // Just verify we're on the right page
    await expect(page.getByText('Your Projects')).toBeVisible();

    // Check if there are existing projects or empty state
    const projectCount = await page.locator('text=/\\d+ projects?/').first().textContent();
    console.log('Project count:', projectCount);

    if (projectCount?.includes('0 project')) {
      // Empty state - verify empty state button
      await expect(page.getByText('No projects yet')).toBeVisible();
      await expect(page.getByTestId('new-project-button-empty-state')).toBeVisible();
    } else {
      // Has projects - verify project list and header button
      await expect(page.getByTestId('project-list-item').first()).toBeVisible();
      await expect(page.getByTestId('new-project-button').first()).toBeAttached();
    }
  });

  test('should be able to detect project creation button', async ({ page }) => {
    // Test that we can find the header "New project" button (always present)
    const headerButton = page.getByTestId('new-project-button').first();

    await expect(headerButton).toBeAttached();
    await expect(headerButton).toContainText('New project');

    // Check if there are projects to determine which button to test
    const hasProjects = await page.getByTestId('project-list-item').first().isVisible().catch(() => false);

    if (!hasProjects) {
      // Empty state - test empty state button
      const emptyStateButton = page.getByTestId('new-project-button-empty-state');
      await expect(emptyStateButton).toBeVisible();
      await expect(emptyStateButton).toBeEnabled();
      await expect(emptyStateButton).toContainText('Create Your First Project');
    }
  });
});
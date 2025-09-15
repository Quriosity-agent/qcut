/**
 * Project Creation & Media Import E2E Tests
 *
 * Tests the fundamental project workflow including project creation,
 * media import, file upload processes, and basic editor functionality.
 */

import { test, expect, createTestProject, importTestVideo } from '../helpers/electron-helpers';

/**
 * Test suite for Project Creation & Media Import (Subtask 1A)
 * Covers basic project setup and media import workflows.
 */
test.describe('Project Creation & Media Import (Subtask 1A)', () => {
  /**
   * Tests complete project creation and media import workflow.
   * Verifies new project creation and successful video file import.
   */
  test('should create project and import media', async ({ page }) => {
    // Navigate to projects page
    await page.goto('/projects');

    // Test steps:
    // 1. Create new project with settings (1080p, 30fps)
    await createTestProject(page, 'E2E Workflow Test Project');

    // 2. Import video file (MP4)
    await importTestVideo(page);

    // 3. Verify media item appears in the media panel
    await expect(page.getByTestId('media-item').first()).toBeVisible();
  });

  /**
   * Tests the file upload process and UI feedback.
   * Verifies proper handling of file selection and upload indicators.
   */
  test('should handle file upload process', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="import-media-button"]');

    // Test file upload UI interactions
    await page.getByTestId('import-media-button').click();

    // Verify drag and drop functionality is available
    const mediaPanel = page.locator('.media-panel, [class*="media"]').first();
    await expect(mediaPanel).toBeVisible();

    // Verify upload button accessibility
    await expect(page.getByTestId('import-media-button')).toBeEnabled();
  });
});
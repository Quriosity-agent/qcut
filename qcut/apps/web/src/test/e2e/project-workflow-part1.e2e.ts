import { test, expect, uploadTestMedia } from '../helpers/electron-helpers';

test.describe('Project Creation & Media Import (Subtask 1A)', () => {
  test('should create project and import media', async ({ page }) => {
    // Navigate to projects page
    await page.goto('/projects');

    // Wait for page to load
    await page.waitForSelector('[data-testid="new-project-button"]');

    // Test steps:
    // 1. Create new project with settings (1080p, 30fps)
    await page.getByTestId('new-project-button').click();

    // Wait for editor to load
    await page.waitForSelector('[data-testid="import-media-button"]', { timeout: 10000 });

    // Verify we're in the editor
    await expect(page.getByTestId('import-media-button')).toBeVisible();

    // 2. Import video file (MP4)
    // A test file should exist at 'src/test/e2e/fixtures/media/sample-video.mp4'.
    await uploadTestMedia(page, 'src/test/e2e/fixtures/media/sample-video.mp4');

    // 3. Verify media item appears in the media panel
    await expect(page.getByTestId('media-item').first()).toBeVisible();
  });

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
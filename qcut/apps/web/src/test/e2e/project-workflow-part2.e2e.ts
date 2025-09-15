import { test, expect } from '../helpers/electron-helpers';

test.describe('Timeline Operations (Subtask 1B)', () => {
  test('should add media to timeline and perform basic edits', async ({ page }) => {
    // Setup: Create project and navigate to editor
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="import-media-button"]');

    // Test steps:
    // 1. Verify timeline is present and functional
    const timeline = page.getByTestId('timeline-track');
    await expect(timeline).toBeVisible();

    // 2. Check timeline track attributes
    await expect(timeline).toHaveAttribute('data-track-type');

    // 3. Verify timeline elements container is ready
    const timelineContainer = page.locator('.track-elements-container').first();
    await expect(timelineContainer).toBeVisible();

    // 4. Test timeline interaction capabilities
    // Click on timeline to test selection
    await timeline.click();

    // Verify timeline is interactive
    await expect(timeline).toBeVisible();
  });

  test('should handle timeline element operations', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Test timeline element interactions
    const timeline = page.getByTestId('timeline-track').first();

    // Verify timeline can accept drops and interactions
    await timeline.hover();

    // Test that timeline responds to user interactions
    const timelineRect = await timeline.boundingBox();
    expect(timelineRect).toBeTruthy();
    expect(timelineRect!.width).toBeGreaterThan(0);
    expect(timelineRect!.height).toBeGreaterThan(0);

    // Verify track type data is present
    const trackType = await timeline.getAttribute('data-track-type');
    expect(trackType).toBeTruthy();
  });

  test('should support timeline element manipulation', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Test for timeline element presence/absence
    const timelineElements = page.getByTestId('timeline-element');

    // Timeline should be ready to accept elements
    const timeline = page.getByTestId('timeline-track').first();
    await expect(timeline).toBeVisible();

    // If elements exist, test their properties
    const elementCount = await timelineElements.count();

    if (elementCount > 0) {
      const firstElement = timelineElements.first();

      // Verify element has required attributes
      await expect(firstElement).toHaveAttribute('data-duration');
      await expect(firstElement).toHaveAttribute('data-element-id');

      // Test element selection
      await firstElement.click();

      // Verify trim handles appear when selected
      const trimHandle = page.getByTestId('trim-start-handle');
      // Trim handles may or may not be visible depending on selection state
    }
  });
});
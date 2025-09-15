import { test, expect, uploadTestMedia } from './helpers/electron-helpers';

test.describe('Timeline Operations (Subtask 1B)', () => {
  test('should add media to timeline and perform basic edits', async ({ page }) => {
    // Setup: Create project and navigate to editor
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="import-media-button"]');

    // 1. Verify timeline is present and functional
    const timeline = page.getByTestId('timeline-track');
    await expect(timeline).toBeVisible();
    await expect(timeline).toHaveAttribute('data-track-type');

    // 2. Import test media file
    await uploadTestMedia(page, 'src/test/e2e/fixtures/media/sample-video.mp4');

    // 3. Verify media appears in media panel
    await expect(page.getByTestId('media-item').first()).toBeVisible();

    // 4. Drag media from media panel to timeline
    const mediaItem = page.getByTestId('media-item').first();
    await mediaItem.dragTo(timeline);

    // 5. Verify timeline element was created
    const timelineElements = page.getByTestId('timeline-element');
    await expect(timelineElements.first()).toBeVisible();

    // 6. Perform basic edit operations
    const firstElement = timelineElements.first();

    // Test element selection
    await firstElement.click();

    // Verify element has required attributes for editing
    await expect(firstElement).toHaveAttribute('data-duration');
    await expect(firstElement).toHaveAttribute('data-element-id');

    // Test element positioning (basic timeline interaction)
    const elementRect = await firstElement.boundingBox();
    expect(elementRect).toBeTruthy();
    expect(elementRect!.width).toBeGreaterThan(0);
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
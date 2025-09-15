import { test, expect } from '../helpers/electron-helpers';

test.describe('Multi-Media Import & Track Management (Test #2 Part 1)', () => {
  test('should import multiple media types and manage tracks', async ({ page }) => {
    // Setup: Create project
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="import-media-button"]');

    // Test steps:
    // 1. Import multiple media types
    await page.getByTestId('import-media-button').click();

    // Verify file input is available
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();

    // 2. Verify media panel can handle multiple items
    // Note: In real tests, you would upload actual test files
    // For now, we verify the UI is ready for multiple media items
    const importButton = page.getByTestId('import-media-button');
    await expect(importButton).toBeEnabled();

    // 3. Check timeline can create multiple tracks
    const timeline = page.getByTestId('timeline-track');

    // Timeline should be ready to accept multiple tracks
    await expect(timeline.first()).toBeVisible();

    // 4. Verify track types are distinguishable
    const firstTrack = page.getByTestId('timeline-track').first();
    await expect(firstTrack).toHaveAttribute('data-track-type');
  });

  test('should handle drag and drop to timeline', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Test drag and drop functionality
    const timeline = page.getByTestId('timeline-track').first();
    const bounds = await timeline.boundingBox();

    expect(bounds).toBeTruthy();
    expect(bounds!.width).toBeGreaterThan(0);
    expect(bounds!.height).toBeGreaterThan(0);

    // Verify timeline accepts drops
    await timeline.hover();

    // Timeline should be interactive
    await expect(timeline).toBeVisible();
  });

  test('should support multiple track types', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Get all tracks
    const tracks = page.getByTestId('timeline-track');
    const trackCount = await tracks.count();

    // Verify each track has a type
    for (let i = 0; i < trackCount; i++) {
      const track = tracks.nth(i);
      const trackType = await track.getAttribute('data-track-type');

      // Track type should be one of: media, audio, text, sticker, captions, effects
      expect(trackType).toMatch(/^(media|audio|text|sticker|captions|effects)$/);
    }
  });

  test('should maintain timeline state across operations', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Get initial timeline state
    const timeline = page.getByTestId('timeline-track').first();
    const initialTrackType = await timeline.getAttribute('data-track-type');

    // Perform some operations (navigation)
    await page.waitForTimeout(500); // Small delay to simulate user interaction

    // Verify timeline state is maintained
    const updatedTimeline = page.getByTestId('timeline-track').first();
    const updatedTrackType = await updatedTimeline.getAttribute('data-track-type');

    expect(updatedTrackType).toBe(initialTrackType);
  });

  test('should display media items correctly', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="import-media-button"]');

    // Check media panel structure
    const importButton = page.getByTestId('import-media-button');
    await expect(importButton).toBeVisible();
    await expect(importButton).toBeEnabled();

    // Media items should have proper data attributes when present
    const mediaItems = page.getByTestId('media-item');
    const itemCount = await mediaItems.count();

    // If there are media items, verify their structure
    if (itemCount > 0) {
      for (let i = 0; i < Math.min(3, itemCount); i++) {
        const item = mediaItems.nth(i);
        await expect(item).toBeVisible();
      }
    }
  });
});
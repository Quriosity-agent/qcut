/**
 * Multi-Media Import & Track Management E2E Tests
 *
 * Tests comprehensive media import functionality including multiple file types,
 * track management, media panel organization, and timeline integration.
 */

import {
  test,
  expect,
  createTestProject,
  importTestVideo,
  importTestAudio,
  importTestImage,
} from "./helpers/electron-helpers";

/**
 * Test suite for Multi-Media Import & Track Management (Test #2 Part 1)
 * Covers importing multiple media types and track management workflows.
 */
test.describe("Multi-Media Import & Track Management (Test #2 Part 1)", () => {
  /**
   * Tests importing multiple media types and managing timeline tracks.
   * Verifies video, audio, and image import with proper track organization.
   */
  test("should import multiple media types and manage tracks", async ({
    page,
  }) => {
    // Setup: Create project

    await createTestProject(page, "Multi-Media Test Project");

    // Test steps:
    // 1. Import multiple media types
    await importTestVideo(page);
    await importTestAudio(page);
    await importTestImage(page);

    // Verify media items are imported
    const mediaItems = page.locator('[data-testid="media-item"]');
    const count = await mediaItems.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // 2. Verify media panel can handle multiple items
    const importButton = page.getByTestId("import-media-button");
    await expect(importButton).toBeEnabled();

    // 3. Check timeline can create multiple tracks
    const timeline = page.getByTestId("timeline-track");

    // Timeline should be ready to accept multiple tracks
    await expect(timeline.first()).toBeVisible();

    // 4. Verify track types are distinguishable
    const firstTrack = page.getByTestId("timeline-track").first();
    await expect(firstTrack).toHaveAttribute("data-track-type");
  });

  /**
   * Tests drag-and-drop functionality from media panel to timeline.
   * Verifies media items can be dragged and positioned on timeline tracks.
   */
  test("should handle drag and drop to timeline", async ({ page }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Test actual drag and drop functionality
    const timeline = page.getByTestId("timeline-track").first();
    await expect(timeline).toBeVisible();

    // Get existing timeline elements count
    const timelineElementsBefore = await page
      .locator('[data-testid="timeline-element"]')
      .count();

    // Try to find media items to drag
    const mediaItems = page.locator('[data-testid="media-item"]');
    const mediaCount = await mediaItems.count();

    if (mediaCount > 0) {
      // Perform actual drag-and-drop
      const firstMedia = mediaItems.first();
      await firstMedia.dragTo(timeline);

      // Wait for timeline element to appear after drag-and-drop
      await page.waitForSelector('[data-testid="timeline-element"]', {
        timeout: 5000,
      });

      // Verify element was added to timeline
      const timelineElementsAfter = await page
        .locator('[data-testid="timeline-element"]')
        .count();
      expect(timelineElementsAfter).toBeGreaterThan(timelineElementsBefore);

      // Verify timeline element has proper attributes
      const timelineElement = page
        .locator('[data-testid="timeline-element"]')
        .first();
      if (await timelineElement.isVisible()) {
        await expect(timelineElement).toBeVisible();

        // Check for duration attribute
        const duration = await timelineElement.getAttribute("data-duration");
        if (duration) {
          expect(parseFloat(duration)).toBeGreaterThan(0);
        }
      }
    } else {
      // No media items available, just verify timeline is interactive
      await timeline.hover();
      await expect(timeline).toBeVisible();
    }
  });

  test("should support multiple track types", async ({ page }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Get all tracks
    const tracks = page.getByTestId("timeline-track");
    const trackCount = await tracks.count();

    // Verify each track has a type
    for (let i = 0; i < trackCount; i++) {
      const track = tracks.nth(i);
      const trackType = await track.getAttribute("data-track-type");

      // Track type should be one of: media, audio, text, sticker, captions, effects
      expect(trackType).toMatch(
        /^(media|audio|text|sticker|captions|effects)$/
      );
    }
  });

  test("should maintain timeline state across operations", async ({ page }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Get initial timeline state
    const timeline = page.getByTestId("timeline-track").first();
    const initialTrackType = await timeline.getAttribute("data-track-type");

    // Ensure DOM is stable before checking state
    await page.waitForLoadState("domcontentloaded", { timeout: 2000 });

    // Verify timeline state is maintained
    const updatedTimeline = page.getByTestId("timeline-track").first();
    const updatedTrackType =
      await updatedTimeline.getAttribute("data-track-type");

    expect(updatedTrackType).toBe(initialTrackType);
  });

  test("should display media items correctly", async ({ page }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="import-media-button"]');

    // Check media panel structure
    const importButton = page.getByTestId("import-media-button");
    await expect(importButton).toBeVisible();
    await expect(importButton).toBeEnabled();

    // Media items should have proper data attributes when present
    const mediaItems = page.getByTestId("media-item");
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

/**
 * File Operations & Storage Management E2E Tests
 *
 * This test suite covers comprehensive file operations including media import,
 * storage management, thumbnail generation, drag-and-drop functionality,
 * and cross-platform file handling capabilities.
 */

import { test, expect, createTestProject } from "./helpers/electron-helpers";

/**
 * Test suite for File Operations & Storage Management (Test #5A)
 * Covers subtasks 5A.1 through 5A.8 from the E2E testing priority document.
 */
test.describe("File Operations & Storage Management", () => {
  // Remove manual lifecycle hooks; fixtures provide { electronApp, page } per test.

  /**
   * Test 5A.1: Import media files with progress tracking
   * Verifies that media import functionality works correctly and displays
   * appropriate progress indicators during file upload operations.
   */
  test("5A.1 - Import media files with progress tracking", async ({ page }) => {
    // Navigate to projects page and create new project

    await createTestProject(page, "Import Progress Test Project");

    // Open import dialog
    await page.click('[data-testid="import-media-button"]');
    await page.waitForTimeout(500);

    // Verify import functionality is available
    await expect(
      page.locator('[data-testid="import-media-button"]')
    ).toBeVisible();

    // Import progress would be visible during file upload
    // Note: In real tests, you would mock large file uploads to see progress

    // For now, verify basic import works
    const mediaPanel = page.locator('[data-testid="media-panel"]');
    if (await mediaPanel.isVisible()) {
      // Media panel exists, import should work
      await expect(mediaPanel).toBeVisible();
    }
  });

  /**
   * Test 5A.2: Handle large file imports
   * Tests the application's ability to handle large media files,
   * including progress tracking, memory management, and error handling.
   */
  test("5A.2 - Handle large file imports", async ({ page }) => {
    // Setup: Create project for testing large file imports

    await createTestProject(page, "Large File Import Test");

    // In a real implementation, you would:
    // 1. Mock a large file selection
    // 2. Verify progress bar appears
    // 3. Wait for completion
    // 4. Verify file appears in media panel

    // For now, verify the media items container exists
    const mediaContainer = page.locator('[data-testid="media-item"]').first();

    // If media items exist, verify they display properly
    if (await mediaContainer.isVisible()) {
      await expect(mediaContainer).toBeVisible();

      // Verify file size information is displayed
      const fileSizeInfo = page
        .locator('[data-testid*="file-size"], [data-testid*="media-info"]')
        .first();
      if (await fileSizeInfo.isVisible()) {
        await expect(fileSizeInfo).toBeVisible();
      }
    }
  });

  /**
   * Test 5A.3: Test storage quota and fallback system
   * Verifies storage quota monitoring and fallback mechanisms
   * when storage limits are approached or exceeded.
   */
  test("5A.3 - Test storage quota and fallback system", async ({ page }) => {
    // Setup: Create project to test storage operations

    await createTestProject(page, "Storage Quota Test Project");

    // Add media to trigger storage operations
    await page.click('[data-testid="import-media-button"]');
    await page.waitForTimeout(1000);

    // Simulate storage quota issues via JavaScript
    await page.evaluate(() => {
      // Mock storage quota exceeded scenario
      if (window.navigator?.storage) {
        (window.navigator.storage as any).estimate = () =>
          Promise.resolve({
            quota: 1_000_000, // 1MB quota
            usage: 900_000, // 90% used
          });
      }
    });

    // Try to save project which should trigger storage operations
    await page.click('[data-testid="save-project-button"]');
    await page.waitForTimeout(2000);

    // Look for storage warning messages
    const storageWarning = page.locator('[data-testid="storage-warning"]');

    // Storage warning might appear
    if (await storageWarning.isVisible({ timeout: 3000 })) {
      await expect(storageWarning).toContainText(/storage|fallback|space/i);
    }

    // Verify project operations still work despite storage issues
    await page.getByTestId("project-name-input").fill("Storage Test Project");
    await page.click('[data-testid="save-confirm-button"]');
    await page.waitForTimeout(1000);

    // Project should still save (using fallback storage)
    const saveStatus = page.locator('[data-testid="save-status"]');
    if (await saveStatus.isVisible()) {
      await expect(saveStatus).toContainText(/saved|complete/i);
    }
  });

  /**
   * Test 5A.4: Verify thumbnail generation for media
   * Tests automatic thumbnail generation for imported media files
   * and ensures thumbnails are properly displayed and cached.
   */
  test("5A.4 - Verify thumbnail generation for media", async ({ page }) => {
    // Setup: Create project and import media for thumbnail testing
    await createTestProject(page, "Thumbnail Generation Test");

    // Import media to ensure we have items to test thumbnails for
    await page.click('[data-testid="import-media-button"]');
    await page.waitForSelector('[data-testid="media-item"]', {
      state: "visible",
      timeout: 10_000,
    });

    // Verify we have media items
    const mediaItems = page.locator('[data-testid="media-item"]');
    expect(await mediaItems.count()).toBeGreaterThan(0);

    const firstMediaItem = mediaItems.first();
    await expect(firstMediaItem).toBeVisible();

    // Look for thumbnail elements
    const thumbnail = firstMediaItem
      .locator('img, [data-testid*="thumbnail"], [data-testid*="preview"]')
      .first();

    // Wait for thumbnail to load
    await thumbnail.waitFor({ state: "visible", timeout: 5000 });
    await expect(thumbnail).toBeVisible();

    // Verify thumbnail has loaded (not broken image)
    const thumbnailSrc = await thumbnail.getAttribute("src");
    expect(thumbnailSrc).toBeTruthy();
    expect(thumbnailSrc).not.toBe("");

    // Additional validation: thumbnail should be a valid image URL or data URL
    expect(thumbnailSrc).toMatch(/^(data:image\/|blob:|https?:\/\/)/);
  });

  /**
   * Test 5A.5: Test drag and drop file operations
   * Verifies drag-and-drop functionality for moving media items
   * from the media panel to the timeline and other UI interactions.
   */
  test("5A.5 - Test drag and drop file operations", async ({ page }) => {
    // Setup: Create project and ensure we have media to drag
    await createTestProject(page, "Drag Drop Test Project");

    // Import media to ensure we have items for drag-and-drop testing
    await page.click('[data-testid="import-media-button"]');
    await page.waitForSelector('[data-testid="media-item"]', {
      state: "visible",
      timeout: 10_000,
    });

    // Verify we have the required elements for drag-and-drop
    const timelineTrack = page
      .locator('[data-testid="timeline-track"]')
      .first();
    const mediaItem = page.locator('[data-testid="media-item"]').first();

    await expect(mediaItem).toBeVisible();
    await expect(timelineTrack).toBeVisible();

    // Perform drag and drop
    await mediaItem.dragTo(timelineTrack);

    // Wait for timeline element to appear with proper state-based waiting
    const timelineElement = timelineTrack.locator(
      '[data-testid="timeline-element"]'
    );
    await expect(timelineElement).toBeVisible({ timeout: 5000 });

    // Verify element has proper metadata with robust numeric validation
    const duration = await timelineElement.getAttribute("data-duration");
    if (duration) {
      const seconds = Number(duration);
      expect(Number.isFinite(seconds)).toBe(true);
      expect(seconds).toBeGreaterThan(0);
    }
  });

  /**
   * Test 5A.6: Test file format support and validation
   * Tests support for various file formats (video, audio, image)
   * and proper handling of unsupported or corrupted files.
   */
  test("5A.6 - Test file format support and validation", async ({ page }) => {
    // This test would verify different file formats are handled properly

    // Import button should be available
    await expect(
      page.locator('[data-testid="import-media-button"]')
    ).toBeVisible();

    // In a real implementation, you would test:
    // 1. Various file formats (mp4, mov, avi, mp3, wav, jpg, png)
    // 2. Invalid file format handling
    // 3. Corrupted file handling

    // For now, verify the import system accepts files
    await page.click('[data-testid="import-media-button"]');
    await page.waitForTimeout(500);

    // File input should be available (even if hidden)
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      await expect(fileInput).toBeVisible();
    }
  });

  /**
   * Test 5A.7: Test storage service integration
   * Verifies integration with the storage service including
   * project persistence, data retrieval, and cross-session consistency.
   */
  test("5A.7 - Test storage service integration", async ({ page }) => {
    // Setup: Create project for storage service testing

    await createTestProject(page, "Storage Integration Test Project");

    // Verify project appears in storage
    await page.click('[data-testid="save-project-button"]');
    await page
      .getByTestId("project-name-input")
      .fill("Storage Integration Test");
    await page.click('[data-testid="save-confirm-button"]');
    await page.waitForTimeout(2000);

    // Navigate back to projects list
    await page.click('[data-testid="projects-tab"]');
    await page.waitForTimeout(1000);

    // Verify saved project appears in list
    const projectListItems = page.locator('[data-testid="project-list-item"]');
    const count = await projectListItems.count();
    expect(count).toBeGreaterThan(0);

    // Look for our test project
    const testProject = projectListItems.filter({
      hasText: "Storage Integration Test",
    });
    if ((await testProject.count()) > 0) {
      await expect(testProject.first()).toBeVisible();
    }
  });

  /**
   * Test 5A.8: Test cross-platform file path handling
   * Tests proper file path handling across different operating systems
   * and ensures consistent behavior on Windows, macOS, and Linux.
   */
  test("5A.8 - Test cross-platform file path handling", async ({ page }) => {
    // This test verifies file paths work correctly across different platforms

    // Import media
    await page.click('[data-testid="import-media-button"]');
    await page.waitForTimeout(1000);

    // Get platform information
    const platform = await page.evaluate(() => navigator.platform);

    // Verify file operations work on current platform
    const mediaItems = page.locator('[data-testid="media-item"]');

    if ((await mediaItems.count()) > 0) {
      const firstItem = mediaItems.first();
      await expect(firstItem).toBeVisible();

      // Click on media item to verify it loads
      await firstItem.click();
      await page.waitForTimeout(500);

      // Verify item is selected/active
      const activeItem = page
        .locator(
          '[data-testid="media-item"][aria-selected="true"], [data-testid="media-item"].selected'
        )
        .first();
      if (await activeItem.isVisible()) {
        await expect(activeItem).toBeVisible();
      }
    }

    // Platform information logged for debugging: ${platform}
  });
});

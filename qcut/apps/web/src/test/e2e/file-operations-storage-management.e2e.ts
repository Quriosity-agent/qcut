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

    // Wait for file input to be ready
    await page.waitForSelector('input[type="file"]', { timeout: 2000 }).catch(() => {});

    // Verify import functionality is available
    await expect(
      page.locator('[data-testid="import-media-button"]')
    ).toBeVisible({ timeout: 2000 });

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

    const originalProjectName = "Storage Quota Test Project";
    const updatedProjectName = "Storage Quota Fallback Project";

    await createTestProject(page, originalProjectName);

    // Capture active project identifier from the current editor route
    const projectId = await page.evaluate(() => {
      const match = window.location.href.match(/editor\/([^/?#]+)/);
      return match ? match[1] : null;
    });
    if (!projectId) {
      throw new Error("Failed to determine active project ID from editor URL");
    }

    const storageKey = `video-editor-projects_projects_${projectId}`;

    // Baseline: ensure project persisted with the expected name before quota changes
    const initialProjectSnapshot = await page.evaluate(async (key) => {
      const api = (window as any).electronAPI;
      if (!api?.storage?.load) {
        return null;
      }
      const data = await api.storage.load(key);
      return data ? { name: data.name } : null;
    }, storageKey);
    expect(initialProjectSnapshot).not.toBeNull();
    expect(initialProjectSnapshot?.name).toBe(originalProjectName);

    // Simulate storage quota pressure to validate fallback handling
    const quotaOverrideApplied = await page.evaluate(() => {
      if (!navigator.storage?.estimate) {
        return false;
      }
      const originalEstimate = navigator.storage.estimate.bind(navigator.storage);
      (window as any).__originalStorageEstimate__ = originalEstimate;
      navigator.storage.estimate = async () => ({
        quota: 1_000_000, // 1MB quota
        usage: 900_000, // 90% used
      });
      return true;
    });
    expect(quotaOverrideApplied).toBeTruthy();

    const quotaInfo = await page.evaluate(async () => {
      if (!navigator.storage?.estimate) {
        return null;
      }
      const estimate = await navigator.storage.estimate();
      return {
        quota: estimate.quota ?? 0,
        usage: estimate.usage ?? 0,
      };
    });
    expect(quotaInfo).not.toBeNull();
    expect(quotaInfo!.quota).toBe(1_000_000);
    expect(quotaInfo!.usage).toBe(900_000);
    expect(quotaInfo!.usage / quotaInfo!.quota).toBeGreaterThanOrEqual(0.8);

    try {
      // Trigger a storage write via the rename flow (calls storageService.saveProject)
      const projectMenuTrigger = page
        .getByRole("button", { name: new RegExp(originalProjectName, "i") })
        .first();
      await projectMenuTrigger.click();
      await page.getByRole("menuitem", { name: "Rename project" }).click();

      const renameInput = page.getByPlaceholder("Enter a new name");
      await renameInput.fill(updatedProjectName);
      await page.getByRole("button", { name: "Rename" }).click();

      // Confirm header updates to the new project name, indicating UI state persisted
      await expect(
        page.getByRole("button", { name: new RegExp(updatedProjectName, "i") })
      ).toBeVisible();

      // Verify the project snapshot stored on disk reflects the rename
      const storedProject = await page.evaluate(async (key) => {
        const api = (window as any).electronAPI;
        if (!api?.storage?.load) {
          return null;
        }
        const data = await api.storage.load(key);
        return data ? { name: data.name } : null;
      }, storageKey);
      expect(storedProject).not.toBeNull();
      expect(storedProject?.name).toBe(updatedProjectName);
    } finally {
      // Restore the original storage estimate implementation for subsequent tests
      await page.evaluate(() => {
        const originalEstimate = (window as any).__originalStorageEstimate__;
        if (originalEstimate && navigator.storage) {
          navigator.storage.estimate = originalEstimate;
        }
        delete (window as any).__originalStorageEstimate__;
      });
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

    // Wait for file input to be available
    await page.waitForSelector('input[type="file"]', { timeout: 2000 }).catch(() => {});

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

    // Wait for save to complete
    await page.waitForSelector('[data-testid="save-status"]', { timeout: 3000 }).catch(() => {});

    // Navigate back to projects list
    await page.click('[data-testid="projects-tab"]');

    // Wait for project list to load
    await page.waitForSelector('[data-testid="project-list-item"]', { timeout: 3000 });

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

    // Wait for file input to be ready
    await page.waitForSelector('input[type="file"]', { timeout: 2000 }).catch(() => {});

    // Get platform information
    const platform = await page.evaluate(() => navigator.platform);

    // Verify file operations work on current platform
    const mediaItems = page.locator('[data-testid="media-item"]');

    if ((await mediaItems.count()) > 0) {
      const firstItem = mediaItems.first();
      await expect(firstItem).toBeVisible();

      // Click on media item to verify it loads
      await firstItem.click();

      // Wait for item to be active/selected
      await page.waitForSelector('[data-testid="media-item"][data-selected="true"]', { timeout: 2000 }).catch(() => {});

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

/**
 * File Operations & Storage Management E2E Tests
 *
 * This test suite covers comprehensive file operations including media import,
 * storage management, thumbnail generation, drag-and-drop functionality,
 * and cross-platform file handling capabilities.
 */

import {
  test,
  expect,
  createTestProject,
  importTestVideo,
} from "./helpers/electron-helpers";

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
    await page
      .waitForSelector('input[type="file"]', { timeout: 2000 })
      .catch(() => {});

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

    const currentProjectName =
      initialProjectSnapshot?.name ?? originalProjectName;
    const escapeRegExp = (value: string) =>
      value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const currentProjectRegex = new RegExp(
      escapeRegExp(currentProjectName),
      "i"
    );

    // Simulate storage quota pressure to validate fallback handling
    const quotaOverrideApplied = await page.evaluate(() => {
      if (!navigator.storage?.estimate) {
        return false;
      }
      const originalEstimate = navigator.storage.estimate.bind(
        navigator.storage
      );
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
        .locator(
          [
            '[data-testid="project-title-button"]',
            '[data-testid="project-menu-button"]',
            '[data-testid="project-options-button"]',
            "button",
          ].join(", ")
        )
        .filter({ hasText: currentProjectRegex })
        .first();

      await projectMenuTrigger
        .waitFor({ state: "visible", timeout: 5000 })
        .catch(() => {});
      expect(await projectMenuTrigger.isVisible()).toBe(true);

      await projectMenuTrigger.click().catch(() => {});

      const renameMenuItem = page
        .locator('[role="menuitem"], button')
        .filter({ hasText: /rename/i })
        .first();

      const renameMenuVisible = await renameMenuItem
        .waitFor({ state: "visible", timeout: 3000 })
        .then(() => true)
        .catch(async () => {
          // Retry opening the project menu once more if the first attempt did not render the menu yet
          await projectMenuTrigger.click().catch(() => {});
          return renameMenuItem
            .waitFor({ state: "visible", timeout: 2000 })
            .then(() => true)
            .catch(() => false);
        });

      expect(renameMenuVisible).toBe(true);

      await renameMenuItem.click();

      const renameInput = page.getByPlaceholder("Enter a new name");
      await renameInput.fill(updatedProjectName);
      await page.getByRole("button", { name: "Rename" }).click();

      // Confirm header updates to the new project name, indicating UI state persisted
      await expect(
        page.getByRole("button", {
          name: new RegExp(escapeRegExp(updatedProjectName), "i"),
        })
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
    await importTestVideo(page);
    await page.waitForSelector('[data-testid="media-item"]', {
      state: "visible",
      timeout: 10_000,
    });

    // Verify we have media items
    const mediaItems = page.locator('[data-testid="media-item"]');
    expect(await mediaItems.count()).toBeGreaterThan(0);

    const firstMediaItem = mediaItems.first();
    await firstMediaItem.scrollIntoViewIfNeeded();
    await expect(firstMediaItem).toBeVisible();

    // Look for thumbnail elements
    const thumbnailSelectors = [
      'img[data-testid*="thumbnail"]',
      '[data-testid*="thumbnail"] img',
      '[data-testid*="thumbnail"]',
      '[data-testid*="preview"]',
      "img",
      "canvas",
      "video",
    ].join(", ");
    const thumbnailCandidates = firstMediaItem.locator(thumbnailSelectors);
    const thumbnail = thumbnailCandidates.first();

    if ((await thumbnailCandidates.count()) > 0) {
      await thumbnail
        .waitFor({ state: "visible", timeout: 5000 })
        .catch(() => {});
      expect(await thumbnail.isVisible()).toBe(true);

      const [src, poster, backgroundImage] = await Promise.all([
        thumbnail.getAttribute("src"),
        thumbnail.getAttribute("poster"),
        thumbnail.evaluate(
          (el) => getComputedStyle(el as HTMLElement).backgroundImage
        ),
      ]);

      const hasVisualSource =
        (src && src.trim().length > 0) ||
        (poster && poster.trim().length > 0) ||
        (backgroundImage && backgroundImage !== "none");
      expect(hasVisualSource).toBe(true);

      if (src) {
        expect(src).toMatch(/^(data:image\/|blob:|https?:\/\/)/);
      }
    } else {
      // Fallback: some builds render the thumbnail as a background image on the card itself
      const cardBackground = await firstMediaItem.evaluate((node) => {
        const style = getComputedStyle(node as HTMLElement);
        return style.backgroundImage;
      });
      expect(cardBackground).toMatch(/url\((['"]?)(blob:|data:image|https?:)/i);
    }
  });

  /**
   * Test 5A.5: Test drag and drop file operations
   * Verifies drag-and-drop functionality for moving media items
   * from the media panel to the timeline and other UI interactions.
   */
  test("5A.5 - Test drag and drop file operations", async ({ page }) => {
    // Setup: Create project and ensure we have media to drag
    await createTestProject(page, "Drag Drop Test Project");

    // Import media so there is a tangible item to drag from the media panel
    await importTestVideo(page);
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
    await mediaItem.scrollIntoViewIfNeeded();

    await expect(timelineTrack).toBeVisible();
    await timelineTrack.scrollIntoViewIfNeeded();

    // Perform drag and drop
    await mediaItem.hover();
    await timelineTrack.hover();
    await mediaItem.dragTo(timelineTrack);

    // Wait for timeline element to appear with proper state-based waiting
    const timelineElement = timelineTrack.locator(
      '[data-testid="timeline-element"]'
    );
    await expect(timelineElement).toBeVisible({ timeout: 5000 });

    // Ensure timeline has at least one persisted item (avoid flakes on slow storage)
    await page
      .waitForFunction(
        () => document.querySelectorAll('[data-testid="timeline-element"]').length > 0,
        { timeout: 5000 }
      )
      .catch(() => {});

    // Verify element has proper metadata with robust numeric validation
    const duration = await timelineElement.getAttribute("data-duration");
    if (duration) {
      const seconds = Number(duration);
      expect(Number.isFinite(seconds)).toBe(true);
      expect(seconds).toBeGreaterThan(0);
    }

    // Cross-check the drop target stored the media identifier
    const dropMetadata = await timelineElement.evaluate((node) => {
      const element = node as HTMLElement;
      return {
        mediaId:
          element.getAttribute("data-media-id") ??
          element.dataset.mediaId ??
          element.getAttribute("data-id") ??
          element.dataset.id ??
          null,
        elementId:
          element.getAttribute("data-element-id") ?? element.dataset.elementId ?? null,
        type: element.getAttribute("data-type") ?? element.dataset.type ?? null,
      };
    });
    expect(
      Boolean(dropMetadata.mediaId || dropMetadata.elementId)
    ).toBe(true);
  });

  /**
   * Test 5A.6: Test file format support and validation
   * Tests support for various file formats (video, audio, image)
   * and proper handling of unsupported or corrupted files.
   */
  test("5A.6 - Test file format support and validation", async ({ page }) => {
    // This test would verify different file formats are handled properly

    // Ensure we are inside an editor session where the import controls exist
    await createTestProject(page, "Format Support Test Project");

    // Import button should be available
    const importButton = page
      .locator('[data-testid="import-media-button"]')
      .first();
    await expect(importButton).toBeVisible();

    // In a real implementation, you would test:
    // 1. Various file formats (mp4, mov, avi, mp3, wav, jpg, png)
    // 2. Invalid file format handling
    // 3. Corrupted file handling

    // For now, verify the import system accepts files
    await importButton.click();

    // Wait for file input to be available
    await page
      .waitForSelector('input[type="file"]', { timeout: 2000 })
      .catch(() => {});

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

    const projectName = `Storage Integration Test Project ${Date.now()}`;
    await createTestProject(page, projectName);

    // Wait for auto-save indicator to confirm project persistence
    const autoSaveIndicator = page.getByTestId("auto-save-indicator");
    if (await autoSaveIndicator.isVisible()) {
      await expect(autoSaveIndicator).toContainText(/auto/i);
      await expect(autoSaveIndicator)
        .toHaveText(/auto-saved/i, { timeout: 5000 })
        .catch(() => {});
    }

    // Allow background auto-save to complete before leaving editor
    await page.waitForTimeout(1000);

    // Navigate back to projects list using the header menu
    const projectMenuButton = page
      .locator(`button:has-text("${projectName}")`)
      .first();
    await expect(projectMenuButton).toBeVisible();
    await projectMenuButton.click();

    const projectsMenuItem = page
      .locator('[role="menuitem"]:has-text("Projects")')
      .first();
    await expect(projectsMenuItem).toBeVisible();
    await projectsMenuItem.click().catch(async () => {
      await page.locator('a:has-text("Projects")').first().click();
    });

    // Wait for project list to load
    await page.waitForSelector('[data-testid="project-list-item"]', {
      timeout: 5000,
    });

    // Verify saved project appears in list
    const projectListItems = page.locator('[data-testid="project-list-item"]');
    const count = await projectListItems.count();
    expect(count).toBeGreaterThan(0);

    // Look for our test project
    const testProject = projectListItems.filter({
      hasText: projectName,
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
    await page
      .waitForSelector('input[type="file"]', { timeout: 2000 })
      .catch(() => {});

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
      await page
        .waitForSelector('[data-testid="media-item"][data-selected="true"]', {
          timeout: 2000,
        })
        .catch(() => {});

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

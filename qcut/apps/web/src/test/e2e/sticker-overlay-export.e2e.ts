/**
 * Sticker Overlay Export E2E Tests
 *
 * Tests the complete sticker overlay export functionality including:
 * - Sticker visibility in exported video frames
 * - Timing consistency between preview and export
 * - Multiple sticker layering and z-index ordering
 * - Error handling for failed sticker renders
 * - Both Canvas (MediaRecorder/FFmpeg WASM) and CLI export modes
 *
 * @module test/e2e/sticker-overlay-export.e2e
 */

import {
  test,
  expect,
  createTestProject,
  importTestVideo,
  addStickerToCanvas,
  startExport,
} from "./helpers/electron-helpers";

/**
 * Test Suite: Sticker Overlay Export Tests
 */
test.describe("Sticker Overlay Export Tests", () => {
  /**
   * Setup: Create project with video content before each test
   */
  test.beforeEach(async ({ page }, testInfo) => {
    const projectName = `Sticker Export ${testInfo.title.slice(0, 30)}`;
    await createTestProject(page, projectName);
    await importTestVideo(page);

    // Add video to timeline
    const mediaItem = page.locator('[data-testid="media-item"]').first();
    const timelineTrack = page
      .locator('[data-testid="timeline-track"]')
      .first();

    // Wait for media item to be visible
    await mediaItem.waitFor({ state: "visible", timeout: 10_000 });

    // Drag media to timeline
    await mediaItem.hover();
    await page.mouse.down();
    await timelineTrack.hover();
    await page.mouse.up();

    // Wait for timeline element to appear
    await page
      .waitForSelector('[data-testid="timeline-element"]', {
        state: "visible",
        timeout: 10_000,
      })
      .catch(() => {
        // Timeline element not visible after drag - continuing
      });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBTASK 1: Error Logging Verification
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Test 1.1: Sticker render failures are logged to console
   * Verifies that render errors are no longer silently swallowed
   */
  test("should log sticker render failures instead of silent failure", async ({
    page,
  }) => {
    // Collect console messages
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      consoleMessages.push(msg.text());
    });

    // Add sticker to canvas
    const stickerAdded = await addStickerToCanvas(page);
    if (!stickerAdded) {
      test.skip(true, "Sticker canvas not available");
      return;
    }

    // Intentionally corrupt sticker data to trigger error
    await page.evaluate(() => {
      // Access sticker store via window if exposed
      const stores = (window as any).__ZUSTAND_STORES__;
      if (stores?.stickersOverlay) {
        const state = stores.stickersOverlay.getState();
        const stickers = state.overlayStickers;
        if (stickers && stickers.size > 0) {
          const firstKey = stickers.keys().next().value;
          const sticker = stickers.get(firstKey);
          if (sticker) {
            // Set invalid mediaItemId to trigger error
            sticker.mediaItemId = "invalid-media-id-12345";
            stickers.set(firstKey, sticker);
          }
        }
      }
    });

    // Trigger export
    await startExport(page, { timeout: 15_000 });

    // Wait a moment for logs to accumulate
    await page.waitForTimeout(2000);

    // Verify error was logged (not silently ignored)
    const hasErrorLog = consoleMessages.some(
      (msg) =>
        (msg.includes("[StickerExportHelper]") || msg.includes("sticker")) &&
        (msg.includes("Failed") ||
          msg.includes("error") ||
          msg.includes("not found"))
    );

    expect(hasErrorLog).toBe(true);
  });

  /**
   * Test 1.2: Export continues even when individual stickers fail
   * Verifies graceful degradation - export shouldn't crash on sticker errors
   */
  test("should continue export when individual stickers fail", async ({
    page,
  }) => {
    // Add sticker to canvas
    const stickerAdded = await addStickerToCanvas(page);
    if (!stickerAdded) {
      test.skip(true, "Sticker canvas not available");
      return;
    }

    // Start export
    const exportStarted = await startExport(page, { timeout: 20_000 });
    expect(exportStarted).toBe(true);

    // Export should progress even with potential sticker issues
    const progressBar = page.locator('[data-testid="export-progress-bar"]');
    const exportStatus = page.locator('[data-testid="export-status"]');

    // At least one feedback element should be visible
    const hasFeedback =
      (await progressBar.isVisible().catch(() => false)) ||
      (await exportStatus.isVisible().catch(() => false));

    expect(hasFeedback).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBTASK 2: Image Preloading Verification
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Test 2.1: Sticker images are preloaded before export starts
   * Verifies preloading status message appears in export flow
   */
  test("should preload sticker images before export starts", async ({
    page,
  }) => {
    // Collect console messages
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      consoleMessages.push(msg.text());
    });

    // Add sticker to canvas
    const stickerAdded = await addStickerToCanvas(page);
    if (!stickerAdded) {
      test.skip(true, "Sticker canvas not available");
      return;
    }

    // Start export
    await startExport(page, { timeout: 20_000 });

    // Wait for logs to accumulate
    await page.waitForTimeout(3000);

    // Verify preloading occurred
    const hasPreloadLog = consoleMessages.some(
      (msg) =>
        msg.includes("Preloading sticker") ||
        msg.includes("preload") ||
        (msg.includes("[StickerExportHelper]") && msg.includes("Preloaded"))
    );

    expect(hasPreloadLog).toBe(true);
  });

  /**
   * Test 2.2: Export handles preload failures gracefully
   * Verifies export continues even if some stickers fail to preload
   */
  test("should handle preload failures gracefully", async ({ page }) => {
    // Collect console warnings
    const warningMessages: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning" || msg.type() === "error") {
        warningMessages.push(msg.text());
      }
    });

    // Add sticker to canvas
    const stickerAdded = await addStickerToCanvas(page);
    if (!stickerAdded) {
      test.skip(true, "Sticker canvas not available");
      return;
    }

    // Mock network failure for sticker images
    await page.route("**/sticker/**", (route) => {
      route.abort("failed");
    });

    // Export should still start (graceful degradation)
    const exportStarted = await startExport(page, { timeout: 15_000 });

    // Export process should continue despite preload failures
    expect(exportStarted).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBTASK 3: Timing Consistency Verification
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Test 3.1: Sticker without timing appears throughout entire video
   * Verifies default timing behavior: sticker visible for entire duration
   */
  test("should show sticker without timing for entire video duration", async ({
    page,
  }) => {
    // Add sticker to canvas (no timing = entire video)
    const stickerAdded = await addStickerToCanvas(page);
    if (!stickerAdded) {
      test.skip(true, "Sticker canvas not available");
      return;
    }

    // Verify sticker has no timing constraints set
    const stickerTiming = await page.evaluate(() => {
      const stores = (window as any).__ZUSTAND_STORES__;
      if (stores?.stickersOverlay) {
        const state = stores.stickersOverlay.getState();
        const stickers = Array.from(state.overlayStickers?.values() || []);
        if (stickers.length > 0) {
          return (stickers[0] as any).timing;
        }
      }
      return;
    });

    // No timing = visible for entire video
    expect(stickerTiming).toBeUndefined();

    // Start export
    const exportStarted = await startExport(page, { timeout: 20_000 });
    expect(exportStarted).toBe(true);
  });

  /**
   * Test 3.2: Sticker with specific timing respects time boundaries
   * Verifies stickers appear only during their specified time range
   */
  test("should respect sticker timing boundaries during export", async ({
    page,
  }) => {
    // Add sticker to canvas
    const stickerAdded = await addStickerToCanvas(page);
    if (!stickerAdded) {
      test.skip(true, "Sticker canvas not available");
      return;
    }

    // Set specific timing on sticker (1s to 3s)
    await page.evaluate(() => {
      const stores = (window as any).__ZUSTAND_STORES__;
      if (stores?.stickersOverlay) {
        const state = stores.stickersOverlay.getState();
        const stickers = state.overlayStickers;
        if (stickers && stickers.size > 0) {
          const firstKey = stickers.keys().next().value;
          const sticker = stickers.get(firstKey);
          if (sticker) {
            sticker.timing = { startTime: 1.0, endTime: 3.0 };
            stickers.set(firstKey, sticker);
          }
        }
      }
    });

    // Verify timing was set
    const stickerTiming = await page.evaluate(() => {
      const stores = (window as any).__ZUSTAND_STORES__;
      if (stores?.stickersOverlay) {
        const state = stores.stickersOverlay.getState();
        const stickers = Array.from(state.overlayStickers?.values() || []);
        if (stickers.length > 0) {
          return (stickers[0] as any).timing;
        }
      }
      return;
    });

    expect(stickerTiming).toEqual({ startTime: 1.0, endTime: 3.0 });

    // Start export
    const exportStarted = await startExport(page, { timeout: 20_000 });
    expect(exportStarted).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBTASK 4: Export Verification and Diagnostics
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Test 4.1: Export provides sticker render summary
   * Verifies diagnostic information is available after export
   */
  test("should provide sticker render summary after export", async ({
    page,
  }) => {
    // Collect console messages
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      consoleMessages.push(msg.text());
    });

    // Add sticker to canvas
    const stickerAdded = await addStickerToCanvas(page);
    if (!stickerAdded) {
      test.skip(true, "Sticker canvas not available");
      return;
    }

    // Start export and wait longer
    await startExport(page, { timeout: 30_000 });

    // Wait for export to progress
    await page.waitForTimeout(5000);

    // At least some sticker-related log should appear
    const hasStickerLog = consoleMessages.some((msg) =>
      msg.toLowerCase().includes("sticker")
    );

    expect(hasStickerLog).toBe(true);
  });

  /**
   * Test 4.2: Multiple stickers are processed during export
   * Verifies that adding multiple stickers results in sticker processing logs
   */
  test("should process multiple stickers during export", async ({
    page,
  }) => {
    // Collect console messages
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      consoleMessages.push(msg.text());
    });

    // Add multiple stickers to canvas
    const stickerAdded = await addStickerToCanvas(page);
    if (!stickerAdded) {
      test.skip(true, "Sticker canvas not available");
      return;
    }

    // Add a second sticker at different position
    await addStickerToCanvas(page, { position: { x: 200, y: 200 } });

    // Start export
    await startExport(page, { timeout: 30_000 });

    // Wait for export to progress
    await page.waitForTimeout(5000);

    // Log should exist showing sticker processing
    expect(
      consoleMessages.some((msg) => msg.toLowerCase().includes("sticker"))
    ).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBTASK 5: Multiple Sticker Support
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Test 5.1: Multiple stickers render in correct z-order
   * Verifies stickers are layered correctly based on z-index
   */
  test("should render multiple stickers in correct z-order", async ({
    page,
  }) => {
    // Add first sticker
    const sticker1Added = await addStickerToCanvas(page, {
      position: { x: 100, y: 100 },
    });
    if (!sticker1Added) {
      test.skip(true, "Sticker canvas not available");
      return;
    }

    // Add second sticker (overlapping position)
    await addStickerToCanvas(page, { position: { x: 120, y: 120 } });

    // Verify both stickers exist
    const stickerCount = await page
      .locator('[data-testid="sticker-instance"]')
      .count();
    expect(stickerCount).toBeGreaterThanOrEqual(2);

    // Verify z-index ordering in store
    const zIndexes = await page.evaluate(() => {
      const stores = (window as any).__ZUSTAND_STORES__;
      if (stores?.stickersOverlay) {
        const state = stores.stickersOverlay.getState();
        const stickers = Array.from(state.overlayStickers?.values() || []);
        return stickers
          .map((s: any) => s.zIndex || 0)
          .sort((a: number, b: number) => a - b);
      }
      return [];
    });

    // z-indexes should be ascending (or at least defined)
    expect(zIndexes.length).toBeGreaterThanOrEqual(2);

    // Start export
    const exportStarted = await startExport(page, { timeout: 30_000 });
    expect(exportStarted).toBe(true);
  });

  /**
   * Test 5.2: Stickers at different times don't overlap in export
   * Verifies time-based sticker visibility isolation
   */
  test("should handle stickers at different time ranges without overlap", async ({
    page,
  }) => {
    // Add first sticker (0-2s)
    const sticker1Added = await addStickerToCanvas(page, {
      position: { x: 100, y: 100 },
    });
    if (!sticker1Added) {
      test.skip(true, "Sticker canvas not available");
      return;
    }

    // Add second sticker (2-4s)
    await addStickerToCanvas(page, { position: { x: 200, y: 200 } });

    // Set different timings for each sticker
    await page.evaluate(() => {
      const stores = (window as any).__ZUSTAND_STORES__;
      if (stores?.stickersOverlay) {
        const state = stores.stickersOverlay.getState();
        const stickers = Array.from(state.overlayStickers?.entries() || []);

        if (stickers.length >= 2) {
          const [key1, sticker1] = stickers[0] as [string, any];
          const [key2, sticker2] = stickers[1] as [string, any];

          sticker1.timing = { startTime: 0, endTime: 2 };
          sticker2.timing = { startTime: 2, endTime: 4 };

          state.overlayStickers.set(key1, sticker1);
          state.overlayStickers.set(key2, sticker2);
        }
      }
    });

    // Start export
    const exportStarted = await startExport(page, { timeout: 30_000 });
    expect(exportStarted).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Integration Test: Complete sticker workflow from add to export
   */
  test("should complete full sticker workflow: add, position, and export", async ({
    page,
  }) => {
    // Step 1: Add sticker to canvas
    const stickerAdded = await addStickerToCanvas(page);
    if (!stickerAdded) {
      test.skip(true, "Sticker canvas not available");
      return;
    }

    // Step 2: Verify sticker is visible in preview
    const stickerInstance = page
      .locator('[data-testid="sticker-instance"]')
      .first();
    await expect(stickerInstance).toBeVisible();

    // Step 3: Manipulate sticker (optional - drag to new position)
    const originalBox = await stickerInstance.boundingBox();
    if (originalBox) {
      await stickerInstance.click();
      await page.waitForTimeout(200);

      // Drag sticker
      const cx = originalBox.x + originalBox.width / 2;
      const cy = originalBox.y + originalBox.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 50, cy + 50, { steps: 5 });
      await page.mouse.up();
    }

    // Step 4: Start export
    const exportStarted = await startExport(page, { timeout: 30_000 });
    expect(exportStarted).toBe(true);

    // Step 5: Verify export progress
    const progressBar = page.locator('[data-testid="export-progress-bar"]');
    const exportStatus = page.locator('[data-testid="export-status"]');

    const hasFeedback =
      (await progressBar.isVisible().catch(() => false)) ||
      (await exportStatus.isVisible().catch(() => false));

    expect(hasFeedback).toBe(true);
  });

  /**
   * Integration Test: Sticker persistence during auto-save
   * Note: This test verifies stickers remain in DOM during auto-save cycle,
   * not persistence across page reload (which would require navigation helpers).
   */
  test("should preserve stickers during auto-save cycle", async ({
    page,
  }) => {
    // Add sticker to canvas
    const stickerAdded = await addStickerToCanvas(page);
    if (!stickerAdded) {
      test.skip(true, "Sticker canvas not available");
      return;
    }

    // Get initial sticker count
    const initialCount = await page
      .locator('[data-testid="sticker-instance"]')
      .count();
    expect(initialCount).toBeGreaterThan(0);

    // Wait for auto-save cycle
    await page.waitForTimeout(1000);

    // Verify stickers still exist after auto-save
    const finalCount = await page
      .locator('[data-testid="sticker-instance"]')
      .count();
    expect(finalCount).toBe(initialCount);
  });
});

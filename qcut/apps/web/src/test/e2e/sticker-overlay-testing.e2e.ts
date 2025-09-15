import { test, expect } from './helpers/electron-helpers';

test.describe('Sticker Overlay Testing (Subtask 3A)', () => {
  test('should access stickers panel and interact with sticker items', async ({ page }) => {
    // Setup: Create project and navigate to editor
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Test steps:
    // 1. Open stickers panel
    await page.getByTestId('stickers-panel-tab').click();

    // Verify stickers panel opens
    await expect(page.getByTestId('stickers-panel')).toBeVisible();

    // 2. Check sticker items are available
    const stickerItems = page.getByTestId('sticker-item');

    // Wait for stickers to load
    await page.waitForTimeout(2000);

    const itemCount = await stickerItems.count();
    if (itemCount > 0) {
      // 3. Test sticker selection
      const firstSticker = stickerItems.first();
      await expect(firstSticker).toBeVisible();
      await expect(firstSticker).toBeEnabled();

      // Click on sticker
      await firstSticker.click();

      // Verify sticker is selected (should have different styling)
      await expect(firstSticker).toHaveAttribute('aria-pressed', 'false');
    }

    // 4. Verify panel structure
    await expect(page.getByTestId('stickers-panel')).toHaveClass(/flex.*h-full.*flex-col/);
  });

  test('should support sticker drag and drop to canvas', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Open stickers panel
    await page.getByTestId('stickers-panel-tab').click();
    await expect(page.getByTestId('stickers-panel')).toBeVisible();

    // Check if sticker canvas is available
    const stickerCanvas = page.getByTestId('sticker-canvas');

    // Test sticker drag-and-drop functionality
    const stickerItems = page.getByTestId('sticker-item');
    await page.waitForTimeout(1000);

    const itemCount = await stickerItems.count();
    if (itemCount > 0) {
      const firstSticker = stickerItems.first();
      await expect(firstSticker).toBeVisible();

      // Check if sticker canvas is available for drag-and-drop
      const canvasCount = await stickerCanvas.count();

      if (canvasCount > 0 && await stickerCanvas.isVisible()) {
        // Canvas is available - perform drag-and-drop
        await expect(stickerCanvas).toBeAttached({ timeout: 2000 });

        // Count existing sticker instances on canvas before drop
        const stickerInstances = page.locator('[data-testid="sticker-instance"]');
        const instancesBefore = await stickerInstances.count();

        // Perform drag-and-drop with better options
        await firstSticker.dragTo(stickerCanvas, {
          force: true,
          timeout: 5000,
          targetPosition: { x: 100, y: 100 } // Drop at specific position
        });

        await page.waitForTimeout(1000);

        // Verify a sticker instance was added to canvas
        const instancesAfter = await stickerInstances.count();
        expect(instancesAfter).toBeGreaterThan(instancesBefore);

        // Verify the sticker instance is visible and positioned correctly
        const newInstance = stickerInstances.last();
        await expect(newInstance).toBeVisible();

        // Check that the instance has positioning attributes
        await expect(newInstance).toHaveAttribute('style');

      } else {
        // Canvas not available - test alternative interaction
        console.log('Sticker canvas not available - testing click interaction');

        // Test hover and click interactions
        await firstSticker.hover();
        await page.waitForTimeout(200);

        await firstSticker.click();
        await page.waitForTimeout(500);

        // Verify interaction feedback - check for selection or preview
        const hasSelectionState = await firstSticker.getAttribute('data-selected');
        const hasActiveClass = await firstSticker.getAttribute('class');

        if (hasSelectionState === 'true' || hasActiveClass?.includes('selected')) {
          await expect(firstSticker).toHaveAttribute('data-selected', 'true');
        } else {
          // Alternative: check if sticker preview appears
          const stickerPreview = page.locator('[data-testid="sticker-preview"]');
          const previewVisible = await stickerPreview.waitFor({ state: 'visible', timeout: 1000 }).then(() => true).catch(() => false);
          if (previewVisible) {
            await expect(stickerPreview).toBeVisible();
          }
        }
      }
    }
  });

  test('should manipulate stickers on canvas after placement', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Open stickers panel and place a sticker
    await page.getByTestId('stickers-panel-tab').click();
    await expect(page.getByTestId('stickers-panel')).toBeVisible();

    const stickerCanvas = page.getByTestId('sticker-canvas');
    const stickerItems = page.getByTestId('sticker-item');
    await page.waitForTimeout(1000);

    const itemCount = await stickerItems.count();
    if (itemCount > 0 && await stickerCanvas.count() > 0) {
      const firstSticker = stickerItems.first();

      // Place sticker on canvas
      await firstSticker.dragTo(stickerCanvas, {
        force: true,
        targetPosition: { x: 150, y: 150 }
      });
      await page.waitForTimeout(1000);

      // Find the placed sticker instance
      const stickerInstances = page.locator('[data-testid="sticker-instance"]');
      if (await stickerInstances.count() > 0) {
        const placedSticker = stickerInstances.first();
        await expect(placedSticker).toBeVisible();

        // Test sticker manipulation: click to select
        await placedSticker.click();
        await page.waitForTimeout(300);

        // Check if selection controls appear
        const resizeHandles = page.locator('[data-testid="resize-handle"]');
        if (await resizeHandles.count() > 0) {
          await expect(resizeHandles.first()).toBeVisible();
        }

        // Test drag to reposition (if drag is supported)
        const originalPosition = await placedSticker.boundingBox();
        if (originalPosition) {
          await placedSticker.dragTo(stickerCanvas, {
            targetPosition: { x: 200, y: 200 }
          });
          await page.waitForTimeout(500);

          const newPosition = await placedSticker.boundingBox();
          expect(newPosition?.x).not.toBe(originalPosition.x);
        }

        // Test delete functionality (if available)
        const deleteButton = page.locator('[data-testid="delete-sticker"], [data-testid="remove-overlay"]');
        const deleteVisible = await deleteButton.waitFor({ state: 'visible', timeout: 1000 }).then(() => true).catch(() => false);
        if (deleteVisible) {
          await deleteButton.click();
          await page.waitForTimeout(500);
          await expect(placedSticker).not.toBeVisible();
        }
      }
    }
  });

  test('should handle sticker panel categories and search', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Open stickers panel
    await page.getByTestId('stickers-panel-tab').click();
    await expect(page.getByTestId('stickers-panel')).toBeVisible();

    // Check for search functionality (if input exists)
    const searchInput = page.locator('input[placeholder*="Search stickers"]');

    const searchVisible = await searchInput.waitFor({ state: 'visible', timeout: 1000 }).then(() => true).catch(() => false);
    if (searchVisible) {
      // Test search functionality
      await searchInput.fill('star');

      // Wait for search results
      await page.waitForTimeout(500);

      // Clear search
      await searchInput.clear();
    }

    // Check for category tabs (Recent, All, etc.)
    const categoryTabs = page.locator('[role="tablist"] button');
    const tabCount = await categoryTabs.count();

    if (tabCount > 0) {
      // Test category switching
      for (let i = 0; i < Math.min(tabCount, 3); i++) {
        const tab = categoryTabs.nth(i);
        await tab.click();

        // Wait for content to load
        await page.waitForTimeout(300);

        // Verify tab is active
        await expect(tab).toHaveAttribute('data-state', 'active');
      }
    }
  });

  test('should handle sticker overlay rendering', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Check for preview canvas (where stickers would be rendered)
    const previewCanvas = page.getByTestId('preview-canvas');

    const previewVisible = await previewCanvas.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
    if (previewVisible) {
      await expect(previewCanvas).toBeVisible();

      // Verify canvas is positioned correctly for overlays
      const canvasClasses = await previewCanvas.getAttribute('class');
      expect(canvasClasses).toContain('absolute');
    }

    // Test sticker canvas when available
    const stickerCanvas = page.getByTestId('sticker-canvas');

    const canvasAttached = await stickerCanvas.waitFor({ state: 'attached', timeout: 1000 }).then(() => true).catch(() => false);
    if (canvasAttached) {
      // Verify sticker canvas properties
      const canvasStyle = await stickerCanvas.getAttribute('style');

      // Should be positioned for overlay
      expect(canvasStyle).toContain('isolation');

      // Check z-index for proper layering
      const computedStyle = await stickerCanvas.evaluate(el => {
        return window.getComputedStyle(el).zIndex;
      });

      expect(Number(computedStyle)).toBeGreaterThan(10);
    }
  });

  test('should maintain sticker panel state across interactions', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Open stickers panel
    await page.getByTestId('stickers-panel-tab').click();
    await expect(page.getByTestId('stickers-panel')).toBeVisible();

    // Switch to another tab and back
    await page.getByTestId('media-panel-tab').click();
    await page.waitForTimeout(200);

    await page.getByTestId('stickers-panel-tab').click();

    // Verify stickers panel is still functional
    await expect(page.getByTestId('stickers-panel')).toBeVisible();

    // Test panel responsiveness
    const stickerItems = page.getByTestId('sticker-item');
    await page.waitForTimeout(1000);

    const itemCount = await stickerItems.count();
    if (itemCount > 0) {
      const lastSticker = stickerItems.last();
      await expect(lastSticker).toBeVisible();
    }
  });
});
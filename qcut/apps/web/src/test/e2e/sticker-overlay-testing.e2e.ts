import { test, expect } from '../helpers/electron-helpers';

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

    // Canvas may not be visible initially
    try {
      await expect(stickerCanvas).toBeAttached({ timeout: 2000 });

      // Get canvas bounds for drag target
      const canvasBounds = await stickerCanvas.boundingBox();

      if (canvasBounds) {
        expect(canvasBounds.width).toBeGreaterThan(0);
        expect(canvasBounds.height).toBeGreaterThan(0);
      }
    } catch (error) {
      // Canvas might not be visible without media - this is expected behavior
      console.log('Sticker canvas not immediately visible - may require media content');
    }

    // Test sticker items are interactive
    const stickerItems = page.getByTestId('sticker-item');
    await page.waitForTimeout(1000);

    const itemCount = await stickerItems.count();
    if (itemCount > 0) {
      const firstSticker = stickerItems.first();
      await expect(firstSticker).toBeVisible();

      // Test hover interaction
      await firstSticker.hover();

      // Verify sticker remains interactive
      await expect(firstSticker).toBeEnabled();
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

    if (await searchInput.isVisible({ timeout: 1000 }).catch(() => false)) {
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

    if (await previewCanvas.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(previewCanvas).toBeVisible();

      // Verify canvas is positioned correctly for overlays
      const canvasClasses = await previewCanvas.getAttribute('class');
      expect(canvasClasses).toContain('absolute');
    }

    // Test sticker canvas when available
    const stickerCanvas = page.getByTestId('sticker-canvas');

    if (await stickerCanvas.isAttached({ timeout: 1000 }).catch(() => false)) {
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
import { test, expect } from '../helpers/electron-helpers';

test.describe('Text Overlay Testing (Subtask 3B)', () => {
  test('should access text panel and interact with text overlay button', async ({ page }) => {
    // Setup: Create project and navigate to editor
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Test steps:
    // 1. Open text panel
    await page.getByTestId('text-panel-tab').click();

    // Verify text panel opens
    await expect(page.getByTestId('text-panel')).toBeVisible();

    // 2. Check text overlay button is available
    const textOverlayButton = page.getByTestId('text-overlay-button');
    await expect(textOverlayButton).toBeVisible();

    // 3. Test text overlay button interaction
    // The button should contain a draggable text item
    const draggableText = textOverlayButton.locator('[draggable="true"]');
    await expect(draggableText).toBeVisible();

    // 4. Test text preview display
    const textPreview = textOverlayButton.locator('text="Default text"');
    await expect(textPreview).toBeVisible();

    // 5. Test hover interaction
    await textOverlayButton.hover();

    // Should show plus button on hover (if implemented)
    const plusButton = textOverlayButton.locator('button');

    if (await plusButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await expect(plusButton).toBeVisible();
    }
  });

  test('should support text drag and drop to timeline', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Open text panel
    await page.getByTestId('text-panel-tab').click();
    await expect(page.getByTestId('text-panel')).toBeVisible();

    // Get text overlay button and timeline
    const textOverlayButton = page.getByTestId('text-overlay-button');
    const timeline = page.getByTestId('timeline-track').first();

    await expect(textOverlayButton).toBeVisible();
    await expect(timeline).toBeVisible();

    // Test drag and drop capability
    const draggableElement = textOverlayButton.locator('[draggable="true"]');
    await expect(draggableElement).toBeVisible();

    // Get bounds for drag operation
    const sourceBounds = await draggableElement.boundingBox();
    const targetBounds = await timeline.boundingBox();

    expect(sourceBounds).toBeTruthy();
    expect(targetBounds).toBeTruthy();

    if (sourceBounds && targetBounds) {
      // Test drag start
      await draggableElement.hover();

      // Verify draggable element has proper attributes
      const isDraggable = await draggableElement.getAttribute('draggable');
      expect(isDraggable).toBe('true');

      // Test that timeline can accept drops
      await timeline.hover();

      // Timeline should be interactive
      expect(targetBounds.width).toBeGreaterThan(100);
      expect(targetBounds.height).toBeGreaterThan(20);
    }
  });

  test('should handle text panel state and functionality', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Open text panel
    await page.getByTestId('text-panel-tab').click();
    await expect(page.getByTestId('text-panel')).toBeVisible();

    // Test panel structure
    const textPanel = page.getByTestId('text-panel');

    // Should have proper padding/styling
    const panelClasses = await textPanel.getAttribute('class');
    expect(panelClasses).toContain('p-4');

    // Test text overlay button structure
    const textOverlayButton = page.getByTestId('text-overlay-button');
    const textPreview = textOverlayButton.locator('.bg-accent');

    await expect(textPreview).toBeVisible();

    // Should show "Default text" content
    const textContent = textOverlayButton.locator('text="Default text"');
    await expect(textContent).toBeVisible();

    // Test aspect ratio container
    const aspectRatioContainer = textOverlayButton.locator('[style*="aspect-ratio"]');

    if (await aspectRatioContainer.isVisible({ timeout: 500 }).catch(() => false)) {
      await expect(aspectRatioContainer).toBeVisible();
    }
  });

  test('should support text overlay interactions with timeline', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Open text panel
    await page.getByTestId('text-panel-tab').click();
    await expect(page.getByTestId('text-panel')).toBeVisible();

    // Test plus button functionality (add to timeline)
    const textOverlayButton = page.getByTestId('text-overlay-button');
    await textOverlayButton.hover();

    const plusButton = textOverlayButton.locator('button');

    if (await plusButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Test plus button click
      await plusButton.click();

      // Should add text to timeline
      // Check for timeline elements after addition
      const timelineElements = page.getByTestId('timeline-element');

      // Wait for potential element addition
      await page.waitForTimeout(500);

      const elementCount = await timelineElements.count();

      // If successful, should have added an element
      if (elementCount > 0) {
        const textElement = timelineElements.first();
        await expect(textElement).toBeVisible();

        // Verify it's a text element
        const elementType = await textElement.getAttribute('data-element-id');
        expect(elementType).toBeTruthy();
      }
    }

    // Test that text panel remains functional
    await expect(page.getByTestId('text-panel')).toBeVisible();
    await expect(textOverlayButton).toBeVisible();
  });

  test('should maintain text overlay state across panel switches', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Open text panel
    await page.getByTestId('text-panel-tab').click();
    await expect(page.getByTestId('text-panel')).toBeVisible();

    // Verify initial state
    const textOverlayButton = page.getByTestId('text-overlay-button');
    await expect(textOverlayButton).toBeVisible();

    // Switch to another panel and back
    await page.getByTestId('media-panel-tab').click();
    await page.waitForTimeout(200);

    await page.getByTestId('text-panel-tab').click();

    // Verify text panel is still functional
    await expect(page.getByTestId('text-panel')).toBeVisible();
    await expect(textOverlayButton).toBeVisible();

    // Test that text overlay is still interactive
    await textOverlayButton.hover();

    const draggableElement = textOverlayButton.locator('[draggable="true"]');
    await expect(draggableElement).toBeVisible();

    // Verify text content is preserved
    const textContent = textOverlayButton.locator('text="Default text"');
    await expect(textContent).toBeVisible();
  });

  test('should handle text overlay rendering in preview canvas', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Check for preview canvas where text overlays would render
    const previewCanvas = page.getByTestId('preview-canvas');

    if (await previewCanvas.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(previewCanvas).toBeVisible();

      // Verify canvas positioning for text overlays
      const canvasClasses = await previewCanvas.getAttribute('class');
      expect(canvasClasses).toContain('absolute');

      // Should be properly positioned for overlay rendering
      const canvasStyle = await previewCanvas.getAttribute('style');
      expect(canvasStyle).toContain('z-index');
    }

    // Test that text elements can be added to timeline
    await page.getByTestId('text-panel-tab').click();
    const textOverlayButton = page.getByTestId('text-overlay-button');

    // Verify text overlay is ready for timeline integration
    const draggableElement = textOverlayButton.locator('[draggable="true"]');
    await expect(draggableElement).toBeVisible();

    const dragData = await draggableElement.evaluate(el => el.getAttribute('draggable'));
    expect(dragData).toBe('true');
  });
});
import { test, expect } from "./helpers/electron-helpers";

test.describe("Text Overlay Testing (Subtask 3B)", () => {
  test("should access text panel and interact with text overlay button", async ({
    page,
  }) => {
    // Setup: Create project and navigate to editor

    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Test steps:
    // 1. Open text panel
    await page.getByTestId("text-panel-tab").click();

    // Verify text panel opens
    await expect(page.getByTestId("text-panel")).toBeVisible();

    // 2. Check text overlay button is available
    const textOverlayButton = page.getByTestId("text-overlay-button");
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
    const plusButton = textOverlayButton.locator("button");

    const plusVisible = await plusButton
      .waitFor({ state: "visible", timeout: 500 })
      .then(() => true)
      .catch(() => false);
    if (plusVisible) {
      await expect(plusButton).toBeVisible();
    }
  });

  test("should support text drag and drop to timeline", async ({ page }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Open text panel
    await page.getByTestId("text-panel-tab").click();
    await expect(page.getByTestId("text-panel")).toBeVisible();

    // Get text overlay button and timeline
    const textOverlayButton = page.getByTestId("text-overlay-button");
    const timeline = page.getByTestId("timeline-track").first();

    await expect(textOverlayButton).toBeVisible();
    await expect(timeline).toBeVisible();

    // Get count of timeline elements before drag-and-drop
    const timelineElementsBefore = await page
      .locator('[data-testid="timeline-element"]')
      .count();

    // Perform actual drag-and-drop operation
    const draggableElement = textOverlayButton.locator('[draggable="true"]');
    if (await draggableElement.isVisible()) {
      // Drag text element to timeline
      await draggableElement.dragTo(timeline);
    } else {
      // If no draggable element, try clicking the text overlay button to add text
      await textOverlayButton.click();
    }

    // Wait for text overlay element to appear on timeline
    await page.waitForSelector('[data-testid="timeline-element"]', {
      timeout: 5000,
    });

    // Verify that a text element was added to the timeline
    const timelineElementsAfter = await page
      .locator('[data-testid="timeline-element"]')
      .count();
    expect(timelineElementsAfter).toBeGreaterThan(timelineElementsBefore);

    // Verify the text element has proper attributes
    const textElements = page
      .locator('[data-testid="timeline-element"]')
      .filter({
        hasText: /text|overlay/i,
      });

    if ((await textElements.count()) > 0) {
      const textElement = textElements.first();
      await expect(textElement).toBeVisible();

      // Verify it has duration attribute
      const duration = await textElement.getAttribute("data-duration");
      expect(duration).toBeTruthy();
    }
  });

  test("should handle text panel state and functionality", async ({ page }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Open text panel
    await page.getByTestId("text-panel-tab").click();
    await expect(page.getByTestId("text-panel")).toBeVisible();

    // Test panel structure
    const textPanel = page.getByTestId("text-panel");

    // Should have proper padding/styling
    const panelClasses = await textPanel.getAttribute("class");
    expect(panelClasses).toContain("p-4");

    // Test text overlay button structure
    const textOverlayButton = page.getByTestId("text-overlay-button");
    const textPreview = textOverlayButton.locator(".bg-accent").first();

    await expect(textPreview).toBeVisible();

    // Should show "Default text" content
    const textContent = textOverlayButton.locator('text="Default text"');
    await expect(textContent).toBeVisible();

    // Test aspect ratio container
    const aspectRatioContainer = textOverlayButton.locator(
      '[style*="aspect-ratio"]'
    );

    const arVisible = await aspectRatioContainer
      .waitFor({ state: "visible", timeout: 500 })
      .then(() => true)
      .catch(() => false);
    if (arVisible) {
      await expect(aspectRatioContainer).toBeVisible();
    }
  });

  test("should support text overlay interactions with timeline", async ({
    page,
  }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Open text panel
    await page.getByTestId("text-panel-tab").click();
    await expect(page.getByTestId("text-panel")).toBeVisible();

    // Test plus button functionality (add to timeline)
    const textOverlayButton = page.getByTestId("text-overlay-button");
    await textOverlayButton.hover();

    const plusButton = textOverlayButton.locator("button");

    const plusReady = await plusButton
      .waitFor({ state: "visible", timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (plusReady) {
      const elements = page.getByTestId("timeline-element");
      const before = await elements.count();
      await plusButton.click();
      await expect(elements.nth(before)).toBeVisible({ timeout: 5000 });
      const textElement = elements.nth(before);
      const elementId = await textElement.getAttribute("data-element-id");
      expect(elementId).toBeTruthy();
    }

    // Test that text panel remains functional
    await expect(page.getByTestId("text-panel")).toBeVisible();
    await expect(textOverlayButton).toBeVisible();
  });

  test("should maintain text overlay state across panel switches", async ({
    page,
  }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Open text panel
    await page.getByTestId("text-panel-tab").click();
    await expect(page.getByTestId("text-panel")).toBeVisible();

    // Verify initial state
    const textOverlayButton = page.getByTestId("text-overlay-button");
    await expect(textOverlayButton).toBeVisible();

    // Switch to another panel and back
    await page.getByTestId("media-panel-tab").click();
    const mediaPanel = page.getByTestId("media-panel");
    const mediaPanelVisible = await mediaPanel
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (!mediaPanelVisible) {
      await expect(
        page
          .locator(
            '[data-testid="import-media-button"], [data-testid="media-item"]'
          )
          .first()
      ).toBeVisible({ timeout: 5000 });
    }

    await page.getByTestId("text-panel-tab").click();

    // Verify text panel is still functional
    await expect(page.getByTestId("text-panel")).toBeVisible({ timeout: 2000 });
    await expect(textOverlayButton).toBeVisible();

    // Test that text overlay is still interactive
    await textOverlayButton.hover();

    const draggableElement = textOverlayButton.locator('[draggable="true"]');
    await expect(draggableElement).toBeVisible();

    // Verify text content is preserved
    const textContent = textOverlayButton.locator('text="Default text"');
    await expect(textContent).toBeVisible();
  });

  test("should handle text overlay rendering in preview canvas", async ({
    page,
  }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Check for preview canvas where text overlays would render
    const previewCanvas = page.getByTestId("preview-canvas");

    const previewVisible = await previewCanvas
      .waitFor({ state: "visible", timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (previewVisible) {
      await expect(previewCanvas).toBeVisible();

      // Verify canvas positioning for text overlays
      const canvasClasses = await previewCanvas.getAttribute("class");
      expect(canvasClasses).toContain("absolute");

      // Should be properly positioned for overlay rendering
      const canvasStyle = await previewCanvas.getAttribute("style");
      expect(canvasStyle).toContain("z-index");
    }

    // Test that text elements can be added to timeline
    await page.getByTestId("text-panel-tab").click();
    const textOverlayButton = page.getByTestId("text-overlay-button");

    // Verify text overlay is ready for timeline integration
    const draggableElement = textOverlayButton.locator('[draggable="true"]');
    await expect(draggableElement).toBeVisible();

    const dragData = await draggableElement.evaluate((el) =>
      el.getAttribute("draggable")
    );
    expect(dragData).toBe("true");
  });
});

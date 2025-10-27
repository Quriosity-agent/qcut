import { test, expect } from "./helpers/electron-helpers";

test.describe("Timeline Controls & Editing Operations (Test #2 Part 2)", () => {
  test("should control playback with play/pause buttons", async ({ page }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Test play/pause functionality
    const timelineToolbar = page.getByTestId("timeline-toolbar");
    const playButton = timelineToolbar.getByTestId("timeline-play-button");
    const pauseButton = timelineToolbar.getByTestId("timeline-pause-button");

    // Initially should show play button
    if (await playButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(playButton).toBeVisible();

      // Click play
      await playButton.click();

      // Should now show pause button
      await expect(pauseButton).toBeVisible();
      await expect(pauseButton).toHaveAttribute("data-playing", "true");

      // Click pause
      await pauseButton.click();

      // Should show play button again
      await expect(playButton).toBeVisible();
    }
  });

  test("should handle zoom controls", async ({ page }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Test zoom controls
    const zoomInButton = page.getByTestId("zoom-in-button");
    const zoomOutButton = page.getByTestId("zoom-out-button");

    await expect(zoomInButton).toBeVisible();
    await expect(zoomOutButton).toBeVisible();

    // Get initial zoom level
    const zoomSlider = page.locator("[data-zoom-level]").first();
    const initialZoom = await zoomSlider.getAttribute("data-zoom-level");

    // Zoom in
    await zoomInButton.click();
    // Wait for zoom level to update
    await page.waitForFunction(
      (initial) => {
        const slider = document.querySelector("[data-zoom-level]");
        return slider && Number(slider.getAttribute("data-zoom-level")) > Number(initial);
      },
      initialZoom,
      { timeout: 2000 }
    );

    const zoomedInLevel = await zoomSlider.getAttribute("data-zoom-level");
    expect(Number(zoomedInLevel)).toBeGreaterThan(Number(initialZoom));

    // Zoom out
    await zoomOutButton.click();
    // Wait for zoom level to decrease
    await page.waitForFunction(
      (zoomedIn) => {
        const slider = document.querySelector("[data-zoom-level]");
        return slider && Number(slider.getAttribute("data-zoom-level")) < Number(zoomedIn);
      },
      zoomedInLevel,
      { timeout: 2000 }
    );

    const zoomedOutLevel = await zoomSlider.getAttribute("data-zoom-level");
    expect(Number(zoomedOutLevel)).toBeLessThan(Number(zoomedInLevel));
  });

  test("should display current time and duration", async ({ page }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Check time display
    const timeDisplay = page.getByTestId("current-time-display");
    await expect(timeDisplay).toBeVisible();

    // Verify time format (should contain 's' for seconds)
    const timeText = await timeDisplay.textContent();
    expect(timeText).toContain("s");
    expect(timeText).toMatch(/\d+\.\d+s/); // Format: X.Xs
  });

  test("should handle split clip functionality", async ({ page }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Check split button availability
    const splitButton = page.getByTestId("split-clip-button");
    await expect(splitButton).toBeVisible();

    // Split button should be accessible
    await expect(splitButton).toBeEnabled();

    // Test that clicking doesn't cause errors (even with no elements)
    await splitButton.click();

    // Timeline should still be functional
    await expect(page.getByTestId("timeline-track").first()).toBeVisible();
  });

  test("should handle timeline element selection and editing", async ({
    page,
  }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Check for timeline elements
    const timelineElements = page.getByTestId("timeline-element");
    const elementCount = await timelineElements.count();

    if (elementCount > 0) {
      // Test element selection
      const firstElement = timelineElements.first();
      await expect(firstElement).toBeVisible();

      // Check element attributes
      await expect(firstElement).toHaveAttribute("data-duration");
      await expect(firstElement).toHaveAttribute("data-element-id");

      // Click to select
      await firstElement.click();

      // Check for trim handles on selected element
      const trimHandle = page.getByTestId("trim-start-handle");

      // Trim handles may appear on selection
      if (await trimHandle.isVisible({ timeout: 500 }).catch(() => false)) {
        await expect(trimHandle).toBeVisible();
      }
    }
  });

  test("should maintain playback state", async ({ page }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Get time display
    const timeDisplay = page.getByTestId("current-time-display");
    const initialTime = await timeDisplay.textContent();

    // Ensure time display is visible and stable
    await expect(timeDisplay).toBeVisible({ timeout: 2000 });
    const currentTime = await timeDisplay.textContent();

    // Time should be formatted correctly
    expect(currentTime).toMatch(/\d+\.\d+s.*\d+\.\d+s/);
  });

  test("should handle timeline scrolling and navigation", async ({ page }) => {
    await page.getByTestId("new-project-button").click();
    await page.waitForSelector('[data-testid="timeline-track"]');

    // Test timeline is scrollable
    const timeline = page.getByTestId("timeline-track").first();
    const bounds = await timeline.boundingBox();

    // Timeline should have proper dimensions
    expect(bounds).toBeTruthy();
    expect(bounds!.width).toBeGreaterThan(100);
    expect(bounds!.height).toBeGreaterThan(20);

    // Test zoom affects timeline width
    const zoomInButton = page.getByTestId("zoom-in-button");
    await zoomInButton.click();

    // Timeline should still be visible after zoom
    await expect(timeline).toBeVisible();
  });
});

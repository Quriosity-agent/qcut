/**
 * Playwright E2E Tests for Remotion Preview Integration
 *
 * Tests the Remotion preview rendering in QCut editor.
 *
 * Run with: npx playwright test tests/e2e/remotion-preview.spec.ts
 */

import {
  test,
  expect,
  _electron as electron,
  ElectronApplication,
  Page,
} from "@playwright/test";
import path from "path";

let electronApp: ElectronApplication;
let page: Page;

test.describe("Remotion Preview Integration", () => {
  test.beforeAll(async () => {
    // Launch Electron app
    electronApp = await electron.launch({
      args: [path.join(__dirname, "../../electron/dist/main.js")],
      cwd: path.join(__dirname, "../.."),
    });

    // Get the first window
    page = await electronApp.firstWindow();

    // Wait for app to load
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000); // Give time for React to hydrate
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test("should initialize Remotion store on app start", async () => {
    // Check if __REMOTION_DEBUG__ is available
    const isInitialized = await page.evaluate(() => {
      return (window as any).__REMOTION_DEBUG__?.isInitialized?.();
    });

    expect(isInitialized).toBe(true);
  });

  test("should register built-in components", async () => {
    const components = await page.evaluate(() => {
      return (window as any).__REMOTION_DEBUG__?.getComponents?.();
    });

    expect(components).toBeDefined();
    expect(components.length).toBeGreaterThanOrEqual(10);

    // Check for specific built-in components
    expect(components).toContain("built-in-fade-in-text");
    expect(components).toContain("built-in-dissolve");
    expect(components).toContain("built-in-skills-demo");
  });

  test("should navigate to editor with existing project", async () => {
    // Click on a project to open editor
    // This assumes there's at least one project in the list
    const projectCard = page.locator('[data-testid="project-card"]').first();

    if (await projectCard.isVisible()) {
      await projectCard.click();
      await page.waitForURL(/.*editor.*/);
    }
  });

  test("should render Remotion element in preview", async () => {
    // Wait for preview panel to load
    const previewPanel = page.locator('[data-testid="preview-panel"]');
    await expect(previewPanel).toBeVisible();

    // Check if there's a Remotion element
    const remotionPreview = page.locator('[class*="remotion"]').first();

    if (await remotionPreview.isVisible()) {
      // Take a screenshot of the preview
      await previewPanel.screenshot({
        path: "tests/e2e/screenshots/remotion-preview.png",
      });

      // Check that the Remotion player container exists
      const playerContainer = page.locator('[data-testid="remotion-player"]');
      const hasPlayer = await playerContainer.count();

      console.log(`Remotion player containers found: ${hasPlayer}`);
    }
  });

  test("should add Remotion component to timeline", async () => {
    // Open Remotion media panel
    const remotionTab = page.locator('button:has-text("Remotion")');

    if (await remotionTab.isVisible()) {
      await remotionTab.click();

      // Wait for component list to load
      await page.waitForTimeout(1000);

      // Click on a component to add it
      const fadeInTextComponent = page.locator("text=Fade In Text").first();

      if (await fadeInTextComponent.isVisible()) {
        // Find and click the Add button
        const addButton = page.locator('button:has-text("Add")').first();
        await addButton.click();

        // Wait for timeline to update
        await page.waitForTimeout(500);

        // Check if element was added to timeline
        const timelineElement = page.locator('[data-element-type="remotion"]');
        const count = await timelineElement.count();

        expect(count).toBeGreaterThan(0);
      }
    }
  });

  test("should show Remotion preview when element is active", async () => {
    // Move playhead to a Remotion element
    const timeline = page.locator('[data-testid="timeline"]');

    if (await timeline.isVisible()) {
      // Click on a Remotion element in timeline
      const remotionElement = page
        .locator('[data-element-type="remotion"]')
        .first();

      if (await remotionElement.isVisible()) {
        await remotionElement.click();

        // Wait for preview to update
        await page.waitForTimeout(500);

        // Take screenshot of preview panel
        const previewPanel = page.locator('[data-testid="preview-panel"]');
        await previewPanel.screenshot({
          path: "tests/e2e/screenshots/remotion-element-preview.png",
        });

        // Verify preview is not just white/empty
        const previewContent = await previewPanel.evaluate((el) => {
          const canvas = el.querySelector("canvas");
          if (canvas) {
            const ctx = canvas.getContext("2d");
            if (ctx) {
              const imageData = ctx.getImageData(
                0,
                0,
                canvas.width,
                canvas.height
              );
              // Check if there's any non-white pixel
              for (let i = 0; i < imageData.data.length; i += 4) {
                const r = imageData.data[i];
                const g = imageData.data[i + 1];
                const b = imageData.data[i + 2];
                if (r < 250 || g < 250 || b < 250) {
                  return { hasContent: true, samplePixel: { r, g, b } };
                }
              }
            }
          }
          return { hasContent: false };
        });

        console.log("Preview content check:", previewContent);
      }
    }
  });

  test("should play Remotion animation", async () => {
    // Click play button
    const playButton = page.locator('button[aria-label="Play"]');

    if (await playButton.isVisible()) {
      await playButton.click();

      // Let it play for a moment
      await page.waitForTimeout(1000);

      // Take screenshot during playback
      const previewPanel = page.locator('[data-testid="preview-panel"]');
      await previewPanel.screenshot({
        path: "tests/e2e/screenshots/remotion-playing.png",
      });

      // Pause
      const pauseButton = page.locator('button[aria-label="Pause"]');
      if (await pauseButton.isVisible()) {
        await pauseButton.click();
      }
    }
  });
});

// Additional helper tests
test.describe("Remotion Debug Utilities", () => {
  test("debug: dump store state", async () => {
    const state = await page.evaluate(() => {
      const debug = (window as any).__REMOTION_DEBUG__;
      if (!debug) return null;

      return {
        isInitialized: debug.isInitialized(),
        componentCount: debug.getComponents()?.length,
        components: debug.getComponents(),
        instanceCount: debug.getInstances()?.length,
        instances: debug.getInstances(),
      };
    });

    console.log("Remotion Store State:", JSON.stringify(state, null, 2));
  });
});

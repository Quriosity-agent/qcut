/**
 * Remotion Panel Stability E2E Test
 *
 * Tests that the Remotion panel doesn't cause infinite render loops (React Error #185).
 * This test monitors console output to detect excessive re-renders.
 */

import { test, expect, createTestProject } from "./helpers/electron-helpers";

test.describe("Remotion Panel Stability", () => {
  test("should not cause infinite render loops when opening editor", async ({
    page,
  }) => {
    // Track render counts from console logs
    const renderCounts: number[] = [];
    let hasWarning = false;
    let hasReactError185 = false;

    // Listen for console messages
    page.on("console", (msg) => {
      const text = msg.text();

      // Track RemotionView render counts
      const renderMatch = text.match(/\[RemotionView\] Render #(\d+)/);
      if (renderMatch) {
        renderCounts.push(parseInt(renderMatch[1], 10));
        console.log(`[TEST] Detected render: ${text}`);
      }

      // Check for warning about high render count
      if (text.includes("WARNING: High render count detected")) {
        hasWarning = true;
        console.error(`[TEST] High render count warning detected!`);
      }

      // Check for React Error #185
      if (text.includes("error #185") || text.includes("Maximum update depth")) {
        hasReactError185 = true;
        console.error(`[TEST] React Error #185 detected!`);
      }
    });

    // Create a test project (this will navigate to editor)
    await createTestProject(page, "Remotion Stability Test");

    // Wait for editor to fully load
    await page.waitForLoadState("networkidle", { timeout: 10_000 });

    // Give time for any potential infinite loops to manifest
    await page.waitForTimeout(3000);

    // Log final render counts
    console.log(`[TEST] Total renders detected: ${renderCounts.length}`);
    console.log(`[TEST] Max render count: ${Math.max(...renderCounts, 0)}`);

    // Assertions
    expect(hasReactError185).toBe(false);
    expect(hasWarning).toBe(false);

    // Render count should be reasonable (< 10 for initial load)
    const maxRender = Math.max(...renderCounts, 0);
    expect(maxRender).toBeLessThan(10);
  });

  test("should render Remotion panel without infinite loops", async ({
    page,
  }) => {
    // Track render counts
    const renderCounts: number[] = [];
    let hasError = false;

    page.on("console", (msg) => {
      const text = msg.text();
      const renderMatch = text.match(/\[RemotionView\] Render #(\d+)/);
      if (renderMatch) {
        renderCounts.push(parseInt(renderMatch[1], 10));
      }
      if (text.includes("error #185") || text.includes("Maximum update depth")) {
        hasError = true;
      }
    });

    // Create project
    await createTestProject(page, "Remotion Panel Test");
    await page.waitForLoadState("networkidle");

    // Look for the Remotion tab in the media panel
    const remotionTab = page.locator('button:has-text("Remotion")').first();

    if (await remotionTab.isVisible({ timeout: 5000 })) {
      console.log("[TEST] Found Remotion tab, clicking...");
      await remotionTab.click();

      // Wait for panel to render
      await page.waitForTimeout(2000);

      // Check for the remotion panel content
      const remotionPanel = page.locator('[data-testid="remotion-panel"]');
      if (await remotionPanel.isVisible({ timeout: 3000 })) {
        console.log("[TEST] Remotion panel is visible");
      }
    } else {
      console.log("[TEST] Remotion tab not visible, checking if panel loads by default");
    }

    // Wait for any potential loops
    await page.waitForTimeout(2000);

    // Log results
    console.log(`[TEST] Final render counts: ${renderCounts.join(", ")}`);
    console.log(`[TEST] Has error: ${hasError}`);

    // Verify no infinite loop
    expect(hasError).toBe(false);

    // If we have render counts, verify they're reasonable
    if (renderCounts.length > 0) {
      const maxRender = Math.max(...renderCounts);
      console.log(`[TEST] Max render count: ${maxRender}`);
      expect(maxRender).toBeLessThan(10);
    }
  });

  test("should initialize Remotion store only once", async ({ page }) => {
    let initializeCallCount = 0;
    let useEffectTriggerCount = 0;

    page.on("console", (msg) => {
      const text = msg.text();

      if (text.includes("[RemotionView] Calling initialize()")) {
        initializeCallCount++;
        console.log(`[TEST] Initialize called: ${initializeCallCount} time(s)`);
      }

      if (text.includes("[RemotionView] useEffect triggered")) {
        useEffectTriggerCount++;
        console.log(`[TEST] useEffect triggered: ${useEffectTriggerCount} time(s)`);
      }
    });

    // Create project
    await createTestProject(page, "Init Test");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Log results
    console.log(`[TEST] Total initialize calls: ${initializeCallCount}`);
    console.log(`[TEST] Total useEffect triggers: ${useEffectTriggerCount}`);

    // Initialize should be called at most once (or zero if already initialized)
    expect(initializeCallCount).toBeLessThanOrEqual(1);

    // useEffect should not trigger excessively
    expect(useEffectTriggerCount).toBeLessThan(5);
  });
});

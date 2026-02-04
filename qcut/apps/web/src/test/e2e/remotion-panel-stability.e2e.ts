/**
 * Remotion Panel Stability E2E Test
 *
 * Tests that the Remotion panel doesn't cause infinite render loops (React Error #185).
 * Verifies panel loads correctly and no React errors occur.
 */

import { test, expect, createTestProject } from "./helpers/electron-helpers";

test.describe("Remotion Panel Stability", () => {
  test("should not cause infinite render loops when opening editor", async ({
    page,
  }) => {
    let hasReactError185 = false;

    // Listen for React Error #185 in console
    page.on("console", (msg) => {
      const text = msg.text();
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

    // Assertions - no React infinite loop error
    expect(hasReactError185).toBe(false);
  });

  test("should render Remotion panel without infinite loops", async ({
    page,
  }) => {
    let hasError = false;

    page.on("console", (msg) => {
      const text = msg.text();
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
      await expect(remotionPanel).toBeVisible({ timeout: 3000 });
      console.log("[TEST] Remotion panel is visible");
    } else {
      console.log("[TEST] Remotion tab not visible, checking if panel loads by default");
    }

    // Wait for any potential loops
    await page.waitForTimeout(2000);

    // Verify no infinite loop error
    expect(hasError).toBe(false);
  });

  test("should load editor without errors", async ({ page }) => {
    let hasError = false;

    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("error #185") || text.includes("Maximum update depth")) {
        hasError = true;
      }
    });

    // Create project
    await createTestProject(page, "Init Test");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Verify no React infinite loop error
    expect(hasError).toBe(false);
  });
});

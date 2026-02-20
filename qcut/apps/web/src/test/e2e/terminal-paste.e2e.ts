/**
 * Terminal Paste E2E Test
 *
 * Tests the terminal UI and navigation. The actual paste functionality
 * was fixed in terminal-emulator.tsx to prevent double-paste bug when
 * xterm.js handled paste through both keyboard events and native paste events.
 *
 * Note: PTY-dependent tests are skipped by default since PTY spawning
 * may not work reliably in all E2E test environments.
 *
 * @see https://github.com/donghaozhang/qcut/pull/108
 */

import { test, expect, createTestProject } from "./helpers/electron-helpers";

/**
 * Helper to navigate to the Terminal tab in the media panel
 * The tab might be in a scrollable area, so we scroll to make it visible first
 */
async function navigateToTerminalTab(page: import("@playwright/test").Page) {
  try {
    const agentsGroup = page.getByTestId("group-agents");
    const legacyToolsGroup = page.getByTestId("group-tools");
    if (await agentsGroup.isVisible()) {
      await agentsGroup.click({ timeout: 5000 });
    } else {
      await legacyToolsGroup.click({ timeout: 5000 });
    }

    // Click on the PTY terminal tab
    const ptyTab = page.getByTestId("pty-panel-tab");
    await ptyTab.click({ timeout: 5000 });

    // Wait for terminal view to be visible
    await page.waitForSelector('[data-testid="pty-terminal-view"]', {
      timeout: 5000,
      state: "visible",
    });
  } catch (error) {
    throw new Error(
      `Failed to navigate to PTY terminal tab: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

test.describe("Terminal Paste Functionality", () => {
  test.beforeEach(async ({ page }) => {
    // Create a test project to access the editor
    await createTestProject(page, "Terminal Paste Test");
  });

  test("should navigate to terminal tab", async ({ page }) => {
    // Navigate to terminal tab
    await navigateToTerminalTab(page);

    // Verify terminal view is visible
    await expect(page.getByTestId("pty-terminal-view")).toBeVisible({
      timeout: 5000,
    });

    // Verify start button is present (terminal is disconnected)
    await expect(page.getByTestId("terminal-start-button")).toBeVisible();

    // Verify initial status is disconnected
    await expect(page.getByTestId("terminal-status")).toHaveAttribute(
      "data-status",
      "disconnected"
    );
  });

  test("should display terminal UI elements correctly", async ({ page }) => {
    // Navigate to terminal tab
    await navigateToTerminalTab(page);

    // Verify all expected UI elements are present
    await expect(page.getByTestId("pty-terminal-view")).toBeVisible();
    await expect(page.getByTestId("terminal-provider-selector")).toBeVisible();
    await expect(page.getByTestId("terminal-start-button")).toBeVisible();
    await expect(page.getByTestId("terminal-status")).toBeVisible();

    // Verify provider selector has options
    await page.getByTestId("terminal-provider-selector").click();
    await expect(page.getByRole("option", { name: /Shell/i })).toBeVisible();

    // Close dropdown
    await page.keyboard.press("Escape");
  });

  test("should auto-expand panel width when terminal tab is active", async ({
    page,
  }) => {
    await navigateToTerminalTab(page);
    await expect(page.getByTestId("pty-terminal-view")).toBeVisible();

    let metrics:
      | {
          viewportWidth: number;
          mediaPanelWidth: number;
          mediaPanelRatio: number;
        }
      | { error: string };
    try {
      metrics = await page.evaluate(() => {
        const mediaPanel = document.querySelector(
          '[data-testid="media-panel"]'
        ) as HTMLElement | null;

        if (!mediaPanel) {
          return { error: "Missing media panel element" };
        }

        const viewportWidth = window.innerWidth;
        const mediaPanelWidth = mediaPanel.getBoundingClientRect().width;
        const mediaPanelRatio = mediaPanelWidth / viewportWidth;
        return { viewportWidth, mediaPanelWidth, mediaPanelRatio };
      });
    } catch (error) {
      throw new Error(
        `Failed to measure terminal panel width: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if ("error" in metrics) {
      throw new Error(metrics.error);
    }

    expect(metrics.mediaPanelRatio).toBeGreaterThan(0.45);
  });

  // PTY-dependent tests - skipped by default since PTY may not be available in CI
  // Set PTY_AVAILABLE=true in your environment to run these tests
  test.describe("PTY Terminal Session (requires PTY support)", () => {
    test.skip(
      () => process.env.PTY_AVAILABLE !== "true",
      "Requires PTY support (set PTY_AVAILABLE=true to run)"
    );

    test("should start and stop shell terminal session", async ({ page }) => {
      await navigateToTerminalTab(page);

      // Select Shell provider
      await page.getByTestId("terminal-provider-selector").click();
      await page.getByRole("option", { name: /Shell/i }).click();

      // Start the terminal
      await page.getByTestId("terminal-start-button").click();

      // Wait for terminal to connect
      await expect(page.getByTestId("terminal-status")).toHaveAttribute(
        "data-status",
        "connected",
        { timeout: 15_000 }
      );

      // Verify terminal emulator is rendered
      await expect(page.getByTestId("terminal-emulator")).toBeVisible();

      // Stop the terminal
      await page.getByTestId("terminal-stop-button").click();

      // Verify terminal disconnected
      await expect(page.getByTestId("terminal-status")).toHaveAttribute(
        "data-status",
        "disconnected",
        { timeout: 5000 }
      );
    });

    test("should fill terminal width after auto-expand", async ({ page }) => {
      await navigateToTerminalTab(page);

      await page.getByTestId("terminal-provider-selector").click();
      await page.getByRole("option", { name: /Shell/i }).click();
      await page.getByTestId("terminal-start-button").click();

      await page.waitForTimeout(1500);
      const terminalStatus = await page
        .getByTestId("terminal-status")
        .getAttribute("data-status");

      let metrics:
        | {
            mediaPanelWidth: number;
            ptyViewWidth: number;
            ptyViewRatio: number;
            terminalEmulatorWidth: number;
            emulatorToPanelRatio: number;
            xtermScreenWidth: number | null;
            xtermCanvasWidth: number | null;
          }
        | { error: string };

      try {
        metrics = await page.evaluate(() => {
          const mediaPanel = document.querySelector(
            '[data-testid="media-panel"]'
          ) as HTMLElement | null;
          const ptyView = document.querySelector(
            '[data-testid="pty-terminal-view"]'
          ) as HTMLElement | null;
          const terminalEmulator = document.querySelector(
            '[data-testid="terminal-emulator"]'
          ) as HTMLElement | null;
          const xtermScreen = document.querySelector(
            ".xterm-screen"
          ) as HTMLElement | null;
          const xtermCanvas = document.querySelector(
            ".xterm-screen canvas"
          ) as HTMLCanvasElement | null;

          if (!mediaPanel || !ptyView) {
            return { error: "Missing media panel or terminal view element" };
          }

          const mediaPanelWidth = mediaPanel.getBoundingClientRect().width;
          const ptyViewWidth = ptyView.getBoundingClientRect().width;
          const terminalEmulatorWidth =
            terminalEmulator?.getBoundingClientRect().width ?? 0;

          return {
            mediaPanelWidth,
            ptyViewWidth,
            ptyViewRatio: ptyViewWidth / mediaPanelWidth,
            terminalEmulatorWidth,
            emulatorToPanelRatio: terminalEmulatorWidth / mediaPanelWidth,
            xtermScreenWidth:
              xtermScreen?.getBoundingClientRect().width ?? null,
            xtermCanvasWidth:
              xtermCanvas?.getBoundingClientRect().width ?? null,
          };
        });
      } catch (error) {
        throw new Error(
          `Failed to measure terminal layout: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      if ("error" in metrics) {
        throw new Error(metrics.error);
      }

      expect(metrics.ptyViewRatio).toBeGreaterThan(0.95);

      if (terminalStatus === "connected") {
        expect(metrics.emulatorToPanelRatio).toBeGreaterThan(0.95);

        if (
          metrics.xtermScreenWidth !== null &&
          metrics.terminalEmulatorWidth
        ) {
          const screenToEmulatorRatio =
            metrics.xtermScreenWidth / metrics.terminalEmulatorWidth;
          expect(screenToEmulatorRatio).toBeGreaterThan(0.9);
        }

        if (
          metrics.xtermCanvasWidth !== null &&
          metrics.terminalEmulatorWidth
        ) {
          const canvasToEmulatorRatio =
            metrics.xtermCanvasWidth / metrics.terminalEmulatorWidth;
          expect(canvasToEmulatorRatio).toBeGreaterThan(0.82);
        }
      }
    });

    test("should paste text only once in terminal (no double-paste bug)", async ({
      page,
    }) => {
      await navigateToTerminalTab(page);

      // Start shell terminal
      await page.getByTestId("terminal-provider-selector").click();
      await page.getByRole("option", { name: /Shell/i }).click();
      await page.getByTestId("terminal-start-button").click();

      await expect(page.getByTestId("terminal-status")).toHaveAttribute(
        "data-status",
        "connected",
        { timeout: 15_000 }
      );

      const terminalEmulator = page.getByTestId("terminal-emulator");
      await expect(terminalEmulator).toBeVisible();
      await page.waitForTimeout(1500);

      // Set clipboard and paste
      const testText = "echo PASTE_TEST_UNIQUE_STRING";
      await page.evaluate(async (text) => {
        await navigator.clipboard.writeText(text);
      }, testText);

      await terminalEmulator.click();
      await page.waitForTimeout(200);
      await page.keyboard.press("Control+v");
      await page.waitForTimeout(500);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1500);

      // Check terminal text
      const terminalText = await page.evaluate(() => {
        const rows = document.querySelectorAll(".xterm-rows > div");
        let text = "";
        rows.forEach((row) => {
          text += row.textContent + "\n";
        });
        return text;
      });

      const matches = terminalText.match(/PASTE_TEST_UNIQUE_STRING/g) || [];

      // Should NOT appear 3+ times (double paste bug)
      expect(matches.length).toBeLessThanOrEqual(2);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});

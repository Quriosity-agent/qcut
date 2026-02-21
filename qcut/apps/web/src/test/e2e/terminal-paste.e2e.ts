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
		// PTY tab lives inside the "Tools" group, so ensure that group is active first
		const toolsGroup = page.getByTestId("group-agents");
		await toolsGroup.click({ timeout: 5000 });

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

		// Terminal may auto-connect, so check for either start button or stop/restart button
		const startButton = page.getByTestId("terminal-start-button");
		const stopButton = page.getByTestId("terminal-stop-button");
		const restartButton = page.getByTestId("terminal-restart-button");
		const hasStart = await startButton
			.isVisible({ timeout: 2000 })
			.catch(() => false);
		const hasStop = await stopButton
			.isVisible({ timeout: 1000 })
			.catch(() => false);
		const hasRestart = await restartButton
			.isVisible({ timeout: 1000 })
			.catch(() => false);
		// At least one control button should be visible
		expect(hasStart || hasStop || hasRestart).toBeTruthy();

		// Verify terminal status is present (could be connected or disconnected)
		await expect(page.getByTestId("terminal-status")).toBeVisible();
	});

	test("should display terminal UI elements correctly", async ({ page }) => {
		// Navigate to terminal tab
		await navigateToTerminalTab(page);

		// Verify all expected UI elements are present
		await expect(page.getByTestId("pty-terminal-view")).toBeVisible();
		await expect(page.getByTestId("terminal-provider-selector")).toBeVisible();
		await expect(page.getByTestId("terminal-status")).toBeVisible();

		// Terminal may auto-connect, check for any control button
		const startButton = page.getByTestId("terminal-start-button");
		const stopButton = page.getByTestId("terminal-stop-button");
		const restartButton = page.getByTestId("terminal-restart-button");
		const hasAnyButton =
			(await startButton.isVisible({ timeout: 1000 }).catch(() => false)) ||
			(await stopButton.isVisible({ timeout: 1000 }).catch(() => false)) ||
			(await restartButton.isVisible({ timeout: 1000 }).catch(() => false));
		expect(hasAnyButton).toBeTruthy();
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

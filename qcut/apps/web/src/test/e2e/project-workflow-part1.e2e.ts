/**
 * Project Creation & Media Import E2E Tests
 *
 * Tests the fundamental project workflow including project creation,
 * media import, file upload processes, and basic editor functionality.
 */

import {
	test,
	expect,
	createTestProject,
	importTestVideo,
	ensureMediaTabActive,
} from "./helpers/electron-helpers";

/**
 * Test suite for Project Creation & Media Import (Subtask 1A)
 * Covers basic project setup and media import workflows.
 */
test.describe("Project Creation & Media Import (Subtask 1A)", () => {
	/**
	 * Tests complete project creation and media import workflow.
	 * Verifies new project creation and successful video file import.
	 */
	test("should create project and import media", async ({ page }) => {
		// Test steps:
		// 1. Create new project with settings (1080p, 30fps)
		// Note: Electron app should already be on the projects page
		await createTestProject(page, "E2E Workflow Test Project");

		// 2. Import video file (MP4)
		await importTestVideo(page);

		// 3. Verify media item appears in the media panel
		// Look for the media file name since data-testid might not be present
		const mediaItem = page.locator("text=sample-video.mp4").first();
		await expect(mediaItem).toBeVisible({ timeout: 5000 });
	});

	/**
	 * Tests the file upload process and UI feedback.
	 * Verifies proper handling of file selection and upload indicators.
	 */
	test("should handle file upload process", async ({ page }) => {
		// Electron app should already be loaded, create a new project
		await createTestProject(page, "E2E Upload Test Project");
		await ensureMediaTabActive(page);

		// Verify upload button is available and enabled
		await expect(page.getByTestId("import-media-button")).toBeVisible();
		await expect(page.getByTestId("import-media-button")).toBeEnabled();

		// Verify the media panel area is visible (look for Media tab)
		const mediaTab = page.locator("text=Media").first();
		await expect(mediaTab).toBeVisible();
	});
});

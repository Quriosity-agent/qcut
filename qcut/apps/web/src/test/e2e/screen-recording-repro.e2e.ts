import { access } from "node:fs/promises";
import {
	createTestProject,
	expect,
	startScreenRecordingForE2E,
	stopScreenRecordingForE2E,
	test,
} from "./helpers/electron-helpers";

test.describe("Screen Recording Repro", () => {
	test("should start and stop recording via bridge", async ({ page }) => {
		try {
			await createTestProject(page, "Screen Recording Repro");

			const recordingToggleButton = page.getByTestId(
				"screen-recording-toggle-button"
			);
			await expect(recordingToggleButton).toBeVisible({ timeout: 10_000 });

			const statusBefore = await page.evaluate(async () => {
				try {
					const recordingApi = window.electronAPI?.screenRecording;
					if (!recordingApi) {
						throw new Error(
							"window.electronAPI.screenRecording is unavailable"
						);
					}
					return await recordingApi.getStatus();
				} catch (error) {
					throw new Error(
						`Failed to read pre-start status: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			});
			expect(statusBefore.recording).toBe(false);

			const startResult = await startScreenRecordingForE2E(page);
			expect(startResult.sessionId.length).toBeGreaterThan(0);
			expect(startResult.filePath).toContain(".mp4");

			await page.waitForTimeout(2200);

			const stopResult = await stopScreenRecordingForE2E(page);
			expect(stopResult.success).toBe(true);
			expect(stopResult.discarded).toBe(false);
			expect(stopResult.bytesWritten).toBeGreaterThan(0);

			if (!stopResult.filePath) {
				throw new Error("stopRecording returned an empty filePath");
			}

			await access(stopResult.filePath);
		} catch (error) {
			throw new Error(
				`Screen recording repro flow failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	});
});

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";
import { stubExportSaveDialog } from "./electron-helpers";

export async function exportPortraitReference({
	app,
	page,
	output,
	name,
}: {
	app: ElectronApplication;
	page: Page;
	output: string;
	name: string;
}) {
	const exportPath = path.join(output, `${name}-${Date.now()}.mp4`);
	await stubExportSaveDialog({ electronApp: app, outputPath: exportPath });
	await page.getByTestId("export-button").click();
	const audio = page.getByRole("checkbox", { name: "Include audio in export" });
	if (await audio.count()) await audio.uncheck();
	await page.getByTestId("export-start-button").click();
	await expect
		.poll(
			async () => (await stat(exportPath).catch(() => ({ size: 0 }))).size,
			{ timeout: 180_000 }
		)
		.toBeGreaterThan(1_000);
	await expect(page.getByTestId("export-progress-bar")).toHaveCount(0, {
		timeout: 180_000,
	});
	if (!ffmpegPath) throw new Error("FFmpeg unavailable");
	const run = promisify(execFile);
	const { stdout } = await run(
		ffmpegPath,
		[
			"-v",
			"error",
			"-xerror",
			"-i",
			exportPath,
			"-map",
			"0:v:0",
			"-an",
			"-f",
			"framemd5",
			"-",
		],
		{ timeout: 30_000 }
	);
	const decodedFrames = stdout
		.split("\n")
		.filter((line) => line.trim() && !line.startsWith("#")).length;
	expect(decodedFrames).toBe(30);
	await run(
		ffmpegPath,
		[
			"-y",
			"-v",
			"error",
			"-i",
			exportPath,
			"-frames:v",
			"1",
			path.join(output, "export-frame.png"),
		],
		{ timeout: 30_000 }
	);
	await page.screenshot({
		path: path.join(output, `${name}-export-ui.png`),
		animations: "disabled",
	});
	return { exportPath, decodedFrames };
}

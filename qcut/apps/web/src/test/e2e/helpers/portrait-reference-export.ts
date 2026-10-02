import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";
import { getFFprobePath } from "../../../../../../electron/ffmpeg/paths";
import { stubExportSaveDialog } from "./electron-helpers";

export async function exportPortraitReference({
	app,
	page,
	output,
	name,
	expectedFrames = 30,
}: {
	app: ElectronApplication;
	page: Page;
	output: string;
	name: string;
	expectedFrames?: number;
}) {
	const exportPath = path.join(output, `${name}-${Date.now()}.mp4`);
	await stubExportSaveDialog({ electronApp: app, outputPath: exportPath });
	await page.getByTestId("export-button").click();
	await page.getByTestId("export-quality-select").getByRole("button").click();
	await page.locator('button[role="radio"][id="1080p"]').check();
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
	const probe = await run(
		await getFFprobePath(),
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=codec_name,width,height,pix_fmt,avg_frame_rate,duration,color_range,color_space,color_transfer,color_primaries",
			"-of",
			"json",
			exportPath,
		],
		{ timeout: 30_000 }
	);
	const metadata = JSON.parse(probe.stdout) as {
		streams: Array<Record<string, string | number>>;
	};
	const videoStream = metadata.streams[0];
	if (!videoStream) throw new Error("Missing exported video stream");
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
	expect(decodedFrames).toBe(expectedFrames);
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
	await page.bringToFront();
	await page.screenshot({
		path: path.join(output, `${name}-export-ui.png`),
		animations: "disabled",
	});
	return { exportPath, decodedFrames, videoStream };
}

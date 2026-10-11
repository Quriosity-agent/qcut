import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
	type ElectronApplication,
	expect,
	type Locator,
	type Page,
	test,
} from "@playwright/test";
import { stubExportSaveDialog } from "./helpers/e2e-export-helpers";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import {
	preparePortraitReferenceProject,
	type ReferenceWindow,
} from "./helpers/portrait-reference";

const source = process.env.QCUT_REAL_PORTRAIT_VIDEO_PATH;
const output = path.resolve(
	process.env.QCUT_PORTRAIT_INDEPENDENT_OUTPUT ??
		"output/playwright/portrait-independent-timeline"
);
const run = promisify(execFile);

interface PlaybackWindow extends ReferenceWindow {
	__playbackStore: {
		getState: () => {
			isPlaying: boolean;
			currentTime: number;
			play: () => void;
			pause: () => void;
			seek: (time: number) => void;
		};
	};
}

async function cachedFrames({ cache }: { cache: string }) {
	try {
		return (await readdir(cache)).filter((name) => name.endsWith(".json"))
			.length;
	} catch {
		return 0;
	}
}

async function enginePipelines() {
	try {
		const { stdout } = await run("pgrep", ["-f", "independent_pipeline.py"]);
		return stdout.trim().split("\n").filter(Boolean).length;
	} catch {
		// pgrep exits 1 when nothing matches.
		return 0;
	}
}

async function previewCommits({ page }: { page: Page }) {
	return page
		.getByTestId("color-preview-canvas")
		.evaluate((node) =>
			Number((node as HTMLCanvasElement).dataset.renderedFrameCount ?? 0)
		);
}

/**
 * Where the paused preview differs from its source frame. The reference is
 * fitted and resampled like the preview (cover fit at the processing size
 * within 1280, then the canvas), so only the engine's own change remains.
 * The fit uses the video's display size: this source has non-square pixels.
 */
async function engineChange({ page }: { page: Page }) {
	return page.getByTestId("color-preview-canvas").evaluate((node) => {
		const canvas = node as HTMLCanvasElement;
		const video = canvas.parentElement?.querySelector("video");
		if (!video) throw new Error("Missing preview source video");
		const scale = Math.min(1, 1280 / Math.max(canvas.width, canvas.height));
		const processing = document.createElement("canvas");
		processing.width = Math.round(canvas.width * scale);
		processing.height = Math.round(canvas.height * scale);
		const cover = Math.max(
			processing.width / video.videoWidth,
			processing.height / video.videoHeight
		);
		const drawWidth = video.videoWidth * cover;
		const drawHeight = video.videoHeight * cover;
		processing
			.getContext("2d", { willReadFrequently: true })
			?.drawImage(
				video,
				(processing.width - drawWidth) / 2,
				(processing.height - drawHeight) / 2,
				drawWidth,
				drawHeight
			);
		const reference = document.createElement("canvas");
		reference.width = canvas.width;
		reference.height = canvas.height;
		const referenceContext = reference.getContext("2d", {
			willReadFrequently: true,
		});
		const previewContext = canvas.getContext("2d", {
			willReadFrequently: true,
		});
		if (!referenceContext || !previewContext)
			throw new Error("Missing canvas context");
		referenceContext.drawImage(processing, 0, 0, canvas.width, canvas.height);
		const before = referenceContext.getImageData(
			0,
			0,
			canvas.width,
			canvas.height
		).data;
		const after = previewContext.getImageData(
			0,
			0,
			canvas.width,
			canvas.height
		).data;
		let changed = 0;
		let top = canvas.height;
		let bottom = -1;
		for (let index = 0; index < before.length; index += 4) {
			if (
				Math.abs(before[index] - after[index]) > 2 ||
				Math.abs(before[index + 1] - after[index + 1]) > 2 ||
				Math.abs(before[index + 2] - after[index + 2]) > 2
			) {
				changed += 1;
				const y = Math.floor(index / 4 / canvas.width);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
		}
		return {
			changed,
			total: canvas.width * canvas.height,
			top,
			bottom,
			canvas: [canvas.width, canvas.height],
			processing: [processing.width, processing.height],
		};
	});
}

/** Trims the clip's end so only `visible` seconds remain on the timeline. */
async function trimClip({ page, visible }: { page: Page; visible: number }) {
	await page.evaluate((length) => {
		const state = (
			window as unknown as PlaybackWindow
		).__timelineStore.getState();
		const track = state.tracks.find((candidate) =>
			candidate.elements.some((element) => element.type === "media")
		);
		const element = track?.elements.find(
			(candidate) => candidate.type === "media"
		);
		if (!track || !element) throw new Error("Missing portrait clip");
		state.updateElementTrim(track.id, element.id, 0, element.duration - length);
	}, visible);
}

async function setValue({
	panel,
	label,
	value,
}: {
	panel: Locator;
	label: string;
	value: number;
}) {
	const input = panel.getByLabel(`${label}数值`, { exact: true });
	await input.fill(String(value));
	await input.press("Tab");
	await expect(input).toHaveValue(String(value));
}

/** Closing the export dialog remounts the properties panel on its first tab. */
async function reopenEyeControls({
	page,
	panel,
}: {
	page: Page;
	panel: Locator;
}) {
	await page
		.getByTestId("media-properties")
		.getByRole("tab", { name: "美颜美体", exact: true })
		.click();
	const group = panel.getByRole("button", { name: "五官精修", exact: true });
	if ((await group.getAttribute("aria-expanded")) !== "true")
		await group.click();
	await expect(group).toHaveAttribute("aria-expanded", "true");
}

async function exportTimeline({
	app,
	page,
	file,
}: {
	app: ElectronApplication;
	page: Page;
	file: string;
}) {
	await rm(file, { force: true });
	await stubExportSaveDialog({ electronApp: app, outputPath: file });
	await page.getByTestId("export-button").click();
	await expect(page.getByTestId("export-dialog")).toBeVisible();
	const includeAudio = page.getByRole("checkbox", {
		name: "Include audio in export",
	});
	if ((await includeAudio.count()) > 0 && (await includeAudio.isChecked()))
		await includeAudio.click();
	const started = Date.now();
	await page.getByTestId("export-start-button").click();
	return { started };
}

async function waitForExport({
	page,
	file,
	started,
}: {
	page: Page;
	file: string;
	started: number;
}) {
	await expect
		.poll(
			async () => {
				try {
					return (await stat(file)).size;
				} catch {
					return 0;
				}
			},
			{ timeout: 240_000, intervals: [500, 1_000, 2_000] }
		)
		.toBeGreaterThan(1_000);
	const seconds = (Date.now() - started) / 1000;
	await expect(page.getByTestId("export-start-button")).toBeVisible({
		timeout: 30_000,
	});
	await page.getByRole("button", { name: "Close export dialog" }).click();
	return seconds;
}

test("independent portrait engine runs on timeline video: paused preview, cached export and cancel", async () => {
	test.skip(
		!source || !existsSync(source),
		"Set QCUT_REAL_PORTRAIT_VIDEO_PATH to a short real-person video; needs the native and independent runtimes"
	);
	test.setTimeout(900_000);
	if (!source) throw new Error("Missing real portrait video");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-portrait-independent-")
	);
	const cache = path.join(
		userDataDirectory,
		"Cache",
		"independent-beauty-frames"
	);
	const app = await startElectronApp({ userDataDirectory });
	const errors: string[] = [];
	try {
		const page = await getMainWindow(app);
		page.on("pageerror", (error) => errors.push(error.message));
		const { panel } = await preparePortraitReferenceProject({
			page,
			source,
			duration: 2,
			canvasSize: { width: 360, height: 640 },
		});
		// 1. Choose the independent engine; the panel states its speed.
		await panel
			.getByRole("combobox", { name: "美颜处理引擎", exact: true })
			.click();
		await page.getByRole("option", { name: "自研", exact: true }).click();
		await expect(page.getByTestId("portrait-engine-note")).toContainText(
			"每帧约 3–12 秒"
		);
		await expect(page.getByTestId("portrait-engine-runtime")).toHaveCount(0, {
			timeout: 120_000,
		});
		// 2. The pinned skin model has no 9:16 profile: whitening says so
		// instead of rendering natively or failing with a traceback.
		await panel.getByRole("button", { name: "皮肤管理", exact: true }).click();
		await setValue({ panel, label: "美白", value: 45 });
		await expect(page.getByText(/暂不支持这个画面比例/).first()).toBeVisible({
			timeout: 60_000,
		});
		await setValue({ panel, label: "美白", value: 0 });
		expect(await cachedFrames({ cache })).toBe(0);

		// 3. Face shaping runs on 9:16 frames.
		await setValue({ panel, label: "大眼", value: 60 });
		await expect(page.getByTestId("portrait-engine-issue")).toHaveCount(0);

		// 4. Paused: the preview shows the independent result after processing.
		await expect(page.getByTestId("independent-portrait-pending")).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByTestId("independent-portrait-pending")).toHaveCount(
			0,
			{ timeout: 120_000 }
		);
		expect(await cachedFrames({ cache })).toBe(1);
		const paused = await engineChange({ page });
		// Bigger eyes change a few thousand pixels, all in the upper (face) half.
		expect(paused.changed).toBeGreaterThan(200);
		expect(paused.changed / paused.total).toBeLessThan(0.05);
		expect(paused.bottom).toBeLessThan(paused.canvas[1] / 2);
		await page.screenshot({ path: path.join(output, "01-paused.png") });

		// 5. Playing: frames advance, but the engine is not asked for any of them.
		await page.evaluate(() =>
			(window as unknown as PlaybackWindow).__playbackStore.getState().play()
		);
		const playbackStart = await previewCommits({ page });
		await page.waitForTimeout(800);
		expect(await previewCommits({ page })).toBeGreaterThan(playbackStart);
		await expect(page.getByTestId("independent-portrait-pending")).toHaveCount(
			0
		);
		expect(await cachedFrames({ cache })).toBe(1);
		expect(await enginePipelines()).toBe(0);

		// 6. Paused again on a new frame: that frame is processed.
		await page.evaluate(() =>
			(window as unknown as PlaybackWindow).__playbackStore.getState().pause()
		);
		await expect(page.getByTestId("independent-portrait-pending")).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByTestId("independent-portrait-pending")).toHaveCount(
			0,
			{ timeout: 120_000 }
		);
		expect(await cachedFrames({ cache })).toBe(2);

		// 7. Export the first frames, then export again from the frame cache.
		await trimClip({ page, visible: 0.25 });
		await page.evaluate(() =>
			(window as unknown as PlaybackWindow).__playbackStore.getState().seek(0)
		);
		const first = path.join(output, "export-cold.mp4");
		const cold = await exportTimeline({ app, page, file: first });
		await expect(page.getByTestId("export-status")).toContainText(
			"自研美颜每帧约 3–12 秒",
			{ timeout: 120_000 }
		);
		const coldSeconds = await waitForExport({
			page,
			file: first,
			started: cold.started,
		});
		const afterCold = await cachedFrames({ cache });
		expect(afterCold).toBeGreaterThanOrEqual(2 + 5);
		const second = path.join(output, "export-cached.mp4");
		const warm = await exportTimeline({ app, page, file: second });
		const warmSeconds = await waitForExport({
			page,
			file: second,
			started: warm.started,
		});
		expect(await cachedFrames({ cache })).toBe(afterCold);
		expect(warmSeconds).toBeLessThan(coldSeconds / 3);

		// 8. A changed edit misses the cache; cancelling stops the engine job.
		await reopenEyeControls({ page, panel });
		await setValue({ panel, label: "大眼", value: 70 });
		await expect(page.getByTestId("independent-portrait-pending")).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByTestId("independent-portrait-pending")).toHaveCount(
			0,
			{ timeout: 120_000 }
		);
		const beforeCancel = await cachedFrames({ cache });
		const cancelled = path.join(output, "export-cancelled.mp4");
		await exportTimeline({ app, page, file: cancelled });
		await expect
			.poll(() => cachedFrames({ cache }), { timeout: 120_000 })
			.toBeGreaterThan(beforeCancel);
		await expect.poll(enginePipelines, { timeout: 30_000 }).toBe(1);
		await page.getByRole("button", { name: "Cancel Export" }).click();
		await expect(page.getByTestId("export-start-button")).toBeVisible({
			timeout: 30_000,
		});
		await expect.poll(enginePipelines, { timeout: 15_000 }).toBe(0);
		const afterCancel = await cachedFrames({ cache });
		await page.waitForTimeout(15_000);
		expect(await cachedFrames({ cache })).toBe(afterCancel);
		expect(existsSync(cancelled)).toBe(false);

		await writeFile(
			path.join(output, "e2e-evidence.json"),
			`${JSON.stringify(
				{
					source: path.basename(source),
					pausedPreview: paused,
					coldExportSeconds: coldSeconds,
					cachedExportSeconds: warmSeconds,
					cachedFramesAfterColdExport: afterCold,
					cachedFramesAfterCancel: afterCancel,
				},
				null,
				2
			)}\n`,
			"utf8"
		);
		expect(errors).toEqual([]);
	} finally {
		await app.close();
		await rm(userDataDirectory, { recursive: true, force: true });
	}
});

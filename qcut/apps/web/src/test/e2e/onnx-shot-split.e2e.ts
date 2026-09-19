import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import type { MediaElement, TimelineTrack } from "../../types/timeline";
import type { TProject } from "../../types/project";
import {
	getFFmpegPath,
	getFFprobePath,
} from "../../../../../electron/ffmpeg/paths";
import {
	createTestProject,
	expect,
	startElectronApp,
	stubExportSaveDialog,
	test as qcutTest,
	uploadTestMedia,
} from "./helpers/electron-helpers";

const execFileAsync = promisify(execFile);
const sourcePath = process.env.QCUT_ONNX_SHOT_E2E_SOURCE ?? "";
const contractPath = process.env.QCUT_JIANYING_SHOT_SPLIT_ONNX_CONTRACT ?? "";
const pythonPath = process.env.QCUT_JIANYING_SHOT_SPLIT_ONNX_PYTHON ?? "";
const enabled = [sourcePath, contractPath, pythonPath].every(
	(filePath) => filePath && path.isAbsolute(filePath) && existsSync(filePath)
);

interface HarnessWindow extends Window {
	__timelineStore: {
		getState: () => {
			tracks: TimelineTrack[];
			history: unknown[];
			saveImmediate: () => Promise<void>;
			updateElementStartTime: (
				trackId: string,
				elementId: string,
				startTime: number
			) => void;
		};
	};
	__projectStore: {
		getState: () => {
			activeProject: TProject | null;
			updateProjectFps: (fps: number) => Promise<void>;
			updateProjectCanvasSize: (
				size: { width: number; height: number },
				mode: "custom"
			) => Promise<void>;
		};
	};
	__editorStore: {
		getState: () => {
			setCanvasSize: (
				size: { width: number; height: number },
				mode: "custom"
			) => void;
		};
	};
	__playbackStore: { getState: () => { seek: (time: number) => void } };
	__exportStore: {
		getState: () => {
			error: string | null;
			progress: { isExporting: boolean };
		};
	};
}

interface SceneTaskEvidence {
	id: string;
	status: string;
	error?: string;
	payload: { engine?: string };
	output?: { engine?: string; route?: string; createdElementIds?: string[] };
}

const test = qcutTest.extend({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
	electronApp: async ({}, use, testInfo) => {
		const workspace = testInfo.outputPath("workspace");
		const documents = path.join(workspace, "documents");
		await mkdir(documents, { recursive: true });
		const electronApp = await startElectronApp({
			userDataDirectory: path.join(workspace, "profile"),
		});
		try {
			await electronApp.evaluate(({ app, BrowserWindow }, directory) => {
				app.setPath("documents", directory);
				BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000);
			}, documents);
			await use(electronApp);
		} finally {
			await electronApp.close();
		}
	},
});

test.use({ captureScreenshotVideo: false });
test.setTimeout(240_000);

async function readTimeline({ page }: { page: Page }) {
	return page.evaluate(() => {
		const state = (
			window as unknown as HarnessWindow
		).__timelineStore.getState();
		return { tracks: state.tracks, historyLength: state.history.length };
	});
}

async function readTask({
	page,
}: {
	page: Page;
}): Promise<SceneTaskEvidence | undefined> {
	return page.evaluate(() => {
		const value = JSON.parse(
			localStorage.getItem("qcut-cloud-tasks-v1") ?? "{}"
		);
		return value.state?.tasks?.find(
			(task: { kind: string }) => task.kind === "scene-detection"
		);
	});
}

async function imageChannelDeviation({
	filePath,
}: {
	filePath: string;
}): Promise<number[]> {
	const { stdout } = await execFileAsync(
		getFFmpegPath(),
		[
			"-v",
			"error",
			"-i",
			filePath,
			"-frames:v",
			"1",
			"-vf",
			"scale=128:72",
			"-pix_fmt",
			"rgb24",
			"-f",
			"rawvideo",
			"-",
		],
		{ encoding: "buffer", timeout: 15_000 }
	);
	expect(stdout.length).toBe(128 * 72 * 3);
	const sums = [0, 0, 0];
	const squares = [0, 0, 0];
	for (let index = 0; index < stdout.length; index += 1) {
		const channel = index % 3;
		sums[channel] += stdout[index];
		squares[channel] += stdout[index] ** 2;
	}
	const pixels = stdout.length / 3;
	return sums.map((sum, channel) =>
		Math.sqrt(Math.max(0, squares[channel] / pixels - (sum / pixels) ** 2))
	);
}

async function prepareMontage({ page }: { page: Page }) {
	await createTestProject(page, "ONNX Shot Split Real E2E");
	await uploadTestMedia(page, sourcePath);
	const media = page.getByTestId("media-item").first();
	await media.dragTo(page.getByTestId("timeline-track").first());
	await expect(page.getByTestId("timeline-element")).toHaveCount(1);
	await page.evaluate(async () => {
		const stores = window as unknown as HarnessWindow;
		await stores.__projectStore.getState().updateProjectFps(24);
		const size = { width: 640, height: 360 };
		stores.__editorStore.getState().setCanvasSize(size, "custom");
		await stores.__projectStore
			.getState()
			.updateProjectCanvasSize(size, "custom");
	});
	return page.getByTestId("timeline-element").first();
}

test.describe("Private ONNX scene split through the real Electron editor", () => {
	test.skip(
		!enabled,
		"Requires absolute QCUT_ONNX_SHOT_E2E_SOURCE (6s/four-scene montage), ONNX contract, and Python runtime paths"
	);

	test("detects four shots, previews each, undoes, saves, reloads, and exports", async ({
		page,
		electronApp,
	}, testInfo) => {
		const runtime = await execFileAsync(pythonPath, [
			"-c",
			"import importlib.util,json,onnxruntime; print(json.dumps({'torch_present':importlib.util.find_spec('torch') is not None,'onnxruntime':onnxruntime.__version__}))",
		]);
		const runtimeEvidence = JSON.parse(runtime.stdout);
		expect(runtimeEvidence.torch_present).toBe(false);
		const clip = await prepareMontage({ page });
		const before = await readTimeline({ page });
		await clip.click({ button: "right" });
		const menuItem = page.getByTestId("onnx-shot-split-menu-item");
		await menuItem.scrollIntoViewIfNeeded();
		await page.screenshot({ path: testInfo.outputPath("01-onnx-menu.png") });
		await menuItem.click();
		await expect
			.poll(
				async () => {
					const task = await readTask({ page });
					if (task?.status === "failed") throw new Error(task.error);
					return task?.status;
				},
				{ timeout: 60_000 }
			)
			.toBe("completed");
		const task = await readTask({ page });
		expect(task).toMatchObject({
			payload: { engine: "onnx" },
			output: { engine: "onnx", route: "qcut-jianying-shot-split-onnx-v1" },
		});
		await expect(page.getByTestId("timeline-element")).toHaveCount(4);
		const split = await readTimeline({ page });
		const elements = split.tracks
			.flatMap((track) => track.elements)
			.filter((element): element is MediaElement => element.type === "media");
		expect(elements.map((element) => element.startTime)).toEqual([
			0, 1.5, 3, 4.5,
		]);
		expect(split.historyLength).toBe(before.historyLength + 1);
		await page.screenshot({ path: testInfo.outputPath("02-four-shots.png") });

		const previewEvidence: Array<{
			time: number;
			sha256: string;
			stdev: number[];
		}> = [];
		await [0.5, 2, 3.5, 5].reduce(async (previous, time, index) => {
			await previous;
			await page.evaluate(
				(seekTime) =>
					(window as unknown as HarnessWindow).__playbackStore
						.getState()
						.seek(seekTime),
				time
			);
			await expect
				.poll(() =>
					page
						.getByTestId("preview-capture-surface")
						.locator("video")
						.evaluateAll(
							(videos, expectedTime) =>
								videos.some((node) => {
									const video = node as HTMLVideoElement;
									return (
										video.readyState >= 2 &&
										!video.seeking &&
										Math.abs(video.currentTime - expectedTime) < 0.15
									);
								}),
							time
						)
				)
				.toBe(true);
			const filePath = testInfo.outputPath(`preview-${index + 1}.png`);
			const screenshot = await page
				.getByTestId("preview-capture-surface")
				.screenshot({ path: filePath });
			const stdev = await imageChannelDeviation({ filePath });
			expect(Math.max(...stdev)).toBeGreaterThan(5);
			previewEvidence.push({
				time,
				sha256: createHash("sha256").update(screenshot).digest("hex"),
				stdev,
			});
		}, Promise.resolve());
		expect(new Set(previewEvidence.map((frame) => frame.sha256)).size).toBe(4);

		await page.getByTestId("timeline-undo-button").click();
		await expect(page.getByTestId("timeline-element")).toHaveCount(1);
		expect((await readTimeline({ page })).tracks).toEqual(before.tracks);
		await page.screenshot({ path: testInfo.outputPath("03-undo.png") });
		await page.getByTestId("timeline-redo-button").click();
		await expect(page.getByTestId("timeline-element")).toHaveCount(4);
		await page.evaluate(() =>
			(window as unknown as HarnessWindow).__timelineStore
				.getState()
				.saveImmediate()
		);
		await page.reload();
		await expect(page.getByTestId("timeline-element")).toHaveCount(4);
		const reloaded = await readTimeline({ page });
		expect(reloaded.tracks).toEqual(split.tracks);
		await page.screenshot({ path: testInfo.outputPath("04-reloaded.png") });

		const exportPath = testInfo.outputPath("onnx-four-shots.mp4");
		await stubExportSaveDialog({ electronApp, outputPath: exportPath });
		await page.getByTestId("export-button").click();
		await expect(page.getByTestId("export-dialog")).toBeVisible();
		await page
			.getByTestId("export-frame-rate-select")
			.locator("button")
			.click();
		await page
			.getByRole("radio", { name: "24 fps", exact: true })
			.locator("..")
			.click();
		await page.getByTestId("export-start-button").click();
		await expect
			.poll(
				async () => {
					const state = await page.evaluate(() => {
						const state = (
							window as unknown as HarnessWindow
						).__exportStore.getState();
						return {
							error: state.error,
							isExporting: state.progress.isExporting,
						};
					});
					if (state.error) throw new Error(state.error);
					return (
						!state.isExporting &&
						existsSync(exportPath) &&
						(await stat(exportPath)).size > 1000
					);
				},
				{ timeout: 180_000 }
			)
			.toBe(true);
		await page.screenshot({
			path: testInfo.outputPath("05-export-complete.png"),
		});
		const probe = await execFileAsync(await getFFprobePath(), [
			"-v",
			"error",
			"-show_streams",
			"-show_format",
			"-of",
			"json",
			exportPath,
		]);
		const exported = JSON.parse(probe.stdout);
		expect(Number(exported.format.duration)).toBeCloseTo(6, 1);
		expect(
			exported.streams.find(
				(stream: { codec_type: string }) => stream.codec_type === "video"
			)
		).toMatchObject({ codec_name: "h264", r_frame_rate: "24/1" });
		await execFileAsync(
			getFFmpegPath(),
			["-v", "error", "-i", exportPath, "-f", "null", "-"],
			{ timeout: 60_000 }
		);
		await writeFile(
			testInfo.outputPath("evidence.json"),
			JSON.stringify(
				{
					inference: "real local ONNX, no inference mocks",
					runtimeEvidence,
					sourcePath,
					task,
					before,
					split,
					reloaded,
					previewEvidence,
					exported,
				},
				null,
				2
			)
		);
	});

	test("discards a real inference result when the source clip moves", async ({
		page,
	}, testInfo) => {
		const clip = await prepareMontage({ page });
		await clip.click({ button: "right" });
		await page.getByTestId("onnx-shot-split-menu-item").click();
		await page.evaluate(() => {
			const timeline = (
				window as unknown as HarnessWindow
			).__timelineStore.getState();
			const track = timeline.tracks.find((item) => item.elements.length > 0);
			if (!track) throw new Error("No video track");
			timeline.updateElementStartTime(track.id, track.elements[0].id, 2);
		});
		await expect
			.poll(async () => (await readTask({ page }))?.status, { timeout: 60_000 })
			.toBe("failed");
		expect((await readTask({ page }))?.error).toContain(
			"changed during detection"
		);
		await expect(page.getByTestId("timeline-element")).toHaveCount(1);
		const result = await readTimeline({ page });
		expect(
			result.tracks
				.flatMap((track) => track.elements)
				.map((element) => element.startTime)
		).toEqual([2]);
		await page.screenshot({
			path: testInfo.outputPath("stale-result-rejected.png"),
		});
		await writeFile(
			testInfo.outputPath("stale-result.json"),
			JSON.stringify({ task: await readTask({ page }), result }, null, 2)
		);
	});
});

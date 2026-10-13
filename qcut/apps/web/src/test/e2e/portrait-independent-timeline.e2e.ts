import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
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
import {
	ALL_FORMATS,
	BufferSource,
	EncodedPacketSink,
	Input,
} from "mediabunny";
import { getExportFrameSampleTime } from "../../lib/export/export-video-frame-seek";
import type { ExportProfileReport } from "../../lib/export/export-profiler";
import { getMediaSourcePlaybackTime } from "../../lib/video/video-timing";
import { calculateElementBounds } from "../../lib/export/export-element-bounds";
import { portraitProcessingSize } from "../../lib/portrait/portrait-processing-size";
import { getFFmpegPath } from "../../../../../electron/ffmpeg/paths";
import { probeVideo } from "./helpers/transition-export-evidence";
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
	__exportStore: {
		getState: () => {
			error: string | null;
			progress: { isExporting: boolean };
		};
	};
	__exportProfiler: {
		arm: (options: { targetPath: string }) => void;
		buildReport: (meta: Record<string, unknown>) => ExportProfileReport;
	};
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

async function exportGeometry({ page, file }: { page: Page; file: string }) {
	const input = new Input({
		source: new BufferSource(await readFile(file)),
		formats: ALL_FORMATS,
	});
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error("Missing portrait video track");
		const [
			squareWidth,
			squareHeight,
			rotation,
			pixelAspectRatio,
			codedWidth,
			codedHeight,
		] = await Promise.all([
			track.getSquarePixelWidth(),
			track.getSquarePixelHeight(),
			track.getRotation(),
			track.getPixelAspectRatio(),
			track.getCodedWidth(),
			track.getCodedHeight(),
		]);
		const element = await page.evaluate(() => {
			const timeline = (
				window as unknown as ReferenceWindow
			).__timelineStore.getState();
			const clip = timeline.tracks
				.flatMap((track) => track.elements)
				.find((candidate) => candidate.type === "media");
			if (!clip || clip.type !== "media")
				throw new Error("Missing portrait clip");
			return clip;
		});
		const packets = new EncodedPacketSink(track);
		const sampling = await Promise.all(
			[0, 1, 2].map(async (frameIndex) => {
				const timelineTime = getExportFrameSampleTime({
					frameRate: 30,
					frameStartTime: frameIndex / 30,
				});
				const sourceTime = getMediaSourcePlaybackTime({
					element,
					localTimelineTime: timelineTime,
					fps: 30,
				});
				const packet = await packets.getPacket(sourceTime);
				if (!packet) throw new Error(`No source sample at ${sourceTime}s`);
				return {
					frameIndex,
					timelineTime,
					sourceTime,
					packetTimestamp: packet.timestamp,
					packetDuration: packet.duration,
				};
			})
		);
		// CanvasSink defaults to rotated square-pixel dimensions, then canvas integer dimensions.
		const sourceWidth = Math.trunc(rotation % 180 ? squareHeight : squareWidth);
		const sourceHeight = Math.trunc(
			rotation % 180 ? squareWidth : squareHeight
		);
		const bounds = calculateElementBounds(
			element,
			sourceWidth,
			sourceHeight,
			1080,
			1920
		);
		const processing = portraitProcessingSize({
			width: Math.max(1, Math.round(Math.abs(bounds.width))),
			height: Math.max(1, Math.round(Math.abs(bounds.height))),
			sourceWidth,
			sourceHeight,
			adjustments: element.portraitAdjustments,
		});
		return {
			codedWidth,
			codedHeight,
			sampling,
			uniqueSourceFrames: new Set(
				sampling.map((sample) => sample.packetTimestamp)
			).size,
			pixelAspectRatio,
			rotation,
			sourceWidth,
			sourceHeight,
			fitMode: element.fitMode ?? "cover",
			bounds,
			processing,
		};
	} finally {
		input.dispose();
	}
}

async function cacheEntries({ cache }: { cache: string }) {
	const names = await readdir(cache).catch(() => []);
	return Promise.all(
		names
			.filter((name) => name.endsWith(".json"))
			.sort()
			.map(async (name) => {
				const entry = JSON.parse(
					await readFile(path.join(cache, name), "utf8")
				) as {
					key: string;
					width: number;
					height: number;
					rgbaSha256: string;
				};
				return entry;
			})
	);
}

async function cachedFrames({ cache }: { cache: string }) {
	return (await cacheEntries({ cache })).length;
}

async function engineProcesses({
	appPid,
	groups = [],
}: {
	appPid: number;
	groups?: number[];
}) {
	const { stdout } = await run("ps", ["-axo", "pid=,ppid=,pgid=,args="]);
	const rows = stdout.split("\n").flatMap((line) => {
		const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
		return match
			? [
					{
						pid: Number(match[1]),
						parent: Number(match[2]),
						group: Number(match[3]),
						command: match[4],
					},
				]
			: [];
	});
	const workers = rows.filter(
		(row) =>
			row.parent === appPid && row.command.includes("independent_worker.py")
	);
	const workerGroups = new Set([...groups, ...workers.map((row) => row.group)]);
	return {
		workers,
		children: rows.filter(
			(row) =>
				workerGroups.has(row.group) &&
				!workers.some((worker) => worker.pid === row.pid)
		),
		members: rows.filter((row) =>
			groups.length ? groups.includes(row.group) : workerGroups.has(row.group)
		),
	};
}

async function activeWorker({ appPid }: { appPid: number }) {
	let active = await engineProcesses({ appPid });
	await expect
		.poll(
			async () => {
				active = await engineProcesses({ appPid });
				return active.children.length;
			},
			{ timeout: 120_000, intervals: [100] }
		)
		.toBeGreaterThan(0);
	expect(active.workers).toHaveLength(1);
	return active.workers[0];
}

async function decodedExport({ file }: { file: string }) {
	const probe = await probeVideo({ filePath: file });
	expect(probe).toMatchObject({
		width: 1080,
		height: 1920,
		frameCount: 3,
		fps: 30,
		hasAudio: false,
	});
	const { stdout } = await run(
		getFFmpegPath(),
		[
			"-v",
			"error",
			"-xerror",
			"-i",
			file,
			"-map",
			"0:v:0",
			"-an",
			"-pix_fmt",
			"rgba",
			"-f",
			"framemd5",
			"-",
		],
		{ timeout: 30_000 }
	);
	const frames = stdout
		.split("\n")
		.filter((line) => line.trim() && !line.startsWith("#"));
	expect(frames).toHaveLength(3);
	return {
		probe,
		frames,
		pixelHashes: frames.map((frame) => frame.split(",").at(-1)!.trim()),
	};
}

async function previewCommits({ page }: { page: Page }) {
	return page
		.getByTestId("color-preview-canvas")
		.evaluate((node) =>
			Number((node as HTMLCanvasElement).dataset.renderedFrameCount ?? 0)
		);
}

// Match preview fitting, including sources with non-square display pixels.
async function engineChange({ page }: { page: Page }) {
	return page.getByTestId("color-preview-canvas").evaluate((node) => {
		const canvas = node as HTMLCanvasElement;
		const geometryJson = canvas.dataset.renderedPortraitGeometry;
		if (!geometryJson) throw new Error("Missing committed portrait geometry");
		const geometry = JSON.parse(geometryJson) as {
			sourceSize: { width: number; height: number };
			logicalSize: { width: number; height: number };
			bounds: { x: number; y: number; width: number; height: number };
			processing: { width: number; height: number };
		};
		const video = canvas.parentElement?.querySelector("video");
		if (!video) throw new Error("Missing preview source video");
		const cover = Math.max(
			canvas.width / video.videoWidth,
			canvas.height / video.videoHeight
		);
		const drawWidth = video.videoWidth * cover;
		const drawHeight = video.videoHeight * cover;
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
		referenceContext.drawImage(
			video,
			(canvas.width - drawWidth) / 2,
			(canvas.height - drawHeight) / 2,
			drawWidth,
			drawHeight
		);
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
		for (let index = 0; index < before.length; index += 4) {
			if (
				Math.abs(before[index] - after[index]) > 2 ||
				Math.abs(before[index + 1] - after[index + 1]) > 2 ||
				Math.abs(before[index + 2] - after[index + 2]) > 2
			) {
				changed += 1;
			}
		}
		return {
			changed,
			total: canvas.width * canvas.height,
			canvas: [canvas.width, canvas.height],
			geometry,
			portraitStatus: canvas.dataset.renderedPortraitStatus,
			portraitEngine: canvas.dataset.renderedPortraitEngine,
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
async function reopenSkinControls({
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
	const group = panel.getByRole("button", { name: "皮肤管理", exact: true });
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
	await page.getByTestId("export-quality-select").getByRole("button").click();
	await page.locator('button[role="radio"][id="1080p"]').check();
	await page
		.getByTestId("export-frame-rate-select")
		.getByRole("button")
		.click();
	await page
		.getByRole("radio", { name: "30 fps", exact: true })
		.locator("..")
		.click();
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

async function waitForPausedFrame({ page }: { page: Page }) {
	const pending = page.getByTestId("independent-portrait-pending");
	await expect(pending).toBeVisible({ timeout: 10_000 });
	await expect(pending).toHaveCount(0, { timeout: 180_000 });
}

async function completeExport({
	app,
	page,
	file,
}: {
	app: ElectronApplication;
	page: Page;
	file: string;
}) {
	const { started } = await exportTimeline({ app, page, file });
	const seconds = await waitForExport({ page, file, started });
	const decoded = await decodedExport({ file });
	return { seconds, decoded };
}

test("resident independent portrait engine: vertical HD preview, identical cached export, cancellation and recovery", async () => {
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
	const appPid = app.process().pid;
	if (!appPid) throw new Error("Missing Electron process identity");
	const errors: string[] = [];
	const expectedErrors: string[] = [];
	const consoleMessages: Array<{ phase: string; type: string; text: string }> =
		[];
	let phase = "normal";
	try {
		const page = await getMainWindow(app);
		page.on("pageerror", (error) =>
			(phase === "normal" ? errors : expectedErrors).push(error.message)
		);
		page.on("console", (message) => {
			if (message.type() === "error" || message.type() === "warning")
				consoleMessages.push({
					phase,
					type: message.type(),
					text: message.text(),
				});
		});
		const { panel } = await preparePortraitReferenceProject({
			page,
			source,
			duration: 2,
			canvasSize: { width: 1080, height: 1920 },
		});
		await panel
			.getByRole("combobox", { name: "美颜处理引擎", exact: true })
			.click();
		await page.getByRole("option", { name: "自研", exact: true }).click();
		await expect(page.getByTestId("portrait-engine-note")).toContainText(
			"首次处理需要初始化"
		);
		await expect(page.getByTestId("portrait-engine-runtime")).toHaveCount(0, {
			timeout: 120_000,
		});

		await panel.getByRole("button", { name: "皮肤管理", exact: true }).click();
		await setValue({ panel, label: "磨皮", value: 40 });
		await setValue({ panel, label: "美白", value: 45 });
		await expect(page.getByTestId("portrait-engine-issue")).toHaveCount(0);
		await waitForPausedFrame({ page });
		await expect(page.getByText(/暂不支持这个画面比例/)).toHaveCount(0);
		const beforePlayback = await cachedFrames({ cache });
		expect(beforePlayback).toBeGreaterThan(0);
		const paused = await engineChange({ page });
		expect(paused.changed).toBeGreaterThan(200);
		expect(paused.portraitStatus).toBe("applied");
		expect(paused.portraitEngine).toBe("independent");
		expect(paused.geometry.logicalSize).toEqual({ width: 1080, height: 1920 });
		expect(paused.geometry.processing).toEqual(
			portraitProcessingSize({
				width: Math.round(paused.geometry.bounds.width),
				height: Math.round(paused.geometry.bounds.height),
				sourceWidth: paused.geometry.sourceSize.width,
				sourceHeight: paused.geometry.sourceSize.height,
				adjustments: {
					enabled: true,
					engine: "independent",
					values: { face_adjust_Smooth: 40, face_adjust_Whiten: 45 },
				},
			})
		);
		expect(
			(await cacheEntries({ cache })).some(
				(entry) =>
					entry.width === paused.geometry.processing.width &&
					entry.height === paused.geometry.processing.height
			)
		).toBe(true);
		await page.screenshot({
			path: path.join(output, "01-paused-vertical-skin.png"),
		});

		// Playback must submit no frame jobs; the previously loaded worker may remain idle.
		const idle = await engineProcesses({ appPid });
		expect(idle.workers).toHaveLength(1);
		await page.evaluate(() =>
			(window as unknown as PlaybackWindow).__playbackStore.getState().play()
		);
		const playbackStart = await previewCommits({ page });
		await page.waitForTimeout(800);
		expect(await previewCommits({ page })).toBeGreaterThan(playbackStart);
		await expect(page.getByTestId("independent-portrait-pending")).toHaveCount(
			0
		);
		expect(await cachedFrames({ cache })).toBe(beforePlayback);
		const playing = await engineProcesses({ appPid });
		expect(playing.workers.map((worker) => worker.pid)).toEqual(
			idle.workers.map((worker) => worker.pid)
		);
		expect(playing.children).toHaveLength(0);

		await page.evaluate(() =>
			(window as unknown as PlaybackWindow).__playbackStore.getState().pause()
		);
		await waitForPausedFrame({ page });
		expect(await cachedFrames({ cache })).toBeGreaterThan(beforePlayback);

		// 0.09 s at an explicitly selected 30 fps yields three frames without a rounding-boundary fourth.
		await trimClip({ page, visible: 0.09 });
		await page.evaluate(() =>
			(window as unknown as PlaybackWindow).__playbackStore.getState().seek(0)
		);
		await expect(page.getByTestId("independent-portrait-pending")).toHaveCount(
			0,
			{ timeout: 180_000 }
		);
		const geometry = await exportGeometry({ page, file: source });
		expect(geometry.fitMode).toBe("cover");
		expect(geometry.processing.width).toBeGreaterThanOrEqual(1080);
		expect(geometry.processing.height).toBeGreaterThanOrEqual(1920);
		await page.evaluate(() =>
			(window as unknown as PlaybackWindow).__exportProfiler.arm({
				targetPath: "",
			})
		);
		const beforeColdEntries = await cacheEntries({ cache });
		const first = path.join(output, "export-cold.mp4");
		const cold = await completeExport({ app, page, file: first });
		const afterColdEntries = await cacheEntries({ cache });
		const browserEvidence = await page.evaluate(() => ({
			profile: (
				window as unknown as PlaybackWindow
			).__exportProfiler.buildReport({ phase: "cold" }),
			videos: Array.from(document.querySelectorAll("video")).map((video) => ({
				width: video.videoWidth,
				height: video.videoHeight,
				currentTime: video.currentTime,
				readyState: video.readyState,
			})),
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
				devicePixelRatio: window.devicePixelRatio,
			},
		}));
		await writeFile(
			path.join(output, "e2e-cold-evidence.json"),
			`${JSON.stringify({ source: path.basename(source), geometry, cold, beforeColdEntries, afterColdEntries, browserEvidence, errors, consoleMessages }, null, 2)}\n`,
			"utf8"
		);
		expect(new Set(cold.decoded.pixelHashes).size).toBe(
			geometry.uniqueSourceFrames
		);
		const hdEntries = afterColdEntries.filter(
			(entry) =>
				entry.width === geometry.processing.width &&
				entry.height === geometry.processing.height
		);
		expect(hdEntries.length).toBeGreaterThanOrEqual(
			geometry.uniqueSourceFrames
		);
		const second = path.join(output, "export-cached.mp4");
		const warm = await completeExport({ app, page, file: second });
		expect(warm.decoded.frames).toEqual(cold.decoded.frames);
		expect(await cacheEntries({ cache })).toEqual(afterColdEntries);
		expect(warm.seconds).toBeLessThan(cold.seconds);

		await reopenSkinControls({ page, panel });
		await setValue({ panel, label: "美白", value: 65 });
		await waitForPausedFrame({ page });
		const cancelled = path.join(output, "export-cancelled.mp4");
		phase = "cancellation";
		await exportTimeline({ app, page, file: cancelled });
		const cancelWorker = await activeWorker({ appPid });
		const cancelledGroups = [cancelWorker.group];
		await page.getByRole("button", { name: "Cancel Export" }).click();
		await expect(page.getByTestId("export-start-button")).toBeVisible({
			timeout: 30_000,
		});
		await expect
			.poll(
				async () =>
					(await engineProcesses({ appPid, groups: cancelledGroups })).members
						.length,
				{ timeout: 15_000 }
			)
			.toBe(0);
		const afterCancel = await cachedFrames({ cache });
		await page.waitForTimeout(2_000);
		expect(await cachedFrames({ cache })).toBe(afterCancel);
		expect(existsSync(cancelled)).toBe(false);
		await page.getByRole("button", { name: "Close export dialog" }).click();

		phase = "normal";
		const crashed = path.join(output, "export-crashed.mp4");
		await exportTimeline({ app, page, file: crashed });
		const crashWorker = await activeWorker({ appPid });
		phase = "injected-crash";
		process.kill(crashWorker.pid, "SIGKILL");
		await expect
			.poll(
				() =>
					page.evaluate(() => {
						const state = (
							window as unknown as PlaybackWindow
						).__exportStore.getState();
						return state.error;
					}),
				{ timeout: 30_000 }
			)
			.toMatch(/美颜|independent/i);
		const crashError = await page.evaluate(
			() => (window as unknown as PlaybackWindow).__exportStore.getState().error
		);
		expect(crashError).toBeTruthy();
		await expect(
			page.getByTestId("export-dialog").getByText(crashError!, { exact: true })
		).toBeVisible();
		await expect(page.getByTestId("export-start-button")).toBeVisible();
		expect(existsSync(crashed)).toBe(false);
		await expect
			.poll(
				async () =>
					(await engineProcesses({ appPid, groups: [crashWorker.group] }))
						.members.length,
				{ timeout: 15_000 }
			)
			.toBe(0);
		await page.screenshot({
			path: path.join(output, "02-worker-crash-export-error.png"),
		});
		await writeFile(
			path.join(output, "e2e-crash-evidence.json"),
			`${JSON.stringify({ crashError, worker: crashWorker, noExportSaved: !existsSync(crashed), errors, expectedErrors, consoleMessages }, null, 2)}\n`,
			"utf8"
		);
		await page.getByRole("button", { name: "Close export dialog" }).click();
		phase = "normal";

		const recovered = path.join(output, "export-recovered.mp4");
		const recovery = await completeExport({ app, page, file: recovered });
		expect(recovery.decoded.frames).not.toEqual(cold.decoded.frames);
		expect(new Set(recovery.decoded.pixelHashes).size).toBe(
			geometry.uniqueSourceFrames
		);
		const recoveredWorker = await engineProcesses({ appPid });
		expect(recoveredWorker.workers).toHaveLength(1);
		expect([...cancelledGroups, crashWorker.group]).not.toContain(
			recoveredWorker.workers[0].group
		);
		await page.screenshot({
			path: path.join(output, "03-after-cancel-crash-recovery.png"),
		});

		await writeFile(
			path.join(output, "e2e-evidence.json"),
			`${JSON.stringify(
				{
					source: path.basename(source),
					pausedPreview: paused,
					exportGeometry: geometry,
					previewExportParityChecked: false,
					uncachedExportSeconds: cold.seconds,
					cachedExportSeconds: warm.seconds,
					recoveryExportSeconds: recovery.seconds,
					decodedCold: cold.decoded,
					decodedCached: warm.decoded,
					decodedRecovery: recovery.decoded,
					coldAndCachedPixelsIdentical: true,
					hdCacheEntries: hdEntries,
					cachedFramesAfterCancel: afterCancel,
					idleWorkerPid: idle.workers[0].pid,
					cancelledWorkerGroups: cancelledGroups,
					crashedWorkerPid: crashWorker.pid,
					crashError,
					expectedErrors,
					consoleMessages,
					recoveredWorkerPid: recoveredWorker.workers[0].pid,
				},
				null,
				2
			)}\n`,
			"utf8"
		);
		expect(errors).toEqual([]);
		expect(
			consoleMessages.filter(
				(message) =>
					message.phase === "normal" &&
					message.type === "error" &&
					/export|rendervideo|independent|美颜/i.test(message.text)
			)
		).toEqual([]);
	} finally {
		await writeFile(
			path.join(output, "e2e-runtime-errors.json"),
			`${JSON.stringify({ errors, expectedErrors, consoleMessages }, null, 2)}\n`,
			"utf8"
		);
		await app.close();
		await rm(userDataDirectory, { recursive: true, force: true });
	}
});

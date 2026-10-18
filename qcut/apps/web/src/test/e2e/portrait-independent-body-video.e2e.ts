/**
 * The independent engine's smart body on a timeline video clip follows the clip's
 * history: the paused preview and the export submit the same frames to one
 * session, seeks replay only what the engine lacks, and a killed worker resumes
 * from the on-disk checkpoint with byte-identical output.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
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
	type Page,
	test,
} from "@playwright/test";
import { getFFmpegPath } from "../../../../../electron/ffmpeg/paths";
import { probeVideo } from "./helpers/transition-export-evidence";
import { stubExportSaveDialog } from "./helpers/e2e-export-helpers";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import {
	preparePortraitReferenceProject,
	type ReferenceWindow,
} from "./helpers/portrait-reference";

const source = process.env.QCUT_BODY_VIDEO_PATH;
const output = path.resolve(
	process.env.QCUT_BODY_VIDEO_OUTPUT ??
		"output/playwright/portrait-independent-body-video"
);
const run = promisify(execFile);
const FPS = 30;
/** 0.5 s at 30 fps: fifteen frames, one past the engine's twelve-frame checkpoint. */
const CLIP_SECONDS = 0.5;
const FRAMES = 15;

interface BodyVideoWindow extends ReferenceWindow {
	__playbackStore: {
		getState: () => {
			currentTime: number;
			pause: () => void;
			seek: (time: number) => void;
		};
	};
}

interface CacheEntry {
	key: string;
	width: number;
	height: number;
	rgbaSha256: string;
}

async function cacheEntries({
	cache,
}: {
	cache: string;
}): Promise<CacheEntry[]> {
	const names = await readdir(cache).catch(() => [] as string[]);
	return Promise.all(
		names
			.filter((name) => name.endsWith(".json"))
			.sort()
			.map(
				async (name) =>
					JSON.parse(
						await readFile(path.join(cache, name), "utf8")
					) as CacheEntry
			)
	);
}

async function checkpointFiles({ sessions }: { sessions: string }) {
	const folders = await readdir(sessions).catch(() => [] as string[]);
	const files: Record<string, string[]> = {};
	for (const folder of folders.sort())
		files[folder] = (await readdir(path.join(sessions, folder))).sort();
	return files;
}

async function engineWorkers({ appPid }: { appPid: number }) {
	const { stdout } = await run("ps", ["-axo", "pid=,ppid=,args="]);
	return stdout.split("\n").flatMap((line) => {
		const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
		return match &&
			Number(match[2]) === appPid &&
			match[3].includes("independent_worker.py")
			? [Number(match[1])]
			: [];
	});
}

async function seek({ page, frame }: { page: Page; frame: number }) {
	await page.evaluate((time) => {
		const playback = (
			window as unknown as BodyVideoWindow
		).__playbackStore.getState();
		playback.pause();
		playback.seek(time);
	}, frame / FPS);
}

/** The paused preview of `frame`, from the exact composition or the DOM portrait canvas. */
async function waitForPausedFrame({
	page,
	frame,
	timeout = 240_000,
}: {
	page: Page;
	frame: number;
	timeout?: number;
}) {
	await expect
		.poll(
			() =>
				page.evaluate((expected) => {
					const composition = document.querySelector<HTMLImageElement>(
						'[data-canvas-composition-preview="ready"]'
					);
					if (composition)
						return Number(composition.dataset.frame) === expected
							? "composition"
							: `composition:${composition.dataset.frame}`;
					const canvas = document.querySelector<HTMLCanvasElement>(
						'[data-testid="color-preview-canvas"]'
					);
					if (
						canvas &&
						Number(canvas.dataset.renderedFrameSeed) === expected &&
						canvas.dataset.renderedPortraitStatus === "applied" &&
						!document.querySelector(
							'[data-testid="independent-portrait-pending"]'
						)
					)
						return "dom";
					return `pending:${canvas?.dataset.renderedFrameSeed ?? "none"}`;
				}, frame),
			{ timeout, intervals: [250, 500, 1_000] }
		)
		.toMatch(/^(composition|dom)$/);
}

async function setBodyValues({
	page,
	values,
}: {
	page: Page;
	values: Record<string, number>;
}) {
	await page.evaluate((next) => {
		const timeline = (
			window as unknown as BodyVideoWindow
		).__timelineStore.getState();
		const track = timeline.tracks.find((candidate) =>
			candidate.elements.some((element) => element.type === "media")
		);
		const element = track?.elements.find(
			(candidate) => candidate.type === "media"
		);
		if (!track || !element || element.type !== "media")
			throw new Error("Missing body clip");
		const current = element.portraitAdjustments ?? {
			enabled: true,
			values: {},
		};
		timeline.updateMediaElement(track.id, element.id, {
			portraitAdjustments: {
				...current,
				enabled: true,
				engine: "independent",
				values: { ...current.values, ...next },
			},
		});
	}, values);
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
		.getByRole("radio", { name: `${FPS} fps`, exact: true })
		.locator("..")
		.click();
	const includeAudio = page.getByRole("checkbox", {
		name: "Include audio in export",
	});
	if ((await includeAudio.count()) > 0 && (await includeAudio.isChecked()))
		await includeAudio.click();
	const started = Date.now();
	await page.getByTestId("export-start-button").click();
	await expect
		.poll(
			async () => {
				try {
					return (await stat(file)).size;
				} catch {
					return 0;
				}
			},
			{ timeout: 300_000, intervals: [500, 1_000, 2_000] }
		)
		.toBeGreaterThan(1_000);
	const seconds = (Date.now() - started) / 1000;
	await expect(page.getByTestId("export-start-button")).toBeVisible({
		timeout: 30_000,
	});
	await page.getByRole("button", { name: "Close export dialog" }).click();
	const probe = await probeVideo({ filePath: file });
	expect(probe).toMatchObject({
		width: 1080,
		height: 1920,
		frameCount: FRAMES,
		fps: FPS,
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
		{ timeout: 60_000 }
	);
	const frames = stdout
		.split("\n")
		.filter((line) => line.trim() && !line.startsWith("#"))
		.map((line) => line.split(",").at(-1)!.trim());
	expect(frames).toHaveLength(FRAMES);
	return { seconds, frames };
}

test("independent smart body follows a video clip's history in preview, export and recovery", async () => {
	test.skip(
		!source || !existsSync(source),
		"Set QCUT_BODY_VIDEO_PATH to a short full-body video; needs the independent runtime with its body-video policy"
	);
	test.setTimeout(1_500_000);
	if (!source) throw new Error("Missing body video");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-body-video-")
	);
	const cache = path.join(
		userDataDirectory,
		"Cache",
		"independent-beauty-frames"
	);
	const sessions = path.join(
		userDataDirectory,
		"Cache",
		"independent-beauty-sessions"
	);
	const app = await startElectronApp({ userDataDirectory });
	const appPid = app.process().pid;
	if (!appPid) throw new Error("Missing Electron process identity");
	const errors: string[] = [];
	const consoleErrors: string[] = [];
	const evidence: Record<string, unknown> = { source: path.basename(source) };
	try {
		const page = await getMainWindow(app);
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		const { panel } = await preparePortraitReferenceProject({
			page,
			source,
			duration: CLIP_SECONDS,
			canvasSize: { width: 1080, height: 1920 },
		});
		expect(
			await page.evaluate(
				() =>
					(window as unknown as BodyVideoWindow).__projectStore.getState()
						.activeProject?.fps
			)
		).toBe(FPS);
		await panel
			.getByRole("combobox", { name: "美颜处理引擎", exact: true })
			.click();
		await page.getByRole("option", { name: "自研", exact: true }).click();
		await expect(page.getByTestId("portrait-engine-runtime")).toHaveCount(0, {
			timeout: 120_000,
		});
		const status = await page.evaluate(async () => {
			const inspect = window.electronAPI?.beautyLab?.inspectIndependent;
			return inspect ? await inspect() : null;
		});
		test.skip(
			status?.bodyVideo !== true,
			"The installed independent runtime has no body-video policy"
		);

		const values = { body_adjust_SlimBody: 40, body_adjust_StretchLeg: 30 };
		await setBodyValues({ page, values });
		// Frame 3 first: the engine has no history, so frames 0..2 replay before it.
		await seek({ page, frame: 3 });
		await waitForPausedFrame({ page, frame: 3 });
		const afterPreview = await cacheEntries({ cache });
		expect(afterPreview).toHaveLength(4);
		// The seed frame and a first body frame may still equal the source; later frames move.
		expect(
			new Set(afterPreview.map((entry) => entry.rgbaSha256)).size
		).toBeGreaterThanOrEqual(2);
		await page.screenshot({ path: path.join(output, "01-paused-frame-3.png") });

		const cold = await exportTimeline({
			app,
			page,
			file: path.join(output, "export-cold.mp4"),
		});
		const afterCold = await cacheEntries({ cache });
		// Preview and export submitted identical frames: the export reused the four preview frames.
		expect(afterCold).toHaveLength(FRAMES);
		for (const entry of afterPreview) expect(afterCold).toContainEqual(entry);
		expect(new Set(cold.frames).size).toBe(FRAMES);
		const checkpoints = await checkpointFiles({ sessions });
		expect(Object.keys(checkpoints)).toHaveLength(1);
		expect(Object.values(checkpoints)[0]).toEqual(["0000000012.snapshot"]);
		evidence.coldExportSeconds = cold.seconds;
		evidence.checkpoints = checkpoints;

		// Seeks inside the exported range read the cache; the engine stays idle.
		const workersBefore = await engineWorkers({ appPid });
		await seek({ page, frame: 7 });
		await waitForPausedFrame({ page, frame: 7, timeout: 60_000 });
		await seek({ page, frame: 14 });
		await waitForPausedFrame({ page, frame: 14, timeout: 60_000 });
		expect(await cacheEntries({ cache })).toEqual(afterCold);
		expect(await engineWorkers({ appPid })).toEqual(workersBefore);

		const warm = await exportTimeline({
			app,
			page,
			file: path.join(output, "export-cached.mp4"),
		});
		expect(warm.frames).toEqual(cold.frames);
		expect(await cacheEntries({ cache })).toEqual(afterCold);
		expect(warm.seconds).toBeLessThan(cold.seconds);
		evidence.cachedExportSeconds = warm.seconds;

		// A killed worker and an emptied frame cache: frame 13 resumes from the
		// frame-12 checkpoint on disk and reproduces the exported bytes.
		expect(workersBefore).toHaveLength(1);
		process.kill(workersBefore[0], "SIGKILL");
		await expect
			.poll(() => engineWorkers({ appPid }), { timeout: 15_000 })
			.toEqual([]);
		await rm(cache, { recursive: true, force: true });
		await seek({ page, frame: 13 });
		await waitForPausedFrame({ page, frame: 13 });
		const resumed = await cacheEntries({ cache });
		expect(resumed).toHaveLength(2);
		for (const entry of resumed) expect(afterCold).toContainEqual(entry);
		evidence.resumedEntries = resumed;

		// Without a checkpoint below it, frame 5 replays from the clip's first frame.
		await seek({ page, frame: 5 });
		await waitForPausedFrame({ page, frame: 5 });
		const replayed = await cacheEntries({ cache });
		expect(replayed).toHaveLength(8);
		for (const entry of replayed) expect(afterCold).toContainEqual(entry);
		await page.screenshot({
			path: path.join(output, "02-resumed-frame-5.png"),
		});

		// A changed body edit is another session with its own history.
		await setBodyValues({
			page,
			values: { ...values, body_adjust_SlimBody: 55 },
		});
		await seek({ page, frame: 2 });
		await waitForPausedFrame({ page, frame: 2 });
		const edited = await cacheEntries({ cache });
		expect(edited).toHaveLength(11);
		expect(
			edited.filter(
				(entry) => !afterCold.some((known) => known.key === entry.key)
			)
		).toHaveLength(3);
		// Three frames leave no checkpoint yet; only the first session has a folder.
		expect(await checkpointFiles({ sessions })).toEqual(checkpoints);
		evidence.editedEntries = edited.length;
		evidence.errors = errors;
		evidence.consoleErrors = consoleErrors;
		await writeFile(
			path.join(output, "e2e-evidence.json"),
			`${JSON.stringify(evidence, null, 2)}\n`,
			"utf8"
		);
		expect(errors).toEqual([]);
		expect(
			consoleErrors.filter((text) => /export|independent|美颜|美体/i.test(text))
		).toEqual([]);
	} finally {
		await writeFile(
			path.join(output, "e2e-runtime-errors.json"),
			`${JSON.stringify({ errors, consoleErrors }, null, 2)}\n`,
			"utf8"
		);
		await app.close();
		await rm(userDataDirectory, { recursive: true, force: true });
	}
});

/**
 * The independent engine's smart body on a timeline video clip follows the clip's
 * history: the paused preview and the export submit the same frames to one
 * session, seeks replay only what the engine lacks, and a killed worker resumes
 * from the on-disk checkpoint with byte-identical output.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import {
	type BodyVideoWindow,
	cacheEntries,
	checkpointFiles,
	engineWorkers,
	exportTimeline,
	seek,
	setBodyValues,
	waitForPausedFrame,
} from "./helpers/independent-body-video-helpers";
import { preparePortraitReferenceProject } from "./helpers/portrait-reference";

const source = process.env.QCUT_BODY_VIDEO_PATH;
const output = path.resolve(
	process.env.QCUT_BODY_VIDEO_OUTPUT ??
		"output/playwright/portrait-independent-body-video"
);
const FPS = 30;
/** 0.5 s at 30 fps: fifteen frames, one past the engine's twelve-frame checkpoint. */
const CLIP_SECONDS = 0.5;
const FRAMES = 15;

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
		await seek({ page, frame: 3, fps: FPS });
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
			fps: FPS,
			frames: FRAMES,
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
		await seek({ page, frame: 7, fps: FPS });
		await waitForPausedFrame({ page, frame: 7, timeout: 60_000 });
		await seek({ page, frame: 14, fps: FPS });
		await waitForPausedFrame({ page, frame: 14, timeout: 60_000 });
		expect(await cacheEntries({ cache })).toEqual(afterCold);
		expect(await engineWorkers({ appPid })).toEqual(workersBefore);

		const warm = await exportTimeline({
			app,
			page,
			file: path.join(output, "export-cached.mp4"),
			fps: FPS,
			frames: FRAMES,
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
		await seek({ page, frame: 13, fps: FPS });
		await waitForPausedFrame({ page, frame: 13 });
		const resumed = await cacheEntries({ cache });
		expect(resumed).toHaveLength(2);
		for (const entry of resumed) expect(afterCold).toContainEqual(entry);
		evidence.resumedEntries = resumed;

		// Without a checkpoint below it, frame 5 replays from the clip's first frame.
		await seek({ page, frame: 5, fps: FPS });
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
		await seek({ page, frame: 2, fps: FPS });
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

/**
 * Single-person dynamic body closure, part 2: the independent (自研) smart-body
 * session must give the same 180 frames whatever the operator does around it —
 * a straight export, seeking backwards through the clip, emptying the frame
 * cache, cancelling an export halfway, losing the engine worker while a frame
 * is being computed, and restarting the application.
 *
 * Every export is digested per decoded frame; equality of the digest lists is
 * the acceptance. The checks are recorded in e2e-evidence.json for the report.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	type ElectronApplication,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { BODY_CLOSE_VALUES } from "./helpers/body-video-close-scenario";
import {
	getMainWindow,
	startElectronApp,
	waitForProjectLoad,
} from "./helpers/electron-helpers";
import {
	type BodyVideoWindow,
	cacheEntries,
	checkpointFiles,
	engineWorkers,
	exportTimeline,
	finishExport,
	seek,
	setBodyValues,
	startExport,
	waitForPausedFrame,
} from "./helpers/independent-body-video-helpers";
import { preparePortraitReferenceProject } from "./helpers/portrait-reference";

const source = process.env.QCUT_BODY_CLOSE_SOURCE;
const output = path.resolve(
	process.env.QCUT_BODY_CLOSE_INVARIANCE_OUTPUT ??
		"output/playwright/portrait-independent-body-video-close"
);
const FPS = 30;
const SECONDS = Number(process.env.QCUT_BODY_CLOSE_SECONDS ?? 6);
const FRAMES = SECONDS * FPS;
/** Past two on-disk checkpoints (every 12 frames) before interfering. */
const INTERFERE_AFTER_FRAMES = 30;

interface ExportStoreWindow extends BodyVideoWindow {
	__exportStore: {
		getState: () => {
			isExporting: boolean;
			error: string | null;
			progress: { progress: number };
		};
	};
	router?: {
		navigate: (options: {
			to: string;
			params: Record<string, string>;
		}) => Promise<void> | void;
	};
}

function sameDigests(left: string[], right: string[]) {
	return left.length === right.length && left.every((d, i) => d === right[i]);
}

async function waitForComputedFrames({
	cache,
	count,
	timeout = 600_000,
}: {
	cache: string;
	count: number;
	timeout?: number;
}) {
	await expect
		.poll(async () => (await cacheEntries({ cache })).length, {
			timeout,
			intervals: [500, 1_000],
		})
		.toBeGreaterThanOrEqual(count);
}

async function exportState({ page }: { page: Page }) {
	return page.evaluate(() => {
		const state = (
			window as unknown as ExportStoreWindow
		).__exportStore.getState();
		return {
			isExporting: state.isExporting,
			error: state.error,
			progress: state.progress?.progress ?? 0,
		};
	});
}

async function waitForExportIdle({
	page,
	timeout = 900_000,
}: {
	page: Page;
	timeout?: number;
}) {
	await expect
		.poll(async () => (await exportState({ page })).isExporting, {
			timeout,
			intervals: [500, 1_000, 2_000],
		})
		.toBe(false);
	return exportState({ page });
}

async function reverseSeekWalk({
	page,
	frames,
}: {
	page: Page;
	frames: number[];
}) {
	for (const frame of frames) {
		await seek({ page, frame, fps: FPS });
		await waitForPausedFrame({ page, frame, timeout: 300_000 });
	}
}

async function openProjectInEditor({
	page,
	projectId,
}: {
	page: Page;
	projectId: string;
}) {
	await page.evaluate(async (id) => {
		const router = (window as unknown as ExportStoreWindow).router;
		if (router?.navigate) {
			await router.navigate({
				to: "/editor/$project_id",
				params: { project_id: id },
			});
		} else {
			window.location.hash = `#/editor/${id}`;
		}
	}, projectId);
	await waitForProjectLoad(page);
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						(window as unknown as ExportStoreWindow).__projectStore.getState()
							.activeProject?.id ?? null
				),
			{ timeout: 60_000 }
		)
		.toBe(projectId);
}

test("independent smart body: 180 frames identical across export order, cache loss, cancel, worker crash and restart", async () => {
	test.skip(
		!source || !existsSync(source),
		"Set QCUT_BODY_CLOSE_SOURCE to the locked 1080×1920 body source; needs the independent runtime with its body-video policy"
	);
	test.setTimeout(7_200_000);
	if (!source) throw new Error("Missing body source");
	await mkdir(output, { recursive: true });
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-body-close-")
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
	let app: ElectronApplication = await startElectronApp({ userDataDirectory });
	const errors: string[] = [];
	const consoleErrors: string[] = [];
	const checks: Record<string, boolean> = {};
	const evidence: Record<string, unknown> = {
		source: path.basename(source),
		frames: FRAMES,
		fps: FPS,
		values: BODY_CLOSE_VALUES,
		userDataDirectory,
		checks,
	};
	const persist = () =>
		writeFile(
			path.join(output, "e2e-evidence.json"),
			`${JSON.stringify(evidence, null, 2)}\n`,
			"utf8"
		);
	const attach = (page: Page) => {
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
	};
	try {
		let page = await getMainWindow(app);
		attach(page);
		const { panel } = await preparePortraitReferenceProject({
			page,
			source,
			duration: SECONDS,
			canvasSize: { width: 1080, height: 1920 },
		});
		const projectId = await page.evaluate(
			() =>
				(window as unknown as ExportStoreWindow).__projectStore.getState()
					.activeProject?.id
		);
		if (!projectId) throw new Error("Missing project id");
		evidence.projectId = projectId;
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
		await setBodyValues({ page, values: BODY_CLOSE_VALUES });
		await persist();

		// 1. Straight sequential export: the reference digests.
		const sequential = await exportTimeline({
			app,
			page,
			file: path.join(output, "export-sequential.mp4"),
			fps: FPS,
			frames: FRAMES,
		});
		const reference = sequential.frames;
		expect(new Set(reference).size).toBeGreaterThan(FRAMES / 2);
		const afterSequential = await cacheEntries({ cache });
		expect(afterSequential).toHaveLength(FRAMES);
		const checkpoints = await checkpointFiles({ sessions });
		expect(Object.keys(checkpoints)).toHaveLength(1);
		evidence.sequential = {
			seconds: sequential.seconds,
			checkpoints: Object.values(checkpoints)[0],
		};
		await persist();

		// 2. Seeking backwards through the exported range only reads the cache.
		const descending = [179, 150, 121, 90, 61, 30, 13, 0].filter(
			(frame) => frame < FRAMES
		);
		await reverseSeekWalk({ page, frames: descending });
		const afterReverse = await cacheEntries({ cache });
		checks.reverse_seek_cache_untouched =
			JSON.stringify(afterReverse) === JSON.stringify(afterSequential);
		expect(afterReverse).toEqual(afterSequential);
		await persist();

		// 3. Empty frame cache: every frame is recomputed from the clip's history
		// and the on-disk checkpoints; the pictures must not move.
		await rm(cache, { recursive: true, force: true });
		const recomputed = await exportTimeline({
			app,
			page,
			file: path.join(output, "export-cache-cleared.mp4"),
			fps: FPS,
			frames: FRAMES,
		});
		checks.cache_cleared_identical = sameDigests(recomputed.frames, reference);
		expect(recomputed.frames).toEqual(reference);
		evidence.cacheCleared = { seconds: recomputed.seconds };
		await persist();

		// 4. Cancel while frames are still being computed, then export again.
		await rm(cache, { recursive: true, force: true });
		await startExport({
			app,
			page,
			file: path.join(output, "export-cancelled.mp4"),
			fps: FPS,
		});
		await waitForComputedFrames({ cache, count: INTERFERE_AFTER_FRAMES });
		await page.getByRole("button", { name: "Cancel Export" }).click();
		const cancelled = await waitForExportIdle({ page });
		evidence.cancelled = {
			...cancelled,
			computedFramesAtCancel: (await cacheEntries({ cache })).length,
		};
		await page.getByRole("button", { name: "Close export dialog" }).click();
		const afterCancel = await exportTimeline({
			app,
			page,
			file: path.join(output, "export-after-cancel.mp4"),
			fps: FPS,
			frames: FRAMES,
		});
		checks.cancel_then_export_identical = sameDigests(
			afterCancel.frames,
			reference
		);
		expect(afterCancel.frames).toEqual(reference);
		await persist();

		// 5. Kill the engine worker while it is computing a frame mid-export.
		// The export must finish by itself (worker respawn + history replay)
		// with the same pictures.
		await rm(cache, { recursive: true, force: true });
		const appPid = app.process().pid;
		if (!appPid) throw new Error("Missing Electron process identity");
		const { started: killStarted } = await startExport({
			app,
			page,
			file: path.join(output, "export-worker-killed.mp4"),
			fps: FPS,
		});
		await waitForComputedFrames({ cache, count: INTERFERE_AFTER_FRAMES });
		const workers = await engineWorkers({ appPid });
		expect(workers.length).toBeGreaterThanOrEqual(1);
		for (const pid of workers) process.kill(pid, "SIGKILL");
		const killedAt = (await cacheEntries({ cache })).length;
		const killedState = await waitForExportIdle({ page });
		evidence.workerKilled = {
			workers,
			computedFramesAtKill: killedAt,
			...killedState,
			respawned: await engineWorkers({ appPid }),
		};
		await persist();
		if (killedState.error) {
			checks.worker_killed_mid_export_recovered = false;
			await persist();
			throw new Error(
				`Export did not survive a worker crash at frame ~${killedAt}: ${killedState.error}`
			);
		}
		const afterKill = await finishExport({
			page,
			file: path.join(output, "export-worker-killed.mp4"),
			fps: FPS,
			frames: FRAMES,
			started: killStarted,
		});
		checks.worker_killed_mid_export_recovered = sameDigests(
			afterKill.frames,
			reference
		);
		expect(afterKill.frames).toEqual(reference);
		await persist();

		// 6. Restart the application: the stored project and the on-disk
		// session must reproduce the frames — first from the frame cache, then
		// with the cache emptied (checkpoint replay only).
		await app.close();
		app = await startElectronApp({ userDataDirectory });
		page = await getMainWindow(app);
		attach(page);
		await openProjectInEditor({ page, projectId });
		const afterRestart = await exportTimeline({
			app,
			page,
			file: path.join(output, "export-after-restart.mp4"),
			fps: FPS,
			frames: FRAMES,
		});
		checks.restart_cached_identical = sameDigests(
			afterRestart.frames,
			reference
		);
		expect(afterRestart.frames).toEqual(reference);
		await rm(cache, { recursive: true, force: true });
		const afterRestartRecomputed = await exportTimeline({
			app,
			page,
			file: path.join(output, "export-after-restart-recomputed.mp4"),
			fps: FPS,
			frames: FRAMES,
		});
		checks.restart_cache_cleared_identical = sameDigests(
			afterRestartRecomputed.frames,
			reference
		);
		expect(afterRestartRecomputed.frames).toEqual(reference);
		evidence.restart = {
			cachedSeconds: afterRestart.seconds,
			recomputedSeconds: afterRestartRecomputed.seconds,
			checkpoints: await checkpointFiles({ sessions }),
		};
		evidence.referenceDigests = reference;
		evidence.errors = errors;
		evidence.consoleErrors = consoleErrors;
		await persist();
		expect(errors).toEqual([]);
	} finally {
		evidence.errors = errors;
		evidence.consoleErrors = consoleErrors;
		await persist();
		await app.close();
	}
});

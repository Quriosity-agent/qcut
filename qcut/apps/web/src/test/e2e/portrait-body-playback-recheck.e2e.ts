import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { inspectBodyPlaybackCache } from "./helpers/body-playback-cache-evidence";
import {
	armBodyPlaybackEvidence,
	type BodyPlaybackFrame,
	expectPlaybackPixels,
	finishBodyPlaybackEvidence,
	installBodyPlaybackEvidence,
	playPreparedBodyClip,
	waitForEffectPlaybackReady,
} from "./helpers/body-playback-evidence";
import {
	expectBodyPlaybackTiming,
	measurePreparedBodyPlaybackTiming,
} from "./helpers/body-playback-timing";
import { openProjectInEditor } from "./helpers/body-video-editor-operations";
import type { BodyOperationFrame } from "./helpers/body-video-operation-evidence";
import {
	installBodyWorkerObserver,
	readBodyWorkerObservation,
} from "./helpers/body-video-worker-observer";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import { sampleMemory } from "./helpers/export-lifecycle-memory";
import {
	type BodyVideoWindow,
	seek,
} from "./helpers/independent-body-video-helpers";

interface SourceEvidence {
	status: string;
	userDataDirectory: string;
	gitHead: string;
	engineManifestSha256: string;
	sourceSha256: string;
	frames: number;
	fps: number;
	exportStages: { changed: BodyOperationFrame[] };
}

const sourcePath = process.env.QCUT_BODY_PLAYBACK_RECHECK_SOURCE;
const projectId = process.env.QCUT_BODY_PLAYBACK_RECHECK_PROJECT;
const output = path.resolve(
	process.env.QCUT_BODY_PLAYBACK_RECHECK_OUTPUT ??
		"output/playwright/portrait-body-playback-recheck"
);
const FRAMES = 180;
const FPS = 30;

test("body playback decoder recheck: saved test project matches its complete prior export", async () => {
	test.skip(
		!sourcePath || !existsSync(sourcePath) || !projectId,
		"Set the completed evidence JSON, saved project ID and fresh output directory"
	);
	test.setTimeout(3_600_000);
	if (!sourcePath || !projectId)
		throw new Error("Missing playback recheck inputs");
	const sourceBytes = await readFile(sourcePath);
	const source = JSON.parse(sourceBytes.toString("utf8")) as SourceEvidence;
	expect(source.status).toBe("passed");
	expect(source.frames).toBe(FRAMES);
	expect(source.fps).toBe(FPS);
	expect(source.exportStages.changed).toHaveLength(FRAMES);
	for (const [frame, reference] of source.exportStages.changed.entries()) {
		expect(reference.frame).toBe(frame);
		expect(reference.rgbaSha256).toMatch(/^[a-f0-9]{64}$/);
	}
	if (
		!path.isAbsolute(source.userDataDirectory) ||
		!existsSync(source.userDataDirectory)
	)
		throw new Error("The source test profile is unavailable");
	const manifest = await readFile(
		"research/independent-beauty/source-manifest.json"
	);
	const engineManifestSha256 = createHash("sha256")
		.update(manifest)
		.digest("hex");
	const expectedEngineManifest =
		process.env.QCUT_BODY_PLAYBACK_RECHECK_ENGINE_MANIFEST ??
		source.engineManifestSha256;
	expect(expectedEngineManifest).toMatch(/^[a-f0-9]{64}$/);
	expect(engineManifestSha256).toBe(expectedEngineManifest);
	await mkdir(output, { recursive: true });
	if (existsSync(path.join(output, "e2e-evidence.json")))
		throw new Error("Use a fresh recheck evidence directory");
	const app = await startElectronApp({
		userDataDirectory: source.userDataDirectory,
		colorProfile: "srgb",
	});
	const errors: string[] = [];
	const consoleErrors: string[] = [];
	const checks: Record<string, boolean> = {};
	const playbackStages: Record<string, BodyPlaybackFrame[]> = {};
	const evidence: Record<string, unknown> = {
		schemaVersion: 1,
		status: "running",
		projectId,
		frames: FRAMES,
		fps: FPS,
		width: 1080,
		height: 1920,
		engineManifestSha256,
		comparisonMode:
			engineManifestSha256 === source.engineManifestSha256
				? "same-engine-playback-regression"
				: "explicitly-pinned-cross-build-pixel-regression",
		importedReference: {
			path: path.resolve(sourcePath),
			sha256: createHash("sha256").update(sourceBytes).digest("hex"),
			gitHead: source.gitHead,
			engineManifestSha256: source.engineManifestSha256,
			sourceSha256: source.sourceSha256,
			stage: "changed",
			frames: source.exportStages.changed,
		},
		gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim(),
		electronBuildSha256: createHash("sha256")
			.update(await readFile("dist/electron/main.js"))
			.digest("hex"),
		frontendIndexSha256: createHash("sha256")
			.update(await readFile("apps/web/dist/index.html"))
			.digest("hex"),
		userDataDirectory: source.userDataDirectory,
		checks,
		playbackStages,
		scope:
			"Saved private test project; prior complete changed export is the pixel reference. This run rechecks preparation, playback pixels, cache and timing without re-exporting or repeating cancellation acceptance. A different engine requires an explicitly pinned manifest and does not assert identical implementation.",
	};
	const persist = () =>
		writeFile(
			path.join(output, "e2e-evidence.json"),
			`${JSON.stringify(evidence, null, 2)}\n`,
			"utf8"
		);
	try {
		const page = await getMainWindow(app);
		await page.setViewportSize({ width: 1800, height: 1100 });
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		await installBodyWorkerObserver({ app });
		await openProjectInEditor({ page, projectId });
		const edit = await page.evaluate(() => {
			const stores = window as unknown as BodyVideoWindow;
			const timeline = stores.__timelineStore.getState();
			const elements = timeline.tracks
				.flatMap((track) => track.elements)
				.filter((element) => element.type === "media");
			return {
				projectId: stores.__projectStore.getState().activeProject?.id,
				fps: stores.__projectStore.getState().activeProject?.fps,
				duration: timeline.getTotalDuration(),
				elements: elements.map((element) => ({
					id: element.id,
					mediaId: element.mediaId,
					adjustments: element.portraitAdjustments,
				})),
			};
		});
		expect(edit.projectId).toBe(projectId);
		expect(edit.fps).toBe(FPS);
		expect(edit.duration).toBe(FRAMES / FPS);
		expect(edit.elements).toHaveLength(1);
		expect(edit.elements[0].adjustments).toMatchObject({
			enabled: true,
			engine: "independent",
			values: { body_adjust_SlimBody: 55, body_adjust_StretchLeg: 30 },
		});
		evidence.storedEdit = edit;
		await installBodyPlaybackEvidence({ page, output, stages: playbackStages });
		const beforePrepare = await readBodyWorkerObservation({ app });
		const started = Date.now();
		await page.getByTestId("prepare-effect-playback").click();
		const generation = await waitForEffectPlaybackReady({ page });
		const afterPrepare = await readBodyWorkerObservation({ app });
		evidence.preparation = {
			generation,
			milliseconds: Date.now() - started,
			workerCompletedBefore: beforePrepare.completed,
			workerCompletedAfter: afterPrepare.completed,
			stageTimings: await page
				.getByTestId("effect-playback-status")
				.evaluate((element) => ({
					renderMs: Number(element.getAttribute("data-render-ms")),
					encodeMs: Number(element.getAttribute("data-encode-ms")),
					writeMs: Number(element.getAttribute("data-write-ms")),
					wallMs: Number(element.getAttribute("data-wall-ms")),
					maxInFlightFrames: Number(
						element.getAttribute("data-preparation-inflight")
					),
					maxReservedPixelBytes: Number(
						element.getAttribute("data-preparation-rgba-bytes")
					),
					maxPendingPngBytes: Number(
						element.getAttribute("data-preparation-png-bytes")
					),
				})),
		};
		evidence.cache = await inspectBodyPlaybackCache({
			page,
			sessionId: await page
				.getByTestId("effect-playback-status")
				.getAttribute("data-session-id"),
			reference: source.exportStages.changed,
		});
		checks.all_cached_frames_match_prior_export = true;
		await persist();
		evidence.memoryBefore = await sampleMemory({ electronApp: app });
		const beforePlayback = await readBodyWorkerObservation({ app });
		const capture = await playPreparedBodyClip({
			page,
			stage: "recheck-pixels",
			frames: FRAMES,
			fps: FPS,
		});
		evidence.pixelPlayback = capture;
		await persist();
		evidence.pixelMetrics = expectPlaybackPixels({
			capture,
			reference: source.exportStages.changed,
			generation,
			frames: FRAMES,
			fps: FPS,
		});
		checks.actual_presented_pixels_match_prior_export = true;
		const timing = await measurePreparedBodyPlaybackTiming({
			page,
			frames: FRAMES,
			fps: FPS,
		});
		evidence.playbackTiming = timing;
		await persist();
		expectBodyPlaybackTiming({ capture: timing, generation, frames: FRAMES });
		checks.lightweight_playback_near_realtime = true;
		const afterPlayback = await readBodyWorkerObservation({ app });
		expect(afterPlayback.completed).toBe(beforePlayback.completed);
		checks.playback_uses_prepared_cache = true;
		evidence.playbackWorker = {
			before: beforePlayback.completed,
			after: afterPlayback.completed,
		};
		await armBodyPlaybackEvidence({ page, stage: "seek-90" });
		await seek({ page, frame: 90, fps: FPS });
		await expect(page.getByTestId("effect-playback-canvas")).toHaveAttribute(
			"data-frame",
			"90"
		);
		const seekCapture = await finishBodyPlaybackEvidence({ page });
		expect(seekCapture.errors).toEqual([]);
		expect(seekCapture.frames).toHaveLength(1);
		expect(seekCapture.frames[0].generation).toBe(generation);
		expect(seekCapture.frames[0].rgbaSha256).toBe(
			source.exportStages.changed[90].rgbaSha256
		);
		checks.seek_matches_prior_export = true;
		await page.screenshot({ path: path.join(output, "seek-90-ui.png") });
		evidence.memoryAfter = await sampleMemory({ electronApp: app });
		expect(errors).toEqual([]);
		evidence.status = "passed";
	} catch (error) {
		evidence.status = "failed";
		evidence.failure =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
		throw error;
	} finally {
		evidence.errors = errors;
		evidence.consoleErrors = consoleErrors;
		await persist();
		await app.close();
	}
});

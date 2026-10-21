import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
	beginBodyPlaybackCacheOwnershipProbe,
	finishBodyPlaybackCacheOwnershipProbe,
} from "./helpers/body-playback-cache-ownership";
import { inspectBodyPlaybackCache } from "./helpers/body-playback-cache-evidence";
import {
	type BodyPlaybackFrame,
	expectPlaybackPixels,
	installBodyPlaybackEvidence,
	playPreparedBodyClip,
	waitForEffectPlaybackReady,
} from "./helpers/body-playback-evidence";
import {
	expectBodyPlaybackTiming,
	measurePreparedBodyPlaybackTiming,
} from "./helpers/body-playback-timing";
import { BODY_CLOSE_VALUES } from "./helpers/body-video-close-scenario";
import { readBodyPreparationMetrics } from "./helpers/body-playback-resource-probe";
import {
	installNativeBodyRenderObserver,
	readNativeBodyRenderObservation,
} from "./helpers/body-native-render-observer";
import {
	armBodyOperationEvidence,
	type BodyOperationFrame,
	installBodyOperationEvidence,
} from "./helpers/body-video-operation-evidence";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import { sampleMemory } from "./helpers/export-lifecycle-memory";
import { exportTimeline } from "./helpers/independent-body-video-helpers";
import {
	preparePortraitReferenceProject,
	type ReferenceWindow,
} from "./helpers/portrait-reference";

const source = process.env.QCUT_BODY_CLOSE_SOURCE;
const output = path.resolve(
	process.env.QCUT_NATIVE_BODY_PLAYBACK_OUTPUT ??
		"output/playwright/portrait-native-body-playback"
);
const FPS = 30;
const SECONDS = Number(process.env.QCUT_NATIVE_BODY_PLAYBACK_SECONDS ?? 2);
const FRAMES = SECONDS * FPS;
if (!Number.isInteger(FRAMES) || FRAMES < 36 || FRAMES > 1800)
	throw new Error("Native playback acceptance requires 36..1800 whole frames");

test("native body: prepared lossless continuous playback matches the default native export", async () => {
	test.skip(
		!source || !existsSync(source),
		"Set QCUT_BODY_CLOSE_SOURCE to the local 1080×1920 source"
	);
	test.setTimeout(3_600_000);
	if (!source) throw new Error("Missing native body playback source");
	await mkdir(output, { recursive: true });
	if (existsSync(path.join(output, "e2e-evidence.json")))
		throw new Error("Use a fresh native playback evidence directory");
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-native-body-playback-")
	);
	const app = await startElectronApp({
		userDataDirectory,
		colorProfile: "srgb",
	});
	const errors: string[] = [];
	const consoleErrors: string[] = [];
	const checks: Record<string, boolean> = {};
	const exportStages: Record<string, BodyOperationFrame[]> = {};
	const playbackStages: Record<string, BodyPlaybackFrame[]> = {};
	const evidence: Record<string, unknown> = {
		schemaVersion: 1,
		status: "running",
		source: path.basename(source),
		sourceSha256: createHash("sha256")
			.update(await readFile(source))
			.digest("hex"),
		gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim(),
		electronBuildSha256: createHash("sha256")
			.update(await readFile("dist/electron/main.js"))
			.digest("hex"),
		frontendIndexSha256: createHash("sha256")
			.update(await readFile("apps/web/dist/index.html"))
			.digest("hex"),
		frames: FRAMES,
		fps: FPS,
		width: 1080,
		height: 1920,
		values: BODY_CLOSE_VALUES,
		profile:
			"Product default native Swing/CoreML; no backend or algorithm overrides",
		userDataDirectory,
		checks,
		exportStages,
		playbackStages,
		acceptance: {
			minimumPresentedCoverage: 0.8,
			maximumDecodedFrames: 6,
			maximumDecodedBytes: 64 * 1024 * 1024,
			pixelComparison:
				"All cached PNG frames and every captured presented RGBA frame vs same-index native pre-encode export RGBA SHA256",
			scope:
				"Native preview/export consistency only; no native cancellation, crash recovery, independent parity, long-duration memory or AV-sync claim",
		},
	};
	const persist = () =>
		writeFile(
			path.join(output, "e2e-evidence.json"),
			`${JSON.stringify(evidence, null, 2)}\n`,
			"utf8"
		);
	let closing = false;
	app.process().once("exit", (code, signal) => {
		if (!closing)
			errors.push(
				`Electron exited unexpectedly (code ${code}, signal ${signal})`
			);
	});
	try {
		const page = await getMainWindow(app);
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		await installNativeBodyRenderObserver({ app });
		await preparePortraitReferenceProject({
			page,
			source,
			duration: SECONDS,
			canvasSize: { width: 1080, height: 1920 },
		});
		const runtime = await page.evaluate(async () =>
			window.electronAPI?.jianyingPortraitAdjustment?.inspect?.()
		);
		expect(runtime?.available).toBe(true);
		expect(runtime?.state).toBe("ready");
		evidence.runtime = runtime;
		await page.evaluate((values) => {
			const timeline = (
				window as unknown as ReferenceWindow
			).__timelineStore.getState();
			const track = timeline.tracks.find((candidate) =>
				candidate.elements.some((element) => element.type === "media")
			);
			const element = track?.elements.find(
				(candidate) => candidate.type === "media"
			);
			if (!track || !element) throw new Error("Missing native body clip");
			timeline.updateMediaElement(track.id, element.id, {
				portraitAdjustments: {
					enabled: true,
					engine: "native",
					values,
				},
			});
		}, BODY_CLOSE_VALUES);
		await installBodyOperationEvidence({ page, output, stages: exportStages });
		await installBodyPlaybackEvidence({ page, output, stages: playbackStages });
		if (process.env.QCUT_NATIVE_BODY_PLAYBACK_COLD_PREPARE === "1") {
			const before = await readNativeBodyRenderObservation({ app });
			const started = Date.now();
			await page.getByTestId("prepare-effect-playback").click();
			await waitForEffectPlaybackReady({ page });
			const after = await readNativeBodyRenderObservation({ app });
			const requests = after.finished.slice(before.finished.length);
			evidence.coldPreparation = {
				milliseconds: Date.now() - started,
				stageTimings: await readBodyPreparationMetrics({ page }),
				requests,
			};
			await persist();
			expect(
				requests.some((request) => (request.nativeRenderCount ?? 0) > 0)
			).toBe(true);
			await page.getByTestId("cancel-effect-playback").click();
			await expect(page.getByTestId("effect-playback-status")).toHaveAttribute(
				"data-status",
				"idle"
			);
			await expect(page.getByTestId("effect-playback-canvas")).toHaveCount(0);
			checks.cold_preparation_completed = true;
		}
		await armBodyOperationEvidence({
			page,
			stage: "native",
			frames: FRAMES,
			samples: [0, Math.floor(FRAMES / 2), FRAMES - 1],
		});
		const beforeExport = await readNativeBodyRenderObservation({ app });
		evidence.export = await exportTimeline({
			app,
			page,
			file: path.join(output, "export-native.mp4"),
			fps: FPS,
			frames: FRAMES,
		});
		const afterExport = await readNativeBodyRenderObservation({ app });
		evidence.nativeExportRequests = afterExport.finished.slice(
			beforeExport.finished.length
		);
		expect(exportStages.native).toHaveLength(FRAMES);
		const referencePath = process.env.QCUT_NATIVE_BODY_PLAYBACK_REFERENCE;
		if (referencePath) {
			const referenceBytes = await readFile(referencePath);
			const reference = JSON.parse(referenceBytes.toString("utf8")) as {
				status: string;
				fps: number;
				width: number;
				height: number;
				sourceSha256: string;
				values: typeof BODY_CLOSE_VALUES;
				exportStages: { native: BodyOperationFrame[] };
			};
			expect(reference.status).toBe("passed");
			expect(reference.fps).toBe(FPS);
			expect(reference.width).toBe(1080);
			expect(reference.height).toBe(1920);
			expect(reference.values).toEqual(BODY_CLOSE_VALUES);
			expect(reference.sourceSha256).toBe(evidence.sourceSha256);
			expect(reference.exportStages.native.length).toBeGreaterThanOrEqual(
				FRAMES
			);
			for (const [index, frame] of exportStages.native.entries()) {
				expect(frame.frame).toBe(index);
				expect(reference.exportStages.native[index].frame).toBe(index);
				expect(frame.rgbaSha256).toBe(
					reference.exportStages.native[index].rgbaSha256
				);
			}
			evidence.priorNativeReference = {
				path: path.resolve(referencePath),
				sha256: createHash("sha256").update(referenceBytes).digest("hex"),
				framesCompared: FRAMES,
			};
			checks.native_export_matches_prior_build = true;
		}
		await persist();

		evidence.cacheOwnershipBefore = await beginBodyPlaybackCacheOwnershipProbe({
			page,
		});
		const preparationStarted = Date.now();
		const beforePreparation = await readNativeBodyRenderObservation({ app });
		await page.getByTestId("prepare-effect-playback").click();
		const generation = await waitForEffectPlaybackReady({ page });
		const preparationMilliseconds = Date.now() - preparationStarted;
		evidence.preparation = {
			generation,
			milliseconds: preparationMilliseconds,
			stageTimings: await readBodyPreparationMetrics({ page }),
		};
		const afterPreparation = await readNativeBodyRenderObservation({ app });
		const preparationRequests = afterPreparation.finished.slice(
			beforePreparation.finished.length
		);
		evidence.nativePreparationRequests = preparationRequests;
		await persist();
		if (process.env.QCUT_NATIVE_BODY_PLAYBACK_EXPECT_CACHE === "1") {
			const sourceWindows = preparationRequests.filter(
				(request) =>
					request.completed &&
					request.freshTracking &&
					request.sourceKey?.startsWith("source-window-v1:")
			);
			expect(sourceWindows.length).toBeGreaterThanOrEqual(FRAMES);
			// Source PTS follows the original media cadence, not the 30fps timeline.
			const frames = new Set(
				sourceWindows.map((request) => request.frameNumber)
			);
			for (let frame = 0; frame < FRAMES; frame++)
				expect(frames.has(frame)).toBe(true);
			for (const request of sourceWindows) {
				expect(request.sourceWindowCacheHit).toBe(true);
				expect(request.nativeRenderCount).toBe(0);
			}
			checks.preparation_reuses_every_native_source_window = true;
		}
		evidence.cacheOwnershipAfter = await finishBodyPlaybackCacheOwnershipProbe({
			page,
		});
		checks.crashed_cache_owner_reclaimed_live_owner_retained = true;
		const status = page.getByTestId("effect-playback-status");
		expect(Number(await status.getAttribute("data-completed"))).toBe(FRAMES);
		expect(Number(await status.getAttribute("data-total"))).toBe(FRAMES);
		await page.screenshot({
			path: path.join(output, "native-prepared-ui.png"),
		});
		evidence.cache = await inspectBodyPlaybackCache({
			page,
			sessionId: await status.getAttribute("data-session-id"),
			reference: exportStages.native,
		});
		checks.all_cached_frames_match_native_export = true;
		await persist();
		evidence.memoryBeforePlayback = await sampleMemory({ electronApp: app });
		const capture = await playPreparedBodyClip({
			page,
			stage: "native-play",
			frames: FRAMES,
			fps: FPS,
		});
		evidence.memoryAfterPlayback = await sampleMemory({ electronApp: app });
		evidence.playback = expectPlaybackPixels({
			capture,
			reference: exportStages.native,
			generation,
			frames: FRAMES,
			fps: FPS,
		});
		checks.continuous_native_playback_matches_export = true;
		const timing = await measurePreparedBodyPlaybackTiming({
			page,
			frames: FRAMES,
			fps: FPS,
		});
		evidence.playbackTiming = timing;
		await persist();
		expectBodyPlaybackTiming({ capture: timing, generation, frames: FRAMES });
		checks.lightweight_native_playback_near_realtime = true;
		checks.decoded_cache_stays_bounded = true;
		await page.screenshot({ path: path.join(output, "native-played-ui.png") });
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
		closing = true;
		await app.close();
	}
});

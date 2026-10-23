import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { inspectBodyPlaybackCache } from "./helpers/body-playback-cache-evidence";
import {
	expectBodyPlaybackTiming,
	measurePreparedBodyPlaybackTiming,
} from "./helpers/body-playback-timing";
import { BODY_CLOSE_VALUES } from "./helpers/body-video-close-scenario";
import { changeSlimBody } from "./helpers/body-video-editor-operations";
import {
	armBodyOperationEvidence,
	type BodyOperationFrame,
	installBodyOperationEvidence,
} from "./helpers/body-video-operation-evidence";
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
	installBodyWorkerObserver,
	readBodyWorkerObservation,
	waitForInFlightBodyFrame,
} from "./helpers/body-video-worker-observer";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import { sampleMemory } from "./helpers/export-lifecycle-memory";
import {
	exportTimeline,
	seek,
	setBodyValues,
} from "./helpers/independent-body-video-helpers";
import { preparePortraitReferenceProject } from "./helpers/portrait-reference";
import {
	COREML_BODY_PROFILE,
	requestedBodyVideoProfile,
	selectCoreMLBodyProfile,
	captureCoreMLBodyExecutionEvidence,
} from "./helpers/body-video-profile-evidence";

const source = process.env.QCUT_BODY_CLOSE_SOURCE;
const bodyProfile = requestedBodyVideoProfile();
const coreml = bodyProfile === COREML_BODY_PROFILE;
const output = path.resolve(
	process.env.QCUT_BODY_PLAYBACK_OUTPUT ??
		"output/playwright/portrait-independent-body-playback"
);
const FPS = 30;
const SECONDS = Number(process.env.QCUT_BODY_PLAYBACK_SECONDS ?? 6);
const FRAMES = SECONDS * FPS;
if (!Number.isInteger(FRAMES) || FRAMES < 36 || FRAMES > 1800)
	throw new Error("Playback acceptance requires 36..1800 whole frames");

test("independent body: prepared continuous playback matches export and rejects obsolete edits and cancelled work", async () => {
	test.skip(
		!source || !existsSync(source),
		"Set QCUT_BODY_CLOSE_SOURCE to the local 1080×1920 source"
	);
	test.setTimeout(10_800_000);
	if (!source) throw new Error("Missing body playback source");
	await mkdir(output, { recursive: true });
	if (existsSync(path.join(output, "e2e-evidence.json")))
		throw new Error("Use a fresh playback evidence directory");
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-body-playback-")
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
	const memory: Array<Record<string, unknown>> = [];
	const evidence: Record<string, unknown> = {
		schemaVersion: 1,
		status: "running",
		bodyProfile,
		source: path.basename(source),
		sourceSha256: createHash("sha256")
			.update(await readFile(source))
			.digest("hex"),
		gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim(),
		engineManifestSha256: createHash("sha256")
			.update(
				await readFile("research/independent-beauty/source-manifest.json")
			)
			.digest("hex"),
		frames: FRAMES,
		fps: FPS,
		width: 1080,
		height: 1920,
		values: BODY_CLOSE_VALUES,
		userDataDirectory,
		checks,
		exportStages,
		playbackStages,
		memory,
		acceptance: {
			minimumPresentedCoverage: 0.8,
			maximumDecodedFrames: 6,
			maximumDecodedBytes: 64 * 1024 * 1024,
			pixelComparison:
				"Every captured presented RGBA frame vs same-index pre-encode export RGBA SHA256",
			scope:
				"Single-person silent short clip; observed process memory is not long-duration leak or AV-sync acceptance",
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
		await installBodyWorkerObserver({
			app,
			...(coreml ? { output: path.join(output, "worker-reports") } : {}),
		});
		const { panel } = await preparePortraitReferenceProject({
			page,
			source,
			duration: SECONDS,
			canvasSize: { width: 1080, height: 1920 },
		});
		await installBodyOperationEvidence({ page, output, stages: exportStages });
		await installBodyPlaybackEvidence({ page, output, stages: playbackStages });
		await panel
			.getByRole("combobox", { name: "美颜处理引擎", exact: true })
			.click();
		await page.getByRole("option", { name: "自研", exact: true }).click();
		await expect(page.getByTestId("portrait-engine-runtime")).toHaveCount(0, {
			timeout: 120_000,
		});
		const runtime = await page.evaluate(async () =>
			window.electronAPI?.beautyLab?.inspectIndependent?.()
		);
		expect(runtime?.available).toBe(true);
		expect(runtime?.bodyVideo).toBe(true);
		evidence.runtime = runtime;
		if (coreml) {
			expect(runtime?.bodyVideoProfiles?.[COREML_BODY_PROFILE]?.available).toBe(
				true
			);
			evidence.profileSelection = await selectCoreMLBodyProfile({
				page,
				output: path.join(output, "coreml-ui-selection.png"),
			});
		}
		await setBodyValues({ page, values: BODY_CLOSE_VALUES });
		await changeSlimBody({ page, value: 55 });
		await changeSlimBody({ page, value: 40 });
		const status = page.getByTestId("effect-playback-status");
		const canvas = page.getByTestId("effect-playback-canvas");
		const sample = async ({ label }: { label: string }) => {
			memory.push({
				label,
				at: new Date().toISOString(),
				processes: await sampleMemory({ electronApp: app }),
			});
		};
		const exportStage = async ({ stage }: { stage: string }) => {
			await armBodyOperationEvidence({
				page,
				stage,
				frames: FRAMES,
				samples: [0, Math.floor(FRAMES / 2), FRAMES - 1],
			});
			const exported = await exportTimeline({
				app,
				page,
				file: path.join(output, `export-${stage}.mp4`),
				fps: FPS,
				frames: FRAMES,
			});
			expect(exportStages[stage]).toHaveLength(FRAMES);
			evidence[`export-${stage}`] = exported;
			await persist();
		};
		const prepare = async () => {
			const started = Date.now();
			await page.getByTestId("prepare-effect-playback").click();
			const generation = await waitForEffectPlaybackReady({ page });
			expect(Number(await status.getAttribute("data-completed"))).toBe(FRAMES);
			expect(Number(await status.getAttribute("data-total"))).toBe(FRAMES);
			return {
				generation,
				milliseconds: Date.now() - started,
				sessionId: await status.getAttribute("data-session-id"),
			};
		};
		const play = async ({
			stage,
			reference,
			generation,
		}: {
			stage: string;
			reference: string;
			generation: string;
		}) => {
			const before = await readBodyWorkerObservation({ app });
			await sample({ label: `${stage}-before` });
			const capture = await playPreparedBodyClip({
				page,
				stage,
				frames: FRAMES,
				fps: FPS,
			});
			await sample({ label: `${stage}-after` });
			await page.screenshot({ path: path.join(output, `${stage}-ui.png`) });
			const metrics = expectPlaybackPixels({
				capture,
				reference: exportStages[reference],
				generation,
				frames: FRAMES,
				fps: FPS,
			});
			const after = await readBodyWorkerObservation({ app });
			expect(
				after.completed,
				"Prepared playback must not render body frames"
			).toBe(before.completed);
			evidence[stage] = {
				...metrics,
				workerCompletedBefore: before.completed,
				workerCompletedAfter: after.completed,
			};
			await persist();
		};

		const measureTiming = async ({
			stage,
			generation,
		}: {
			stage: string;
			generation: string;
		}) => {
			const before = await readBodyWorkerObservation({ app });
			const capture = await measurePreparedBodyPlaybackTiming({
				page,
				frames: FRAMES,
				fps: FPS,
			});
			const after = await readBodyWorkerObservation({ app });
			evidence[stage] = {
				...capture,
				workerCompletedBefore: before.completed,
				workerCompletedAfter: after.completed,
			};
			await persist();
			expectBodyPlaybackTiming({ capture, generation, frames: FRAMES });
			expect(after.completed, "Timing playback must use prepared frames").toBe(
				before.completed
			);
		};

		await exportStage({ stage: "baseline" });
		const initial = await prepare();
		evidence.initialPreparation = initial;
		await page.screenshot({
			path: path.join(output, "baseline-prepared-ui.png"),
		});
		evidence.baselineCache = await inspectBodyPlaybackCache({
			page,
			sessionId: initial.sessionId,
			reference: exportStages.baseline,
		});
		checks.all_cached_frames_match_export = true;
		await play({
			stage: "baseline-play",
			reference: "baseline",
			generation: initial.generation,
		});
		checks.continuous_playback_matches_export = true;
		await play({
			stage: "repeat-play",
			reference: "baseline",
			generation: initial.generation,
		});
		checks.repeat_playback_uses_prepared_cache = true;
		await measureTiming({
			stage: "baseline-play-timing",
			generation: initial.generation,
		});
		checks.lightweight_playback_near_realtime = true;

		await armBodyPlaybackEvidence({ page, stage: "ready-seeks" });
		await [FRAMES - 2, 1, Math.floor(FRAMES / 2)].reduce(
			async (previous, frame) => {
				await previous;
				await seek({ page, frame, fps: FPS });
				await expect(canvas).toHaveAttribute("data-frame", String(frame));
			},
			Promise.resolve()
		);
		const seeks = await finishBodyPlaybackEvidence({ page });
		expect(seeks.errors).toEqual([]);
		expect(seeks.frames.length).toBeGreaterThanOrEqual(3);
		for (const frame of seeks.frames) {
			expect(frame.generation).toBe(initial.generation);
			expect(frame.rgbaSha256).toBe(
				exportStages.baseline[frame.frame].rgbaSha256
			);
		}
		checks.prepared_seeks_match_export = true;

		const cancelPending = async ({
			reason,
			action,
		}: {
			reason: string;
			action: () => Promise<void>;
		}) => {
			const before = await readBodyWorkerObservation({ app });
			const pending = await waitForInFlightBodyFrame({ app, minimumFrame: 1 });
			await armBodyPlaybackEvidence({ page, stage: reason });
			await action();
			await expect(status).toHaveAttribute("data-status", "idle");
			await expect(canvas).toBeHidden();
			await expect
				.poll(
					async () =>
						(await readBodyWorkerObservation({ app })).cancellations.length,
					{ timeout: 30_000 }
				)
				.toBeGreaterThan(before.cancellations.length);
			const cancellations = (
				await readBodyWorkerObservation({ app })
			).cancellations.slice(before.cancellations.length);
			const inFlight = cancellations.find(
				(entry) =>
					entry.cancelled &&
					entry.sequenceRequest &&
					entry.pending.some(
						(request) =>
							request.frame === entry.sequenceRequest?.frame &&
							request.startedAt >= entry.sequenceRequest.enteredAt
					)
			);
			expect(
				inFlight,
				"Actual preparation cancellation must enter with a body frame pending"
			).toBeDefined();
			await expect
				.poll(
					async () =>
						(await readBodyWorkerObservation({ app })).sequenceRequests.some(
							(request) => request.requestId === inFlight?.requestId
						),
					{ timeout: 30_000 }
				)
				.toBe(false);
			await expect(status).toHaveAttribute("data-status", "idle");
			const obsolete = await finishBodyPlaybackEvidence({ page });
			expect(obsolete.errors).toEqual([]);
			expect(obsolete.frames).toEqual([]);
			evidence[reason] = {
				pending,
				cancellations,
				inFlight,
				latePresentedFrames: obsolete.frames.length,
			};
			await persist();
		};
		await changeSlimBody({ page, value: 55 });
		await expect(status).toHaveAttribute("data-status", "idle");
		await expect(canvas).toBeHidden();
		await page.getByTestId("prepare-effect-playback").click();
		await expect(status).toHaveAttribute("data-status", "preparing");
		await cancelPending({
			reason: "parameter-invalidation",
			action: () => changeSlimBody({ page, value: 60 }),
		});
		checks.parameter_change_cancels_pending_and_hides_old_effect = true;

		await changeSlimBody({ page, value: 55 });
		await rm(
			path.join(userDataDirectory, "Cache", "independent-beauty-frames"),
			{ recursive: true, force: true }
		);
		await page.getByTestId("prepare-effect-playback").click();
		await expect(status).toHaveAttribute("data-status", "preparing");
		await cancelPending({
			reason: "manual-cancel",
			action: () => page.getByTestId("cancel-effect-playback").click(),
		});
		checks.manual_cancel_has_no_late_frames = true;
		await exportStage({ stage: "changed" });
		expect(
			exportStages.changed.filter(
				(frame, index) =>
					frame.rgbaSha256 !== exportStages.baseline[index].rgbaSha256
			).length
		).toBeGreaterThan(0);
		const changed = await prepare();
		evidence.changedPreparation = changed;
		await page.screenshot({
			path: path.join(output, "changed-prepared-ui.png"),
		});
		expect(changed.generation).not.toBe(initial.generation);
		evidence.changedCache = await inspectBodyPlaybackCache({
			page,
			sessionId: changed.sessionId,
			reference: exportStages.changed,
		});
		await play({
			stage: "changed-play",
			reference: "changed",
			generation: changed.generation,
		});
		checks.changed_playback_matches_changed_export = true;
		await measureTiming({
			stage: "changed-play-timing",
			generation: changed.generation,
		});
		checks.changed_lightweight_playback_near_realtime = true;
		checks.decoded_cache_stays_bounded = true;
		if (coreml) {
			evidence.coremlExecution = await captureCoreMLBodyExecutionEvidence({
				app,
				output: path.join(output, "execution"),
				frames: FRAMES,
			});
			checks.coreml_execution_identity_and_routes_verified = true;
		}
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

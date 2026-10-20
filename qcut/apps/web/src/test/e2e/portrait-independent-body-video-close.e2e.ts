import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	type ElectronApplication,
	expect,
	type Page,
	test,
} from "@playwright/test";
import {
	changeSlimBody,
	type ExportStoreWindow,
	openProjectInEditor,
	waitForExportIdle,
} from "./helpers/body-video-editor-operations";
import { BODY_CLOSE_VALUES } from "./helpers/body-video-close-scenario";
import {
	armBodyOperationEvidence,
	type BodyOperationFrame,
	captureBodyOperationPreview,
	expectBodyOperationFrames,
	installBodyOperationEvidence,
} from "./helpers/body-video-operation-evidence";
import {
	installBodyWorkerObserver,
	readBodyWorkerObservation,
	waitForInFlightBodyFrame,
} from "./helpers/body-video-worker-observer";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import {
	cacheEntries,
	checkpointFiles,
	exportTimeline,
	finishExport,
	seek,
	waitForPausedFrame,
	setBodyValues,
	startExport,
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
if (!Number.isInteger(FRAMES) || FRAMES < 36 || FRAMES > 1800)
	throw new Error("Body operation acceptance requires 36..1800 whole frames");
const INTERFERE_AFTER_FRAMES = Math.min(30, Math.floor(FRAMES / 2));
const SEEK_ORDER = [FRAMES - 1, 0, Math.floor(FRAMES / 2), 1, FRAMES - 2];
const SAMPLES = [...SEEK_ORDER].sort((left, right) => left - right);

test("independent body: parameter edits, cold seeks, cancellation and in-flight worker recovery preserve every export frame", async () => {
	test.skip(
		!source || !existsSync(source),
		"Set QCUT_BODY_CLOSE_SOURCE to the real 1080×1920 body source"
	);
	test.setTimeout(10_800_000);
	if (!source) throw new Error("Missing body source");
	await mkdir(output, { recursive: true });
	if (existsSync(path.join(output, "e2e-evidence.json")))
		throw new Error("Use a fresh operation evidence directory");
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
	let app: ElectronApplication = await startElectronApp({
		userDataDirectory,
		colorProfile: "srgb",
	});
	const errors: string[] = [];
	const consoleErrors: string[] = [];
	let closing = false;
	const watchExit = ({ application }: { application: ElectronApplication }) =>
		application.process().once("exit", (code, signal) => {
			if (!closing)
				errors.push(
					`Electron exited unexpectedly (code ${code}, signal ${signal}) at ${new Date().toISOString()}`
				);
		});
	watchExit({ application: app });
	const checks: Record<string, boolean> = {};
	const preEncodeStages: Record<string, BodyOperationFrame[]> = {};
	const previews: Array<Record<string, unknown>> = [];
	const evidence: Record<string, unknown> = {
		schemaVersion: 2,
		status: "running",
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
		preEncodeStages,
		previews,
		comparison:
			"All frames use pre-encode RGBA SHA256 and decoded-export MD5; sampled preview PNGs compare only to their own engine and edit",
	};
	const persist = () =>
		writeFile(
			path.join(output, "e2e-evidence.json"),
			`${JSON.stringify(evidence, null, 2)}\n`,
			"utf8"
		);
	const attach = async ({ page }: { page: Page }) => {
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		await installBodyOperationEvidence({
			page,
			output,
			stages: preEncodeStages,
		});
	};
	try {
		let page = await getMainWindow(app);
		await installBodyWorkerObserver({ app });
		await attach({ page });
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
		const status = await page.evaluate(async () =>
			window.electronAPI?.beautyLab?.inspectIndependent?.()
		);
		expect(status?.available).toBe(true);
		expect(status?.bodyVideo).toBe(true);
		evidence.runtimeStatus = status;
		await setBodyValues({ page, values: BODY_CLOSE_VALUES });
		await changeSlimBody({ page, value: 55 });
		await changeSlimBody({ page, value: 40 });
		evidence.parameterControlPreflight = [40, 55, 40];
		await persist();

		const exportStage = async ({ stage }: { stage: string }) => {
			await armBodyOperationEvidence({
				page,
				stage,
				frames: FRAMES,
				samples: SAMPLES,
			});
			const exported = await exportTimeline({
				app,
				page,
				file: path.join(output, `export-${stage}.mp4`),
				fps: FPS,
				frames: FRAMES,
			});
			expect(preEncodeStages[stage]).toHaveLength(FRAMES);
			evidence[stage] = {
				seconds: exported.seconds,
				decodedFrameDigests: exported.frames,
			};
			await persist();
			return exported;
		};
		const compare = ({
			stage,
			decoded,
			reference,
		}: {
			stage: string;
			decoded: string[];
			reference: string[];
		}) => {
			expectBodyOperationFrames({
				stages: preEncodeStages,
				actual: stage,
				reference: "sequential",
				frames: FRAMES,
			});
			expect(decoded).toEqual(reference);
		};
		const previewStage = async ({
			stage,
			reference,
			order = SAMPLES,
			cold = false,
		}: {
			stage: string;
			reference: string;
			order?: number[];
			cold?: boolean;
		}) => {
			await order.reduce(async (previous, frame) => {
				await previous;
				if (cold) {
					const anchor = frame === 0 ? FRAMES - 1 : 0;
					await seek({ page, frame: anchor, fps: FPS });
					await waitForPausedFrame({ page, frame: anchor, timeout: 300_000 });
					await rm(cache, { recursive: true, force: true });
					expect(await cacheEntries({ cache })).toHaveLength(0);
				}
				const observation = await readBodyWorkerObservation({ app });
				previews.push({
					stage,
					...(await captureBodyOperationPreview({
						page,
						output,
						stage,
						frame,
						fps: FPS,
						expected: preEncodeStages[reference][frame].rgbaSha256,
					})),
				});
				if (cold) {
					const after = await readBodyWorkerObservation({ app });
					expect(
						after.completed,
						`cold seek ${frame} must reach the worker`
					).toBeGreaterThan(observation.completed);
				}
				await persist();
			}, Promise.resolve());
		};

		const sequential = await exportStage({ stage: "sequential" });
		const reference = sequential.frames;
		expect(new Set(reference).size).toBeGreaterThan(FRAMES / 2);
		const checkpoints = await checkpointFiles({ sessions });
		expect(Object.keys(checkpoints).length).toBeGreaterThanOrEqual(1);
		evidence.initialCheckpoints = checkpoints;
		await previewStage({ stage: "sequential", reference: "sequential" });
		checks.sequential_preview_export_identical = true;

		await changeSlimBody({ page, value: 55 });
		await rm(cache, { recursive: true, force: true });
		const changed = await exportStage({ stage: "parameter-changed" });
		const changedFrames = preEncodeStages["parameter-changed"]
			.filter(
				(frame, index) =>
					frame.rgbaSha256 !== preEncodeStages.sequential[index].rgbaSha256
			)
			.map(({ frame }) => frame);
		evidence.parameterChange = {
			control: "body_adjust_SlimBody",
			from: 40,
			to: 55,
			changedFrames,
		};
		expect(changedFrames.length).toBeGreaterThan(0);
		expect(changed.frames).not.toEqual(reference);
		await previewStage({
			stage: "parameter-changed",
			reference: "parameter-changed",
		});
		checks.parameter_change_visible_and_preview_export_identical = true;
		await changeSlimBody({ page, value: 40 });

		// Every target starts without disk frame results; worker activity rejects a warm-preview false pass.
		await previewStage({
			stage: "cold-seek-restored",
			reference: "sequential",
			order: SEEK_ORDER,
			cold: true,
		});
		await rm(cache, { recursive: true, force: true });
		const restored = await exportStage({ stage: "restored-cold-seek" });
		compare({
			stage: "restored-cold-seek",
			decoded: restored.frames,
			reference,
		});
		checks.parameter_restore_and_cold_seek_identical = true;
		checks.cache_cleared_identical = true;
		await persist();

		await rm(cache, { recursive: true, force: true });
		await armBodyOperationEvidence({
			page,
			stage: "cancelled",
			frames: FRAMES,
			samples: SAMPLES,
		});
		await startExport({
			app,
			page,
			file: path.join(output, "export-cancelled.mp4"),
			fps: FPS,
		});
		await expect
			.poll(() => preEncodeStages.cancelled?.length ?? 0, { timeout: 600_000 })
			.toBeGreaterThanOrEqual(INTERFERE_AFTER_FRAMES);
		const cancellationsBefore = (await readBodyWorkerObservation({ app }))
			.cancellations.length;
		const requestObservedBeforeClick = await waitForInFlightBodyFrame({
			app,
			minimumFrame: INTERFERE_AFTER_FRAMES,
		});
		await page.getByRole("button", { name: "Cancel Export" }).click();
		const cancelled = await waitForExportIdle({ page });
		await expect
			.poll(
				async () =>
					(await readBodyWorkerObservation({ app })).cancellations.length,
				{ timeout: 30_000 }
			)
			.toBeGreaterThan(cancellationsBefore);
		const cancelEntries = (
			await readBodyWorkerObservation({ app })
		).cancellations.slice(cancellationsBefore);
		const pendingAtCancel = cancelEntries.find((entry) => {
			const request = entry.sequenceRequest;
			return (
				entry.cancelled === true &&
				request &&
				request.frame >= INTERFERE_AFTER_FRAMES &&
				entry.activeSequenceRequests.filter(
					(candidate) => candidate.frame === request.frame
				).length === 1 &&
				entry.pending.some(
					(pending) =>
						pending.frame === request.frame &&
						pending.startedAt >= request.enteredAt
				)
			);
		});
		evidence.cancelled = {
			...cancelled,
			requestObservedBeforeClick,
			cancelHandlerEntries: cancelEntries,
			pendingAtCancel,
			capturedFrames: preEncodeStages.cancelled?.length ?? 0,
		};
		expect(
			pendingAtCancel,
			"Actual cancel IPC must enter with its frame request pending"
		).toBeDefined();
		checks.cancel_ipc_entered_with_pending_frame = true;
		expect(preEncodeStages.cancelled?.length ?? 0).toBeGreaterThan(0);
		expect(preEncodeStages.cancelled?.length ?? 0).toBeLessThan(FRAMES);
		await page.getByRole("button", { name: "Close export dialog" }).click();
		const afterCancel = await exportStage({ stage: "after-cancel" });
		compare({ stage: "after-cancel", decoded: afterCancel.frames, reference });
		await previewStage({
			stage: "after-cancel",
			reference: "after-cancel",
			order: [Math.floor(FRAMES / 2)],
		});
		checks.cancel_then_export_identical = true;
		await persist();

		await rm(cache, { recursive: true, force: true });
		await armBodyOperationEvidence({
			page,
			stage: "worker-killed",
			frames: FRAMES,
			samples: SAMPLES,
		});
		const { started } = await startExport({
			app,
			page,
			file: path.join(output, "export-worker-killed.mp4"),
			fps: FPS,
		});
		await expect
			.poll(() => preEncodeStages["worker-killed"]?.length ?? 0, {
				timeout: 600_000,
			})
			.toBeGreaterThanOrEqual(INTERFERE_AFTER_FRAMES);
		const killedRequest = await waitForInFlightBodyFrame({
			app,
			minimumFrame: INTERFERE_AFTER_FRAMES,
			kill: true,
		});
		const killedState = await waitForExportIdle({ page });
		const observation = await readBodyWorkerObservation({ app });
		evidence.workerKilled = {
			...killedState,
			inFlightRequest: killedRequest,
			observation,
		};
		await persist();
		expect(killedState.error).toBeNull();
		expect(
			observation.spawned.some(
				(pid) => pid !== killedRequest.pid && !observation.exited.includes(pid)
			)
		).toBe(true);
		const afterKill = await finishExport({
			page,
			file: path.join(output, "export-worker-killed.mp4"),
			fps: FPS,
			frames: FRAMES,
			started,
		});
		evidence["worker-killed"] = {
			seconds: afterKill.seconds,
			decodedFrameDigests: afterKill.frames,
		};
		compare({ stage: "worker-killed", decoded: afterKill.frames, reference });
		await previewStage({
			stage: "worker-killed",
			reference: "worker-killed",
			order: [FRAMES - 1],
		});
		checks.worker_killed_mid_export_recovered = true;
		const beforeRestart = await checkpointFiles({ sessions });
		await persist();

		closing = true;
		await app.close();
		app = await startElectronApp({ userDataDirectory, colorProfile: "srgb" });
		closing = false;
		watchExit({ application: app });
		page = await getMainWindow(app);
		await installBodyWorkerObserver({ app });
		await attach({ page });
		await openProjectInEditor({ page, projectId });
		const afterRestart = await exportStage({ stage: "after-restart" });
		compare({
			stage: "after-restart",
			decoded: afterRestart.frames,
			reference,
		});
		checks.restart_cached_identical = true;
		await rm(cache, { recursive: true, force: true });
		const afterRestartRecomputed = await exportStage({
			stage: "after-restart-recomputed",
		});
		compare({
			stage: "after-restart-recomputed",
			decoded: afterRestartRecomputed.frames,
			reference,
		});
		checks.restart_cache_cleared_identical = true;
		const afterRestartCheckpoints = await checkpointFiles({ sessions });
		expect(Object.keys(afterRestartCheckpoints).sort()).toEqual(
			Object.keys(beforeRestart).sort()
		);
		checks.restart_session_identity_reused = true;
		evidence.restart = {
			cachedSeconds: afterRestart.seconds,
			recomputedSeconds: afterRestartRecomputed.seconds,
			checkpoints: afterRestartCheckpoints,
		};
		evidence.referenceDigests = reference;
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

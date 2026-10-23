import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
	createBodyVideoCloseScenario,
	createSingleClipBodyProjectPreparer,
} from "./helpers/body-video-close-scenario";
import { bodyVideoMatrixConfig } from "./helpers/body-video-matrix-config";
import {
	readBodyMatrixReports,
	verifyBodyMatrixCase,
} from "./helpers/body-video-matrix-evidence";
import { applyBodyVideoMatrixControls } from "./helpers/body-video-matrix-ui";
import {
	armBodyOperationEvidence,
	type BodyOperationFrame,
	captureBodyOperationPreview,
	installBodyOperationEvidence,
} from "./helpers/body-video-operation-evidence";
import {
	captureCoreMLBodyExecutionEvidence,
	selectCoreMLBodyProfile,
} from "./helpers/body-video-profile-evidence";
import {
	installBodyWorkerObserver,
	readBodyWorkerObservation,
} from "./helpers/body-video-worker-observer";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import {
	exportTimeline,
	finishExport,
} from "./helpers/independent-body-video-helpers";
import {
	applyCompositeAdjustments,
	type CompositeEvidenceWindow,
} from "./helpers/portrait-composite-project";
import { probeVideo } from "./helpers/transition-export-evidence";

const source = process.env.QCUT_BODY_CLOSE_SOURCE;
const output = path.resolve(
	process.env.QCUT_BODY_MATRIX_OUTPUT ??
		"output/playwright/portrait-coreml-body-matrix"
);
const config = bodyVideoMatrixConfig({
	frames: process.env.QCUT_BODY_MATRIX_FRAMES,
	cases: process.env.QCUT_BODY_MATRIX_CASES,
});

test("CoreML video: ten smart controls and manual combinations preserve dynamic preview/export pixels and execution identity", async () => {
	test.skip(
		!source || !existsSync(source),
		"Set QCUT_BODY_CLOSE_SOURCE to the real body video"
	);
	test.setTimeout(3_600_000);
	if (!source) throw new Error("Missing body source");
	await mkdir(output, { recursive: true });
	if (existsSync(path.join(output, "e2e-evidence.json")))
		throw new Error("Use a fresh body matrix output directory");
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-body-matrix-")
	);
	const app = await startElectronApp({
		userDataDirectory,
		colorProfile: "srgb",
	});
	const errors: string[] = [];
	const stages: Record<string, BodyOperationFrame[]> = {};
	const results: Record<string, Record<string, unknown>> = {};
	const evidence: Record<string, unknown> = {
		schemaVersion: 1,
		status: "running",
		config,
		source,
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
		userDataDirectory,
		width: 1080,
		height: 1920,
		bodyVideoProfile: config.profile,
		stages,
		results,
		errors,
		scope:
			"Short moving-video matrix with static per-case parameters changed through real controls; own paused preview/export equality. No native parity, long-video, multi-person or continuous-playback claim.",
		budget:
			"Export frame budget excludes transient UI previews and replay attempts; all observed requests and worker attempts are retained.",
	};
	const persist = () =>
		writeFile(
			path.join(output, "e2e-evidence.json"),
			`${JSON.stringify(evidence, null, 2)}\n`
		);
	try {
		const page = await getMainWindow(app);
		page.on("pageerror", (error) => errors.push(error.message));
		await installBodyWorkerObserver({
			app,
			output: path.join(output, "worker-reports"),
		});
		const { settings } = createBodyVideoCloseScenario({
			seconds: config.seconds,
			fps: config.fps,
			sampleCount: 3,
			passes: ["independent"],
		});
		const prepare = createSingleClipBodyProjectPreparer({
			requireIndependentBodyVideo: true,
			requireNative: false,
		});
		const prepared = await prepare({ page, source, settings });
		const project = {
			...prepared,
			elementIds: [...new Set(prepared.elementIds)],
		};
		evidence.project = project;
		evidence.sourceProbe = await probeVideo({ filePath: source });
		await installBodyOperationEvidence({ page, output, stages });
		const status = await page.evaluate(() =>
			window.electronAPI?.beautyLab?.inspectIndependent?.()
		);
		expect(status?.bodyVideoProfiles?.[config.profile]?.available).toBe(true);
		for (const entry of config.cases) {
			if (entry.manualTool)
				expect(status?.manualBodyTools).toContain(entry.manualTool);
		}
		evidence.runtimeStatus = status;
		await applyCompositeAdjustments({
			page,
			project,
			adjustments: { enabled: true, engine: "independent", values: {} },
		});
		evidence.profileSelection = await selectCoreMLBodyProfile({
			page,
			output: path.join(output, "coreml-ui-selection.png"),
		});
		const exportStage = async ({ stage }: { stage: string }) => {
			await armBodyOperationEvidence({
				page,
				stage,
				frames: config.frames,
				samples: Array.from({ length: config.frames }, (_, frame) => frame),
			});
			const file = path.join(output, `export-${stage}.mp4`);
			const started = Date.now();
			if (stage === "original") {
				// The untouched clip's auto export can stream-copy its source fps.
				await page.getByTestId("export-button").click();
				await expect(page.getByTestId("export-dialog")).toBeVisible();
				await page.waitForFunction(() =>
					Boolean(
						(window as unknown as CompositeEvidenceWindow).__exportActions
					)
				);
				await page.evaluate(
					async ({ file, projectId, fps }) => {
						const stores = window as unknown as CompositeEvidenceWindow;
						if (!stores.__exportActions)
							throw new Error("Missing real export actions");
						await stores.__exportActions.exportLocalVideo({
							engine: "muxer",
							filename: "export-original.mp4",
							format: "mp4",
							frameRate: fps,
							width: 1080,
							height: 1920,
							outputPath: file,
							projectId,
							quality: "1080p",
						});
						const error = stores.__exportStore.getState().error;
						if (error) throw new Error(error);
					},
					{ file, projectId: project.projectId, fps: config.fps }
				);
			}
			const exported =
				stage === "original"
					? await finishExport({
							page,
							file,
							fps: config.fps,
							frames: config.frames,
							started,
						})
					: await exportTimeline({
							app,
							page,
							file,
							fps: config.fps,
							frames: config.frames,
						});
			expect(stages[stage]).toHaveLength(config.frames);
			return {
				exportPath:
					stage === "original"
						? "explicit-canvas-muxer-action"
						: "real-export-dialog",
				seconds: exported.seconds,
				decodedFrameDigests: exported.frames,
			};
		};
		await applyCompositeAdjustments({
			page,
			project,
			adjustments: { enabled: false, values: {} },
		});
		results.original = await exportStage({ stage: "original" });
		await persist();
		await config.cases.reduce(async (previous, entry) => {
			await previous;
			const before = await readBodyWorkerObservation({ app });
			const started = performance.now();
			await applyCompositeAdjustments({
				page,
				project,
				adjustments: {
					enabled: true,
					engine: "independent",
					bodyVideoProfile: config.profile,
					values: {},
				},
			});
			const selected = await applyBodyVideoMatrixControls({ page, entry });
			await page.screenshot({
				path: path.join(output, `${entry.id}-controls.png`),
			});
			results[entry.id] = {
				selectedThroughUI: true,
				selected,
				...(await exportStage({ stage: entry.id })),
			};
			const previews: unknown[] = [];
			await config.previewFrames.reduce(async (prior, frame) => {
				await prior;
				previews.push(
					await captureBodyOperationPreview({
						page,
						output,
						stage: entry.id,
						frame,
						fps: config.fps,
						expected: stages[entry.id][frame].rgbaSha256,
					})
				);
			}, Promise.resolve());
			const after = await readBodyWorkerObservation({ app });
			Object.assign(results[entry.id], {
				previews,
				elapsedMs: performance.now() - started,
				observedRequests: after.sequenceHistory.slice(
					before.sequenceHistory.length
				),
				observedWorkerAttempts: after.workerHistory.slice(
					before.workerHistory.length
				),
			});
			await persist();
		}, Promise.resolve());
		const execution = await captureCoreMLBodyExecutionEvidence({
			app,
			output: path.join(output, "execution"),
			frames: config.frames,
		});
		const observation = await readBodyWorkerObservation({ app });
		const reports = await readBodyMatrixReports({ observation });
		for (const entry of config.cases) {
			results[entry.id].verification = verifyBodyMatrixCase({
				entry,
				original: stages.original,
				exported: stages[entry.id],
				observation,
				reports,
				journals: execution.journals,
				fps: config.fps,
			});
		}
		evidence.execution = execution;
		evidence.observation = observation;
		expect(errors).toEqual([]);
		evidence.status = "passed";
		await persist();
	} catch (error) {
		evidence.status = "failed";
		evidence.error = error instanceof Error ? error.stack : String(error);
		evidence.observation = await readBodyWorkerObservation({ app }).catch(
			() => null
		);
		await persist();
		throw error;
	} finally {
		await app.close();
	}
});

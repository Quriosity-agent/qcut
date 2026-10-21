import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
	captureBodyAudioPlayback,
	evaluateBodyAudioClock,
	expectBodyAudioClock,
	installBodyAudioClockProbe,
} from "./helpers/body-playback-audio-clock";
import { createBodyPlaybackAudioFixture } from "./helpers/body-playback-synthetic-audio";
import {
	installBodyBitmapAccounting,
	readBodyPlaybackResources,
	readBodyPreparationMetrics,
} from "./helpers/body-playback-resource-probe";
import { waitForEffectPlaybackReady } from "./helpers/body-playback-evidence";
import { changeSlimBody } from "./helpers/body-video-editor-operations";
import { BODY_CLOSE_VALUES } from "./helpers/body-video-close-scenario";
import {
	installBodyWorkerObserver,
	readBodyWorkerObservation,
	waitForInFlightBodyFrame,
} from "./helpers/body-video-worker-observer";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import { seek, setBodyValues } from "./helpers/independent-body-video-helpers";
import { preparePortraitReferenceProject } from "./helpers/portrait-reference";

const source = process.env.QCUT_BODY_CLOSE_SOURCE;
const output = path.resolve(
	process.env.QCUT_BODY_PLAYBACK_SCALEUP_OUTPUT ??
		"output/playwright/body-playback-scaleup-20261020"
);
const SECONDS = Number(process.env.QCUT_BODY_PLAYBACK_SCALEUP_SECONDS ?? 2);
const ROUNDS = Number(process.env.QCUT_BODY_PLAYBACK_SCALEUP_ROUNDS ?? 3);
const FPS = 30;
const FRAMES = SECONDS * FPS;
if (
	!Number.isInteger(FRAMES) ||
	FRAMES < 36 ||
	FRAMES > 1800 ||
	!Number.isInteger(ROUNDS) ||
	ROUNDS < 2 ||
	ROUNDS > 30
)
	throw new Error(
		"Scale-up needs 36..1800 frames and 2..30 preparation cycles"
	);

test("body playback scale-up: synthetic audible output timing and repeated cache disposal", async () => {
	test.skip(
		!source || !existsSync(source),
		"Set QCUT_BODY_CLOSE_SOURCE to the local body source"
	);
	test.setTimeout(7_200_000);
	if (!source) throw new Error("Missing scale-up source");
	await mkdir(output, { recursive: true });
	if (existsSync(path.join(output, "e2e-evidence.json")))
		throw new Error("Use a fresh scale-up output directory");
	const fixture = await createBodyPlaybackAudioFixture({
		source,
		output: path.join(output, "synthetic-fixture"),
		seconds: SECONDS,
	});
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-body-playback-scaleup-")
	);
	const app = await startElectronApp({
		userDataDirectory,
		colorProfile: "srgb",
	});
	const errors: string[] = [];
	const consoleErrors: string[] = [];
	const audioFailures: string[] = [];
	const resources: Array<
		Awaited<ReturnType<typeof readBodyPlaybackResources>>
	> = [];
	const rounds: Array<Record<string, unknown>> = [];
	const checks: Record<string, boolean> = {};
	const evidence: Record<string, unknown> = {
		schemaVersion: 1,
		status: "running",
		gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim(),
		engineManifestSha256: createHash("sha256")
			.update(
				await readFile("research/independent-beauty/source-manifest.json")
			)
			.digest("hex"),
		electronBuildSha256: createHash("sha256")
			.update(await readFile("dist/electron/main.js"))
			.digest("hex"),
		frontendIndexSha256: createHash("sha256")
			.update(await readFile("apps/web/dist/index.html"))
			.digest("hex"),
		fixture,
		userDataDirectory,
		frames: FRAMES,
		fps: FPS,
		cycles: ROUNDS,
		resources,
		rounds,
		checks,
		scope:
			"Repeated short clips, not uninterrupted long-video acceptance. Synthetic marker audio is observed on the actual post-mix Web Audio path with browser output timestamps; no physical speaker loopback or audio export claim.",
		thresholds: {
			markerP95Ms: 80,
			markerMaxMs: 150,
			readerFrames: 6,
			readerBytes: 64 * 1024 * 1024,
			opfsDirectoriesAfterClose: 0,
		},
	};
	const persist = () =>
		writeFile(
			path.join(output, "e2e-evidence.json"),
			`${JSON.stringify(evidence, null, 2)}\n`,
			"utf8"
		);
	try {
		const page = await getMainWindow(app);
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		await installBodyAudioClockProbe({ page });
		await installBodyBitmapAccounting({ page });
		await installBodyWorkerObserver({ app });
		const { panel } = await preparePortraitReferenceProject({
			page,
			source: fixture.video,
			duration: SECONDS,
			canvasSize: { width: 1080, height: 1920 },
		});
		await panel
			.getByRole("combobox", { name: "美颜处理引擎", exact: true })
			.click();
		await page.getByRole("option", { name: "自研", exact: true }).click();
		await expect(page.getByTestId("portrait-engine-runtime")).toHaveCount(0, {
			timeout: 120_000,
		});
		await setBodyValues({ page, values: BODY_CLOSE_VALUES });
		const status = page.getByTestId("effect-playback-status");
		const snapshot = async ({ label }: { label: string }) => {
			const result = await readBodyPlaybackResources({
				app,
				page,
				userDataDirectory,
				label,
			});
			resources.push(result);
			return result;
		};
		const closePrepared = async () => {
			await page.getByTestId("cancel-effect-playback").click();
			await expect(status).toHaveAttribute("data-status", "idle");
			await expect(page.getByTestId("effect-playback-canvas")).toHaveCount(0);
			await expect
				.poll(
					async () => {
						const resources = await readBodyPlaybackResources({
							app,
							page,
							userDataDirectory,
							label: "cleanup-poll",
						});
						return {
							directories: resources.opfs.length,
							bitmaps: resources.bitmap?.live,
						};
					},
					{ timeout: 30_000, intervals: [100, 250, 500] }
				)
				.toEqual({ directories: 0, bitmaps: 0 });
		};
		await Array.from({ length: ROUNDS }, (_, index) => index).reduce(
			async (previous, index) => {
				await previous;
				const before = await snapshot({ label: `round-${index}-before` });
				const started = Date.now();
				await page.getByTestId("prepare-effect-playback").click();
				const generation = await waitForEffectPlaybackReady({ page });
				const timings = await readBodyPreparationMetrics({ page });
				const prepared = await snapshot({ label: `round-${index}-prepared` });
				expect(timings.completed).toBe(FRAMES);
				expect(prepared.opfs).toHaveLength(1);
				expect(prepared.opfs[0].files).toBe(FRAMES);
				for (const value of [
					timings.renderMs,
					timings.encodeMs,
					timings.writeMs,
					timings.wallMs,
				]) {
					expect(Number.isFinite(value)).toBe(true);
					expect(value).toBeGreaterThanOrEqual(0);
				}
				const round: Record<string, unknown> = {
					index,
					phase:
						index === 0
							? "first-prepare-new-profile"
							: "repeat-prepare-backend-cache-warm",
					priorBackendCacheFiles: before.backendCache.files,
					priorWorkerResident: before.workerRss.length > 0,
					generation,
					measuredPreparationMs: Date.now() - started,
					stageTimings: timings,
				};
				rounds.push(round);
				const audio = await captureBodyAudioPlayback({
					page,
					frames: FRAMES,
					fps: FPS,
					stage: `round-${index}`,
				});
				round.audioCapture = audio;
				const result = evaluateBodyAudioClock({
					capture: audio,
					expectedMarkers: fixture.markers,
					fps: FPS,
				});
				round.audioClock = result;
				try {
					expectBodyAudioClock({ result });
					round.audioAccepted = true;
				} catch (error) {
					round.audioAccepted = false;
					audioFailures.push(
						`round ${index}: ${error instanceof Error ? error.message : String(error)}`
					);
				}
				await [FRAMES - 2, 1, Math.floor(FRAMES / 2)].reduce(
					async (priorSeek, frame) => {
						await priorSeek;
						await seek({ page, frame, fps: FPS });
						await expect(
							page.getByTestId("effect-playback-canvas")
						).toHaveAttribute("data-frame", String(frame));
					},
					Promise.resolve()
				);
				const afterSeeks = await snapshot({
					label: `round-${index}-after-seeks`,
				});
				expect(afterSeeks.reader?.frames).toBeLessThanOrEqual(6);
				expect(afterSeeks.reader?.bytes).toBeLessThanOrEqual(64 * 1024 * 1024);
				if (index === 0)
					await page.screenshot({
						path: path.join(output, "synthetic-audio-playback-ui.png"),
					});
				await closePrepared();
				const cleaned = await snapshot({ label: `round-${index}-cleaned` });
				expect(cleaned.opfs).toEqual([]);
				expect(cleaned.reader).toBeNull();
				expect(cleaned.bitmap?.live).toBe(0);
				expect(cleaned.bitmap?.bytes).toBe(0);
				await persist();
			},
			Promise.resolve()
		);
		checks.repeated_prepare_seek_cleanup = true;

		await changeSlimBody({ page, value: 55 });
		await page.getByTestId("prepare-effect-playback").click();
		await expect
			.poll(async () => Number(await status.getAttribute("data-completed")), {
				timeout: 600_000,
			})
			.toBeGreaterThanOrEqual(1);
		const beforeCancel = await readBodyWorkerObservation({ app });
		const pending = await waitForInFlightBodyFrame({ app, minimumFrame: 1 });
		await closePrepared();
		const afterCancel = await readBodyWorkerObservation({ app });
		const cancelEntries = afterCancel.cancellations.slice(
			beforeCancel.cancellations.length
		);
		expect(
			cancelEntries.some(
				(entry) =>
					entry.cancelled &&
					entry.sequenceRequest &&
					entry.pending.some(
						(request) => request.frame === entry.sequenceRequest?.frame
					)
			)
		).toBe(true);
		evidence.cancel = { pending, cancelEntries };
		await snapshot({ label: "cancel-cleaned" });
		checks.pending_cancel_discards_partial_opfs = true;
		await changeSlimBody({ page, value: 40 });
		await page.getByTestId("prepare-effect-playback").click();
		await waitForEffectPlaybackReady({ page });
		evidence.afterCancelPreparation = await readBodyPreparationMetrics({
			page,
		});
		await closePrepared();
		await snapshot({ label: "restored-cleaned" });
		checks.prepare_after_cancel = true;
		evidence.audioFailures = audioFailures;
		checks.synthetic_output_av_clock = audioFailures.length === 0;
		evidence.rssObservation = resources
			.filter((entry) => entry.label.endsWith("-cleaned"))
			.map((entry) => ({
				label: entry.label,
				electronWorkingSetKb: entry.processes.reduce(
					(sum, process) => sum + process.workingSetSizeKb,
					0
				),
				workerRssKb: entry.workerRss.reduce(
					(sum, worker) => sum + worker.rssKb,
					0
				),
				bitmap: entry.bitmap,
			}));
		await persist();
		expect(audioFailures).toEqual([]);
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

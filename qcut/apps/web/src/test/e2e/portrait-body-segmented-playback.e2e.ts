import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
	type BodyPlaybackFrame,
	installBodyPlaybackEvidence,
} from "./helpers/body-playback-evidence";
import {
	installBodyBitmapAccounting,
	readBodyPlaybackResources,
} from "./helpers/body-playback-resource-probe";
import {
	captureSegmentedFrame,
	expectSegmentedWindow,
	inspectSegmentedCache,
	playSegmentedBody,
	readSegmentedStatus,
	waitForSegmentedFrame,
} from "./helpers/body-segmented-playback-evidence";
import { verifySegmentedCancellation } from "./helpers/body-segmented-playback-cancellation";
import { verifyMinuteBodyTimeline } from "./helpers/body-segmented-playback-minute";
import { prepareSegmentedBodyProject } from "./helpers/body-segmented-playback-project";
import {
	installSegmentedRequestObserver,
	readSegmentedRequests,
} from "./helpers/body-segmented-playback-requests";
import { changeSlimBody } from "./helpers/body-video-editor-operations";
import {
	armBodyOperationEvidence,
	type BodyOperationFrame,
	installBodyOperationEvidence,
} from "./helpers/body-video-operation-evidence";
import {
	findAvailablePort,
	getMainWindow,
	restoreEnv,
	startElectronApp,
} from "./helpers/electron-helpers";
import {
	finishExport,
	seek,
	startExport,
} from "./helpers/independent-body-video-helpers";
import { probeVideo } from "./helpers/transition-export-evidence";

const source = process.env.QCUT_BODY_CLOSE_SOURCE;
const configuredEngine =
	process.env.QCUT_BODY_SEGMENTED_ENGINE ?? "independent";
if (configuredEngine !== "native" && configuredEngine !== "independent")
	throw new Error("QCUT_BODY_SEGMENTED_ENGINE must be native or independent");
const engine = configuredEngine;
const seconds = Number(process.env.QCUT_BODY_SEGMENTED_SECONDS ?? 24);
const fps = 30;
const frames = seconds * fps;
if (!Number.isInteger(seconds) || seconds < 4 || seconds > 24 || seconds % 2)
	throw new Error(
		"Segmented playback needs an even 4..24 seconds across two clips"
	);
const output = path.resolve(
	process.env.QCUT_BODY_SEGMENTED_OUTPUT ??
		`output/playwright/portrait-body-segmented-${engine}`
);

test("body: rolling 1080p preview matches complete export through segment boundaries, edits and cancellation", async () => {
	test.skip(
		!source || !existsSync(source),
		"Set QCUT_BODY_CLOSE_SOURCE to the private 1080×1920 source"
	);
	test.setTimeout(14_400_000);
	if (!source) throw new Error("Missing segmented body source");
	await mkdir(output, { recursive: true });
	const evidencePath = path.join(output, "e2e-evidence.json");
	if (existsSync(evidencePath))
		throw new Error("Use a fresh segmented evidence directory");
	const sourceProbe = await probeVideo({ filePath: source });
	expect(sourceProbe).toMatchObject({ width: 1080, height: 1920 });
	expect(sourceProbe.videoDurationSeconds).toBeGreaterThanOrEqual(
		seconds / 2 + 1
	);
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-body-segmented-")
	);
	const stateHome = await mkdtemp(
		path.join(os.tmpdir(), "qcut-body-segmented-state-")
	);
	const previousEnvironment = ["QCUT_API_PORT", "XDG_STATE_HOME"].map(
		(name) => ({
			name,
			value: process.env[name],
		})
	);
	const exportStages: Record<string, BodyOperationFrame[]> = {};
	const playbackStages: Record<string, BodyPlaybackFrame[]> = {};
	const checks: Record<string, boolean> = {};
	const errors: string[] = [];
	const consoleErrors: string[] = [];
	const hashFile = async ({ file }: { file: string }) =>
		createHash("sha256")
			.update(await readFile(file))
			.digest("hex");
	const evidence: Record<string, unknown> = {
		schemaVersion: 1,
		status: "running",
		engine,
		seconds,
		frames,
		fps,
		width: 1080,
		height: 1920,
		source: path.resolve(source),
		sourceProbe,
		sourceSha256: await hashFile({ file: source }),
		gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim(),
		engineManifestSha256: await hashFile({
			file: "research/independent-beauty/source-manifest.json",
		}),
		electronBuildSha256: await hashFile({ file: "dist/electron/main.js" }),
		frontendIndexSha256: await hashFile({ file: "apps/web/dist/index.html" }),
		userDataDirectory,
		stateHome,
		checks,
		exportStages,
		playbackStages,
		scope: {
			edit: "Two clips from one real private source, each half the timeline; B starts at source 1s. No looped or synthesized video.",
			longTimeline: seconds > 20,
			continuousSingleShot: false,
			nativeProfile:
				"Product default; no tracking, source-history or model overrides",
			pixelComparison:
				"Every cached PNG cumulatively and every observed presented RGBA vs same-engine pre-encode export SHA256",
			notClaimed: [
				"unbuffered realtime streaming",
				"single-shot 24s tracking",
				"AV synchronization",
				"native/independent algorithm identity",
			],
		},
	};
	const persist = () =>
		writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
	process.env.QCUT_API_PORT = String(await findAvailablePort());
	process.env.XDG_STATE_HOME = stateHome;
	const app = await startElectronApp({
		userDataDirectory,
		colorProfile: "srgb",
	}).catch((error: unknown) => {
		for (const entry of previousEnvironment) restoreEnv(entry);
		throw error;
	});
	let closing = false;
	app.process().once("exit", (code, signal) => {
		evidence.appExit = { code, signal, intentional: closing, at: Date.now() };
		if (!closing)
			errors.push(`Electron exited unexpectedly (${code}, ${signal})`);
	});
	try {
		const page = await getMainWindow(app);
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("crash", () => errors.push("Electron renderer crashed"));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		await installBodyBitmapAccounting({ page });
		await installSegmentedRequestObserver({ app });
		evidence.project = await prepareSegmentedBodyProject({
			page,
			source,
			seconds,
			engine,
		});
		await installBodyOperationEvidence({ page, output, stages: exportStages });
		await installBodyPlaybackEvidence({ page, output, stages: playbackStages });
		const resources = async ({ label }: { label: string }) =>
			readBodyPlaybackResources({ app, page, userDataDirectory, label });
		const half = frames / 2;
		const samples = [
			...new Set([
				0,
				59,
				60,
				61,
				half - 1,
				half,
				half + 1,
				frames - 61,
				frames - 60,
				frames - 1,
			]),
		].filter((frame) => frame >= 0 && frame < frames);
		const runExport = async ({ stage }: { stage: string }) => {
			await armBodyOperationEvidence({ page, stage, frames, samples });
			const offset = (await readSegmentedRequests({ app })).length;
			const file = path.join(output, `export-${stage}.mp4`);
			const { started } = await startExport({ app, page, file, fps });
			const exported = await finishExport({
				page,
				file,
				fps,
				frames,
				started,
				timeout: 7_200_000,
			});
			expect(exportStages[stage]).toHaveLength(frames);
			return {
				...exported,
				requests: await readSegmentedRequests({ app, after: offset }),
			};
		};
		evidence.baselineExport = await runExport({ stage: "baseline" });
		checks.complete_baseline_export = true;
		await persist();

		await seek({ page, frame: 0, fps });
		const prepareStarted = Date.now();
		await page.getByTestId("prepare-effect-playback").click();
		const first = await waitForSegmentedFrame({ page, frame: 0 });
		if (!first.generation) throw new Error("Prepared stream has no generation");
		const generation = first.generation;
		expectSegmentedWindow({ status: first, total: frames });
		if (frames > 3 * first.segmentFrames)
			expect(first.completed).toBeLessThan(frames);
		evidence.initialPreparation = {
			milliseconds: Date.now() - prepareStarted,
			...first,
		};
		evidence.resourcesBeforePlay = await resources({
			label: "before-continuous",
		});
		await persist();
		const segmentAudits: Array<{
			status: Awaited<ReturnType<typeof readSegmentedStatus>>;
			cache: Awaited<ReturnType<typeof inspectSegmentedCache>>;
			resources: Awaited<ReturnType<typeof resources>>;
		}> = [];
		evidence.segmentAudits = segmentAudits;
		const uniqueCached = new Map<number, number>();
		const starts = Array.from(
			{ length: Math.ceil(frames / first.segmentFrames) },
			(_, index) => index * first.segmentFrames
		);
		evidence.continuousPlayback = await playSegmentedBody({
			page,
			frames,
			fps,
			generation,
			reference: exportStages.baseline,
			onWindow: async ({ status, frame }) => {
				expectSegmentedWindow({ status, total: frames });
				const currentStart =
					Math.floor(frame / status.segmentFrames) * status.segmentFrames;
				const uninspected = starts.filter(
					(start) =>
						start >= currentStart &&
						start < status.windowEnd &&
						!uniqueCached.has(start)
				);
				await uninspected.reduce(async (previous, start) => {
					await previous;
					const cache = await inspectSegmentedCache({
						page,
						status,
						start,
						end: Math.min(frames, start + status.segmentFrames),
						reference: exportStages.baseline,
					});
					for (const entry of cache.hashes)
						uniqueCached.set(entry.frame, entry.pngBytes);
					segmentAudits.push({
						status,
						cache,
						resources: await resources({ label: `segment-${start}` }),
					});
					await persist();
				}, Promise.resolve());
			},
		});
		checks.segmented_real_playback_crosses_boundaries_and_matches_export = true;
		expect(uniqueCached.size).toBe(frames);
		const cumulativePngBytes = [...uniqueCached.values()].reduce(
			(sum, bytes) => sum + bytes,
			0
		);
		evidence.cumulativeCache = {
			uniqueFrames: uniqueCached.size,
			cumulativePngBytes,
		};
		if (seconds === 24)
			expect(cumulativePngBytes).toBeGreaterThan(2 * 1024 ** 3);
		if (frames > 3 * first.segmentFrames)
			expect(segmentAudits.some(({ status }) => status.evictedTotal > 0)).toBe(
				true
			);
		checks.all_timeline_frames_match_export_with_bounded_resident_cache = true;
		checks.every_segment_boundary_matches_export = true;

		const far = Math.max(half, frames - 60);
		const back = Math.min(60, half - 1);
		const seekAudits: Array<Record<string, unknown>> = [];
		evidence.seeks = seekAudits;
		await [far, back, far].reduce(async (previous, frame) => {
			await previous;
			const started = Date.now();
			await seek({ page, frame, fps });
			const status = await waitForSegmentedFrame({
				page,
				frame,
				generation,
				settled: true,
			});
			const capture = await captureSegmentedFrame({
				page,
				output,
				stage: "seeks",
				frame,
				generation,
				reference: exportStages.baseline,
			});
			seekAudits.push({ milliseconds: Date.now() - started, status, capture });
		}, Promise.resolve());
		checks.far_and_backward_seek_match_export = true;
		await page.screenshot({ path: path.join(output, "before-edit-ui.png") });

		const beforeChange = (await readSegmentedRequests({ app })).length;
		await changeSlimBody({ page, value: 55 });
		await expect(
			page.locator(
				`[data-testid="effect-playback-canvas"][data-generation="${generation}"]`
			)
		).toHaveCount(0, { timeout: 1_000 });
		checks.old_generation_hidden_after_parameter_edit = true;
		await expect
			.poll(async () => (await readSegmentedStatus({ page })).generation, {
				timeout: 30_000,
			})
			.not.toBe(generation);
		const changedStatus = await waitForSegmentedFrame({
			page,
			frame: far,
			settled: true,
		});
		const changedGeneration = changedStatus.generation;
		if (!changedGeneration) throw new Error("Edited stream has no generation");
		expect(changedGeneration).not.toBe(generation);
		expect(changedStatus.sessionId).not.toBe(first.sessionId);
		evidence.unchangedClip = {
			status: changedStatus,
			capture: await captureSegmentedFrame({
				page,
				output,
				stage: "unchanged-b",
				frame: far,
				generation: changedGeneration,
				reference: exportStages.baseline,
			}),
			requests: await readSegmentedRequests({ app, after: beforeChange }),
			resources: await resources({ label: "after-a-edit-on-b" }),
		};
		const unchangedRequests = await readSegmentedRequests({
			app,
			after: beforeChange,
		});
		const bReceipts = unchangedRequests.filter(
			(request) =>
				request.status === "completed" &&
				request.values?.body_adjust_StretchLeg === 20 &&
				request.channel.includes("render")
		);
		expect(bReceipts.length).toBeGreaterThan(0);
		for (const request of bReceipts) {
			if (engine === "native") {
				expect(request.result?.sourceWindowCacheHit).toBe(true);
				expect(request.result?.nativeRenderCount).toBe(0);
			} else expect(request.result?.cached).toBe(true);
		}
		checks.parameter_edit_automatically_rebuilds_current_generation = true;
		checks.unchanged_b_reuses_backend_pixels = true;
		await persist();
		evidence.changedExport = await runExport({ stage: "changed" });
		expect(
			exportStages.changed.slice(half).map((entry) => entry.rgbaSha256)
		).toEqual(
			exportStages.baseline.slice(half).map((entry) => entry.rgbaSha256)
		);
		expect(
			exportStages.changed
				.slice(0, half)
				.some(
					(entry, index) =>
						entry.rgbaSha256 !== exportStages.baseline[index].rgbaSha256
				)
		).toBe(true);
		checks.a_changes_and_all_b_export_frames_remain_identical = true;
		const editedAudits: Awaited<ReturnType<typeof inspectSegmentedCache>>[] =
			[];
		evidence.editedSegments = editedAudits;
		await starts
			.filter((start) => start < half)
			.reduce(async (previous, start) => {
				await previous;
				await seek({ page, frame: start, fps });
				const status = await waitForSegmentedFrame({
					page,
					frame: start,
					generation: changedGeneration,
					settled: true,
				});
				editedAudits.push(
					await inspectSegmentedCache({
						page,
						status,
						start,
						end: Math.min(half, start + status.segmentFrames),
						reference: exportStages.changed,
					})
				);
				await persist();
			}, Promise.resolve());
		checks.changed_a_cached_frames_match_changed_export = true;

		await verifySegmentedCancellation({
			app,
			page,
			output,
			userDataDirectory,
			fps,
			generation: changedGeneration,
			reference: exportStages.changed,
			evidence,
		});
		checks.cancelled_pending_render_cannot_republish_or_retain_cache = true;
		checks.cancel_recovery_matches_changed_export = true;
		if (seconds === 24) {
			evidence.minuteTimeline = await verifyMinuteBodyTimeline({
				app,
				page,
				output,
				userDataDirectory,
				baseline: exportStages.baseline,
				evidence,
			});
			checks.minute_timeline_sampled_pixels_and_cache_bound = true;
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
		evidence.requests = await readSegmentedRequests({ app }).catch(() => []);
		await persist();
		closing = true;
		await app.close();
		for (const entry of previousEnvironment) restoreEnv(entry);
	}
});

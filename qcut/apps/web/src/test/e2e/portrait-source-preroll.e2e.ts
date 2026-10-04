import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { getFFmpegPath } from "../../../../../electron/ffmpeg/paths";
import { getMainWindow, startElectronApp } from "./helpers/electron-helpers";
import { findAvailablePort } from "./helpers/isolated-electron-fixture";
import {
	preparePortraitReferenceProject,
	type ReferenceWindow,
} from "./helpers/portrait-reference";
import {
	installProbe,
	pixelEvidence,
	prepareBrowserFixture,
	previewState,
	readProbe,
	releaseDelivery,
	runtimeIdentity,
	seekSource,
	sequentialReference,
	setPhase,
	sha256,
	TARGET_SECONDS,
	VIDEO_SIZE,
	type Observation,
} from "./helpers/portrait-source-preroll-evidence";
import { startRendererMuxerExport } from "./helpers/sequential-decode-evidence";
import {
	probeVideo,
	waitForExportJob,
} from "./helpers/transition-export-evidence";

const execFileAsync = promisify(execFile);
const source = process.env.QCUT_PORTRAIT_PREROLL_SOURCE;
const output = path.resolve(
	process.env.QCUT_PORTRAIT_PREROLL_OUTPUT ??
		"output/playwright/portrait-source-preroll"
);

function verifyRecovery({
	observations,
	phase,
}: {
	observations: Observation[];
	phase: string;
}) {
	const cold = observations.find(
		(entry) => entry.phase === phase && entry.history.length === 0
	);
	const recovery = observations.find(
		(entry) => entry.phase === phase && entry.history.length > 0
	);
	expect(cold, `${phase}: real cold target request`).toBeDefined();
	expect(recovery, `${phase}: production reader history`).toBeDefined();
	if (!cold || !recovery) throw new Error(`Missing ${phase} evidence`);
	expect(cold.needsSourcePreRoll).toBe(true);
	expect(cold.inputSha256).toBe(cold.outputSha256);
	expect(recovery.inputSha256).toBe(cold.inputSha256);
	expect(recovery.timestampSeconds).toBe(cold.timestampSeconds);
	expect(recovery.sourceKey).toBe(cold.sourceKey);
	expect(recovery.outputSha256).not.toBe(cold.inputSha256);
	expect(recovery.needsSourcePreRoll).toBe(false);
	expect(recovery.history.length).toBeLessThanOrEqual(16);
	let previous = -1;
	for (const frame of recovery.history) {
		expect(frame.timestampSeconds).toBeGreaterThan(previous);
		expect(frame.timestampSeconds).toBeLessThan(recovery.timestampSeconds ?? 0);
		expect(frame.timestampSeconds).toBeGreaterThanOrEqual(
			(recovery.timestampSeconds ?? 0) - 0.5
		);
		previous = frame.timestampSeconds;
	}
	return { cold, recovery };
}

test("CPU evidence keeps RGBA mismatches even when grayscale rounds to zero", async () => {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-preroll-metrics-")
	);
	try {
		const input = Buffer.from([0, 0, 0, 255, 30, 30, 30, 255]);
		const actual = Buffer.from([1, 0, 0, 255, 30, 30, 30, 255]);
		const metrics = await pixelEvidence({
			output: directory,
			name: "cpu",
			width: 2,
			height: 1,
			input,
			actual,
			reference: input,
		});
		expect(metrics.changedPixels).toBe(1);
		expect(metrics.differingPixels).toBe(1);
		expect(metrics.grayMax).toBe(0);
		expect(metrics.actualSha256).not.toBe(metrics.referenceSha256);
		expect(
			(await readFile(path.join(directory, "cpu-actual.png")))
				.subarray(1, 4)
				.toString()
		).toBe("PNG");
		await expect(
			pixelEvidence({
				output: directory,
				name: "invalid",
				width: 2,
				height: 1,
				input: Buffer.alloc(4),
				actual,
				reference: input,
			})
		).rejects.toThrow("dimensions mismatch");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("CPU recovery gate rejects a changed target, no-op, and noncausal history", () => {
	const cold: Observation = {
		phase: "cpu",
		sourceKey: "source-A",
		timestampSeconds: 2,
		width: 854,
		height: 480,
		inputSha256: "target",
		outputSha256: "target",
		needsSourcePreRoll: true,
		history: [],
		completed: true,
	};
	const recovery: Observation = {
		...cold,
		outputSha256: "effect",
		needsSourcePreRoll: false,
		history: [{ timestampSeconds: 1.8, sha256: "prior-source-frame" }],
	};
	expect(() =>
		verifyRecovery({ observations: [cold, recovery], phase: "cpu" })
	).not.toThrow();
	for (const invalid of [
		{ ...recovery, inputSha256: "stale-target" },
		{ ...recovery, outputSha256: "target" },
		{ ...recovery, sourceKey: "source-B" },
		{ ...recovery, history: [{ timestampSeconds: 2, sha256: "target" }] },
	])
		expect(() =>
			verifyRecovery({ observations: [cold, invalid], phase: "cpu" })
		).toThrow();
});

test("timeline video cold-acquisition uses real source decoding, cancels stale delivery, and exports the target", async () => {
	test.skip(
		!source || process.env.QCUT_PORTRAIT_NATIVE_LEASE !== "granted",
		"Requires pinned local source and explicitly coordinated native lease"
	);
	test.setTimeout(300_000);
	if (!source) throw new Error("Missing local source");
	await mkdir(output, { recursive: true });
	const identityBefore = await runtimeIdentity();
	const report: Record<string, unknown> = {
		passed: false,
		scope:
			"Actual Electron timeline preview and production renderer-muxer export; reference replays observed decoder frames through real IPC. Cancellation delays one real IPC response only.",
		identityBefore,
	};
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-source-preroll-")
	);
	const apiPort = await findAvailablePort();
	const previousPort = process.env.QCUT_API_PORT;
	const previousStateHome = process.env.XDG_STATE_HOME;
	process.env.QCUT_API_PORT = String(apiPort);
	process.env.XDG_STATE_HOME = userDataDirectory;
	let app: ElectronApplication | undefined;
	let failure: unknown;
	try {
		const fixture = await prepareBrowserFixture({ source, output });
		report.fixture = fixture;
		app = await startElectronApp({ userDataDirectory });
		const application = app;
		const page = await getMainWindow(application);
		const pageErrors: string[] = [];
		page.on("pageerror", (error) => {
			if (pageErrors.length < 30) pageErrors.push(error.message);
		});
		report.pageErrors = pageErrors;
		await installProbe({ app: application });
		await preparePortraitReferenceProject({
			page,
			source: fixture.browserSource,
			duration: 70 / 30,
			canvasSize: VIDEO_SIZE,
		});
		report.runtime = await page.evaluate(() =>
			window.electronAPI?.jianyingPortraitAdjustment?.inspect()
		);
		await seekSource({ page, seconds: TARGET_SECONDS });
		const targetBefore = await previewState({ page });
		await writeFile(
			path.join(output, "requested-source.png"),
			Buffer.from(targetBefore.sourcePng, "base64")
		);
		report.targetBefore = {
			...targetBefore,
			paintedPng: undefined,
			sourcePng: undefined,
		};
		expect(targetBefore.width).toBe(VIDEO_SIZE.width);
		expect(targetBefore.height).toBe(VIDEO_SIZE.height);
		expect(targetBefore.paused).toBe(true);
		const eyes = page.getByLabel("大眼数值", { exact: true });

		await setPhase({ app: application, phase: "cancel", holdNext: true });
		await eyes.fill("60");
		await eyes.press("Tab");
		await expect
			.poll(async () => (await readProbe({ app: application })).held, {
				timeout: 45_000,
			})
			.toBe(true);
		const cancelledCold = (
			await readProbe({ app: application })
		).observations.find((entry) => entry.phase === "cancel");
		expect(cancelledCold?.needsSourcePreRoll).toBe(true);
		expect(cancelledCold?.inputSha256).toBe(cancelledCold?.outputSha256);
		expect(cancelledCold?.inputSha256).toBe(targetBefore.sourceSha256);
		await eyes.fill("0");
		await eyes.press("Tab");
		await seekSource({ page, seconds: 69 / 30 });
		await releaseDelivery({ app: application });
		await expect
			.poll(
				async () => {
					const current = await previewState({ page });
					return current.paintedPng === current.sourcePng;
				},
				{ timeout: 15_000 }
			)
			.toBe(true);
		const cancelled = await previewState({ page });
		expect(cancelled.timestampSeconds).toBeCloseTo(69 / 30, 3);
		expect(cancelled.timelineSeconds).toBeCloseTo(69 / 30, 3);
		expect(cancelled.sourceSha256).not.toBe(targetBefore.sourceSha256);
		expect(
			(await readProbe({ app: application })).observations.filter(
				(entry) => entry.phase === "cancel" && entry.history.length > 0
			)
		).toHaveLength(0);
		await page.screenshot({
			path: path.join(output, "cancelled-target-ui.png"),
		});
		report.cancellation = {
			passed: true,
			sourceSeconds: cancelled.timestampSeconds,
			noHistoryRetry: true,
			stalePaint: false,
			deliveryBarrier: true,
		};

		await seekSource({ page, seconds: TARGET_SECONDS });
		await setPhase({ app: application, phase: "preview" });
		await eyes.fill("60");
		await eyes.press("Tab");
		await expect
			.poll(
				async () =>
					(await readProbe({ app: application })).observations.some(
						(entry) =>
							entry.phase === "preview" &&
							entry.history.length > 0 &&
							entry.completed
					),
				{ timeout: 60_000 }
			)
			.toBe(true);
		const previewRecovery = verifyRecovery({
			observations: (await readProbe({ app: application })).observations,
			phase: "preview",
		});
		expect(previewRecovery.cold.inputSha256).toBe(targetBefore.sourceSha256);
		const reference = await sequentialReference({
			app: application,
			phase: "preview",
		});
		await expect
			.poll(
				async () => {
					const state = await previewState({ page });
					return state.paintedSha256;
				},
				{ timeout: 15_000 }
			)
			.toBe(previewRecovery.recovery.outputSha256);
		const preview = await previewState({ page });
		expect(preview.timestampSeconds).toBeCloseTo(TARGET_SECONDS, 3);
		expect(preview.timelineSeconds).toBeCloseTo(TARGET_SECONDS, 3);
		expect(preview.sourceUrl).toBe(targetBefore.sourceUrl);
		expect(preview.paused).toBe(true);
		const previewMetrics = await pixelEvidence({
			output,
			name: "preview",
			width: reference.width,
			height: reference.height,
			input: Buffer.from(reference.input, "base64"),
			actual: Buffer.from(reference.recovered, "base64"),
			reference: Buffer.from(reference.reference, "base64"),
		});
		report.preview = {
			...previewMetrics,
			...previewRecovery,
			sourceSeconds: preview.timestampSeconds,
		};
		expect(previewMetrics.changedPixels).toBeGreaterThan(0);
		expect(previewMetrics.differingPixels).toBe(0);
		expect(previewMetrics.grayMax).toBe(0);
		expect(reference.referenceNeedsSourcePreRoll).toBe(false);
		await writeFile(
			path.join(output, "preview-painted.png"),
			Buffer.from(preview.paintedPng, "base64")
		);
		await page.screenshot({
			path: path.join(output, "recovered-target-ui.png"),
		});

		const projectId = await page.evaluate((target) => {
			const stores = window as unknown as ReferenceWindow;
			const timeline = stores.__timelineStore.getState();
			const selected = timeline.selectedElements[0];
			if (!selected) throw new Error("Selected timeline target missing");
			timeline.updateElementTrim(
				selected.trackId,
				selected.elementId,
				target,
				70 / 30 - target - 1 / 30
			);
			return stores.__projectStore.getState().activeProject?.id;
		}, TARGET_SECONDS);
		if (!projectId) throw new Error("Active project missing");
		await seekSource({ page, seconds: 0, sourceSeconds: TARGET_SECONDS });
		await setPhase({ app: application, phase: "post-preview" });
		const outputPath = path.join(output, "recovered-target.mp4");
		const { jobId } = await startRendererMuxerExport({
			apiPort,
			projectId,
			outputPath,
			profilePath: path.join(output, "export-profile.json"),
			...VIDEO_SIZE,
			fps: 30,
			token: process.env.QCUT_API_TOKEN,
		});
		const job = await waitForExportJob({
			apiPort,
			projectId,
			jobId,
			token: process.env.QCUT_API_TOKEN,
			timeoutMs: 120_000,
		});
		report.exportJob = job;
		expect(job.status).toBe("completed");
		const exportRecovery = verifyRecovery({
			observations: (await readProbe({ app: application })).observations,
			phase: "export",
		});
		const exportReference = await sequentialReference({
			app: application,
			phase: "export",
		});
		const exportMetrics = await pixelEvidence({
			output,
			name: "export-native",
			width: exportReference.width,
			height: exportReference.height,
			input: Buffer.from(exportReference.input, "base64"),
			actual: Buffer.from(exportReference.recovered, "base64"),
			reference: Buffer.from(exportReference.reference, "base64"),
		});
		report.export = { ...exportMetrics, ...exportRecovery };
		expect(exportMetrics.changedPixels).toBeGreaterThan(0);
		expect(exportMetrics.differingPixels).toBe(0);
		expect(exportMetrics.grayMax).toBe(0);
		expect(exportRecovery.recovery.timestampSeconds).toBeCloseTo(65 / 30, 5);
		const metadata = await probeVideo({ filePath: outputPath });
		report.exportMetadata = metadata;
		expect(metadata.frameCount).toBe(1);
		expect([metadata.width, metadata.height]).toEqual([
			VIDEO_SIZE.width,
			VIDEO_SIZE.height,
		]);
		const decodedPath = path.join(output, "export-decoded.rgba");
		await execFileAsync(
			getFFmpegPath(),
			[
				"-v",
				"error",
				"-n",
				"-i",
				outputPath,
				"-frames:v",
				"1",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				decodedPath,
			],
			{ timeout: 30_000 }
		);
		const encodedMetrics = await pixelEvidence({
			output,
			name: "export-encoded",
			...VIDEO_SIZE,
			input: Buffer.from(exportReference.input, "base64"),
			actual: await readFile(decodedPath),
			reference: Buffer.from(exportReference.reference, "base64"),
		});
		report.encoded = {
			...encodedMetrics,
			toleranceGrayMean: 3,
			note: "Lossy encoded delivery QA, not the exact native recovery assertion",
		};
		expect(encodedMetrics.grayMeanAbsoluteDifference).toBeLessThan(3);
		await rm(decodedPath);
		expect(sha256({ bytes: await readFile(source) })).toBe(
			fixture.sourceSha256
		);
		expect(sha256({ bytes: await readFile(fixture.browserSource) })).toBe(
			fixture.browserSha256
		);
	} catch (error) {
		failure = error;
		report.failure = error instanceof Error ? error.stack : String(error);
		await app
			?.windows()[0]
			?.screenshot({ path: path.join(output, "failure-ui.png"), timeout: 5000 })
			.catch(() => {});
	} finally {
		if (app) {
			await releaseDelivery({ app }).catch(() => {});
			report.probe = await readProbe({ app }).catch((error: Error) => ({
				error: error.message,
			}));
			await app.close().catch((error: Error) => {
				failure ??= error;
				report.cleanupError = error.message;
			});
		}
		await rm(userDataDirectory, { recursive: true, force: true });
		if (previousPort === undefined)
			Reflect.deleteProperty(process.env, "QCUT_API_PORT");
		else process.env.QCUT_API_PORT = previousPort;
		if (previousStateHome === undefined)
			Reflect.deleteProperty(process.env, "XDG_STATE_HOME");
		else process.env.XDG_STATE_HOME = previousStateHome;
		try {
			const identityAfter = await runtimeIdentity();
			report.identityAfter = identityAfter;
			report.identityUnchanged =
				JSON.stringify(identityAfter) === JSON.stringify(identityBefore);
			if (!report.identityUnchanged)
				failure ??= new Error("Source/build provenance changed during E2E");
		} catch (error) {
			failure ??= error;
			report.identityUnchanged = false;
		}
		report.passed = !failure && report.identityUnchanged === true;
		await writeFile(
			path.join(output, "report.json"),
			`${JSON.stringify(report, null, 2)}\n`
		);
	}
	if (failure) throw failure;
	console.log(
		`Source-preroll Electron preview/export passed: ${path.join(output, "report.json")}`
	);
});

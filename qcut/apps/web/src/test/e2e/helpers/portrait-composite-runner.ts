import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getMainWindow, startElectronApp } from "./electron-helpers";
import {
	armCompositeCapture,
	captureCompositePreview,
	installCompositeExportCapture,
	type CapturedExportFrame,
} from "./portrait-composite-capture";
import {
	COMPOSITE_SETTINGS,
	prepareCompositeProject,
	applyCompositeAdjustments,
	setOneToOnePreview,
	type CompositeEvidenceWindow,
	type CompositeProject,
	type CompositeEvidencePass,
	type CompositeSettings,
} from "./portrait-composite-project";
import type { MediaPortraitAdjustments } from "../../../types/timeline";
import { probeVideo } from "./transition-export-evidence";

export interface CompositeScenarioPass {
	id: CompositeEvidencePass;
	adjustments: MediaPortraitAdjustments;
}

async function exportCompositePass({
	page,
	project,
	pass,
	output,
	settings,
}: {
	page: Page;
	project: CompositeProject;
	pass: CompositeEvidencePass;
	output: string;
	settings: CompositeSettings;
}) {
	await page.getByTestId("export-button").click();
	await expect(page.getByTestId("export-dialog")).toBeVisible();
	await page.waitForFunction(() =>
		Boolean((window as unknown as CompositeEvidenceWindow).__exportActions)
	);
	const exportPath = path.join(output, pass, "export.mp4");
	if (existsSync(exportPath))
		throw new Error(`Evidence output already exists: ${exportPath}`);
	await armCompositeCapture({ page, pass, settings });
	const started = Date.now();
	let progressPending = false;
	const progressTimer = setInterval(() => {
		if (progressPending) return;
		progressPending = true;
		void page
			.evaluate(() => {
				const state = (
					window as unknown as CompositeEvidenceWindow
				).__exportStore.getState();
				return { progress: state.progress, error: state.error };
			})
			.then((state) =>
				writeFile(
					path.join(output, "export-progress.json"),
					JSON.stringify({
						pass,
						timestamp: new Date().toISOString(),
						seconds: (Date.now() - started) / 1000,
						...state,
					})
				)
			)
			.catch(() => {})
			.finally(() => {
				progressPending = false;
			});
	}, 1000);
	try {
		await page.evaluate(
			async ({ projectId, exportPath, profilePath, width, height, fps }) => {
				const stores = window as unknown as CompositeEvidenceWindow;
				stores.__exportProfiler.arm({ targetPath: profilePath });
				const actions = stores.__exportActions;
				if (!actions) throw new Error("Missing real export actions");
				await actions.exportLocalVideo({
					engine: "muxer",
					filename: "export.mp4",
					format: "mp4",
					frameRate: fps,
					width,
					height,
					outputPath: exportPath,
					projectId,
					quality: "1080p",
				});
				const error = stores.__exportStore.getState().error;
				if (error) throw new Error(error);
				Reflect.deleteProperty(stores, "__qcutExportFrameEvidence");
			},
			{
				projectId: project.projectId,
				exportPath,
				profilePath: path.join(output, pass, "profile.json"),
				width: settings.width,
				height: settings.height,
				fps: settings.fps,
			}
		);
	} finally {
		clearInterval(progressTimer);
	}
	expect((await stat(exportPath)).size).toBeGreaterThan(1000);
	const probe = await probeVideo({ filePath: exportPath });
	expect(probe).toMatchObject({
		width: settings.width,
		height: settings.height,
		fps: settings.fps,
		frameCount: settings.totalFrames,
	});
	await page.getByRole("button", { name: "Close export dialog" }).click();
	return {
		file: path.join(pass, "export.mp4"),
		seconds: (Date.now() - started) / 1000,
		probe,
	};
}

export async function runCompositeConsistency({
	source,
	output,
	passes,
	settings = COMPOSITE_SETTINGS,
	previewIndices = settings.samples,
	kind = "portrait-composite-preview-export",
	requireAudio = false,
	requirePortraitSource = false,
	traceHelperPath,
}: {
	source: string | undefined;
	output: string;
	passes: CompositeScenarioPass[];
	settings?: CompositeSettings;
	previewIndices?: number[];
	kind?: string;
	requireAudio?: boolean;
	requirePortraitSource?: boolean;
	traceHelperPath?: string;
}) {
	test.skip(
		!source || !existsSync(source),
		"Set the composite source to real moving media; installed beauty runtimes required"
	);
	test.setTimeout(10_800_000);
	if (!source) throw new Error("Missing composite source");
	await mkdir(output, { recursive: true });
	const sourceSha256 = await new Promise<string>((resolve, reject) => {
		const hash = createHash("sha256");
		createReadStream(source)
			.on("data", (chunk) => hash.update(chunk))
			.on("error", reject)
			.on("end", () => resolve(hash.digest("hex")));
	});
	const sourceBytes = (await stat(source)).size;
	const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
	const sourceProbe = await probeVideo({ filePath: source });
	expect(sourceProbe.videoDurationSeconds).toBeGreaterThanOrEqual(
		settings.seconds - 1 / settings.fps
	);
	if (requireAudio) expect(sourceProbe.hasAudio).toBe(true);
	if (requirePortraitSource)
		expect(sourceProbe).toMatchObject({
			width: settings.width,
			height: settings.height,
		});
	expect([...previewIndices].sort((left, right) => left - right)).toEqual(
		settings.samples
	);
	const userDataDirectory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-portrait-composite-")
	);
	const app = await startElectronApp({
		userDataDirectory,
		colorProfile: "srgb",
	});
	const appPid = app.process().pid;
	await writeFile(
		path.join(output, "app-process.json"),
		`${JSON.stringify({ appPid, userDataDirectory, startedAt: new Date().toISOString() }, null, 2)}\n`
	);
	const frames: CapturedExportFrame[] = [];
	const completed: Array<Record<string, unknown>> = [];
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const beautyWarnings: string[] = [];
	const stageEvents: Array<{
		pass: CompositeEvidencePass;
		stage: "exportStart" | "exportEnd" | "previewEnd";
		timestamp: string;
	}> = [];
	const evidence: Record<string, unknown> = {
		schemaVersion: 1,
		kind,
		status: "running",
		source: path.resolve(source),
		sourceIdentity: { sha256: sourceSha256, bytes: sourceBytes },
		gitHead,
		sourceProbe,
		appPid,
		userDataDirectory,
		width: settings.width,
		height: settings.height,
		fps: settings.fps,
		duration: settings.seconds,
		totalFrames: settings.totalFrames,
		fit: settings.fit,
		chromiumColorProfile: "srgb",
		nativeTemporalMode:
			"runtime temporal policy; exact paused canvas composition required",
		sampleIndices: settings.samples,
		requestedPasses: passes.map(({ id }) => id),
		previewSeekOrder: previewIndices,
		capture:
			"Chromium composition screenshot at verified 1:1 CSS pixels plus actual committed Canvas composition PNG; actual export canvas before YUV conversion",
		keyframes:
			"Supported scaleX, scaleY and cropLeft channels; portrait adjustment values are static",
		selection:
			"Alternating unselected and selected active clips in paused preview",
		comparisonStatus:
			"captured; pixel metrics and native parity require separate analysis",
		completed,
		exportFrames: frames,
		pageErrors,
		consoleErrors,
		beautyWarnings,
		stageEvents,
	};
	const persist = () =>
		writeFile(
			path.join(output, "e2e-evidence.json"),
			`${JSON.stringify(evidence, null, 2)}\n`
		);
	try {
		if (traceHelperPath) {
			const trace = (await import(path.resolve(traceHelperPath))) as {
				installIndependentSourceEvidenceTrace: (options: {
					app: typeof app;
					output: string;
				}) => Promise<void>;
			};
			await trace.installIndependentSourceEvidenceTrace({ app, output });
			evidence.sourceEvidenceTraceHelper = path.resolve(traceHelperPath);
			evidence.sourceEvidenceTraceHelperSha256 = createHash("sha256")
				.update(await readFile(traceHelperPath))
				.digest("hex");
		}
		const page = await getMainWindow(app);
		page.on("pageerror", (error) => pageErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
			if (
				message.type() === "warning" &&
				/portrait|beauty|native|degrad|fallback/i.test(message.text())
			) {
				beautyWarnings.push(message.text());
				if (beautyWarnings.length > 1000) beautyWarnings.shift();
			}
		});
		const project = await prepareCompositeProject({ page, source, settings });
		evidence.project = project;
		await installCompositeExportCapture({
			page,
			output,
			frames,
			settings,
			allowedPasses: passes.map(({ id }) => id),
		});
		await persist();
		await passes.reduce(async (previous, configuredPass) => {
			await previous;
			const { id: pass, adjustments } = configuredPass;
			await mkdir(path.join(output, pass), { recursive: true });
			await applyCompositeAdjustments({ page, project, adjustments });
			stageEvents.push({
				pass,
				stage: "exportStart",
				timestamp: new Date().toISOString(),
			});
			await persist();
			const exported = await exportCompositePass({
				page,
				project,
				pass,
				output,
				settings,
			});
			stageEvents.push({
				pass,
				stage: "exportEnd",
				timestamp: new Date().toISOString(),
			});
			await persist();
			expect(exported.probe.hasAudio).toBe(sourceProbe.hasAudio);
			expect(
				frames
					.filter((frame) => frame.pass === pass)
					.map((frame) => frame.frameIndex)
			).toEqual(settings.samples);
			await setOneToOnePreview({ page, settings });
			const previews: Array<
				Awaited<ReturnType<typeof captureCompositePreview>>
			> = [];
			await previewIndices.reduce(async (prior, frameIndex, sampleIndex) => {
				await prior;
				const selected = sampleIndex % 2 === 1;
				await page.evaluate(
					({ project, frameIndex, totalFrames, selected }) => {
						const stores = window as unknown as CompositeEvidenceWindow;
						stores.__timelineStore.getState().setSelectedElements(
							selected
								? [
										{
											trackId: project.trackId,
											elementId:
												project.elementIds[
													frameIndex < totalFrames / 2 ? 0 : 1
												],
										},
									]
								: []
						);
					},
					{ project, frameIndex, totalFrames: settings.totalFrames, selected }
				);
				previews.push(
					await captureCompositePreview({
						page,
						output,
						pass,
						frameIndex,
						settings,
					})
				);
				if (selected)
					await expect(
						page.getByTestId("media-transform-overlay")
					).toBeVisible();
			}, Promise.resolve());
			stageEvents.push({
				pass,
				stage: "previewEnd",
				timestamp: new Date().toISOString(),
			});
			completed.push({ pass, adjustments, exported, previews });
			await persist();
		}, Promise.resolve());
		expect(pageErrors).toEqual([]);
		evidence.status = "captured";
	} catch (error) {
		evidence.status = "failed";
		evidence.error =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
		throw error;
	} finally {
		await persist();
		await app.close();
	}
}

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ElectronApplication, expect, type Page } from "@playwright/test";
import type { BodyVideoWindow } from "./independent-body-video-helpers";
import { readBodyWorkerObservation } from "./body-video-worker-observer";
import { captureBodyOperationPreview } from "./body-video-operation-evidence";
import type { CapturedExportFrame } from "./portrait-composite-capture";

export const COREML_BODY_PROFILE = "swing-coreml-v1";

export function requestedBodyVideoProfile() {
	const profile = process.env.QCUT_BODY_CLOSE_PROFILE ?? "bef-cpu-warm-v1";
	if (profile !== "bef-cpu-warm-v1" && profile !== COREML_BODY_PROFILE)
		throw new Error(`Unknown QCUT_BODY_CLOSE_PROFILE: ${profile}`);
	return profile;
}

export async function assertSavedCoreMLBodyProfile({ page }: { page: Page }) {
	await expect
		.poll(() =>
			page.evaluate(() => {
				const clip = (window as unknown as BodyVideoWindow).__timelineStore
					.getState()
					.tracks.flatMap((track) => track.elements)
					.find((element) => element.type === "media");
				return clip?.type === "media"
					? clip.portraitAdjustments?.bodyVideoProfile
					: null;
			})
		)
		.toBe(COREML_BODY_PROFILE);
}

export async function selectCoreMLBodyProfile({
	page,
	output,
}: {
	page: Page;
	output: string;
}) {
	await page.evaluate(() => {
		const timeline = (
			window as unknown as BodyVideoWindow
		).__timelineStore.getState();
		const track = timeline.tracks.find((item) =>
			item.elements.some((element) => element.type === "media")
		);
		const clip = track?.elements.find((element) => element.type === "media");
		if (!track || !clip) throw new Error("CoreML selection needs a video clip");
		timeline.setSelectedElements([{ trackId: track.id, elementId: clip.id }]);
	});
	await page
		.getByTestId("media-properties")
		.getByRole("tab", { name: "美颜美体", exact: true })
		.click();
	const selector = page.getByTestId("portrait-body-video-profile-select");
	await expect(selector).toBeVisible();
	await expect(selector).toBeEnabled();
	await selector.click();
	await page
		.getByRole("option", { name: "原生调度 CoreML", exact: true })
		.click();
	await assertSavedCoreMLBodyProfile({ page });
	await expect(selector).toContainText("原生调度 CoreML");
	await mkdir(path.dirname(output), { recursive: true });
	await page.screenshot({ path: output });
	return {
		profile: COREML_BODY_PROFILE,
		selectedThroughUI: true,
		screenshot: output,
		selectedAt: Date.now(),
	};
}

export async function captureCoreMLBodyExecutionEvidence({
	app,
	output,
	frames,
}: {
	app: ElectronApplication;
	output: string;
	frames: number;
}) {
	const observation = await readBodyWorkerObservation({ app });
	await mkdir(output, { recursive: true });
	const observationFile = path.join(output, "worker-observation.json");
	const observationBytes = Buffer.from(
		`${JSON.stringify(observation, null, 2)}\n`
	);
	await writeFile(observationFile, observationBytes);
	expect(observation.evidenceErrors).toEqual([]);
	const executions = observation.executions.filter(
		(item) => item.profile === COREML_BODY_PROFILE
	);
	expect(executions.length).toBeGreaterThanOrEqual(frames);
	for (const item of executions) {
		expect(item.sequence?.executionProfile).toBe(COREML_BODY_PROFILE);
		expect(item.sequence?.executionGeneration).toMatch(/^[a-f0-9]{64}$/);
		expect(item.generation).toBe(item.sequence?.executionGeneration);
		expect(item.sequence?.session).toBe(item.generation);
	}
	const paths = [
		...new Set(executions.map((item) => item.sequence?.checkpoints)),
	];
	const journals = await Promise.all(
		paths.map(async (folder) => {
			if (!folder)
				throw new Error("CoreML execution lacks its checkpoint directory");
			const source = path.join(folder, "execution-routes-v1.json");
			const bytes = await readFile(source);
			const journal = JSON.parse(bytes.toString("utf8")) as {
				session: string;
				identity: { profile: string; generation: string };
				frames: Array<{
					frame: number;
					input: string;
					routes: Array<{ network: string; backend: string }>;
				}>;
			};
			expect(journal.identity.profile).toBe(COREML_BODY_PROFILE);
			expect(journal.identity.generation).toBe(journal.session);
			const file = path.join(output, `${journal.session}.journal.json`);
			await writeFile(file, bytes);
			return {
				source,
				file,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				...journal,
			};
		})
	);
	expect(
		Math.max(...journals.map((item) => item.frames.length))
	).toBeGreaterThanOrEqual(frames);
	const routes = journals.flatMap((item) =>
		item.frames.flatMap((frame) => frame.routes)
	);
	expect(routes.some((item) => item.backend === "coreml")).toBe(true);
	const receipt = {
		profile: COREML_BODY_PROFILE,
		observationalReportCopies: true,
		referenceRoutesInjected: false,
		nativeParityVerified: false,
		observation: {
			file: observationFile,
			sha256: createHash("sha256").update(observationBytes).digest("hex"),
			outerRequests: observation.sequenceHistory.length,
			workerAttempts: observation.workerHistory.length,
		},
		executions,
		journals,
		cpuPasses: routes.filter((item) => item.backend === "cpu").length,
		coremlPasses: routes.filter((item) => item.backend === "coreml").length,
	};
	await writeFile(
		path.join(output, "execution-evidence.json"),
		`${JSON.stringify(receipt, null, 2)}\n`
	);
	return receipt;
}

export async function verifyEveryBodyPreviewFrame({
	page,
	output,
	pass,
	frames,
	fps,
}: {
	page: Page;
	output: string;
	pass: string;
	frames: CapturedExportFrame[];
	fps: number;
}) {
	const rows: Array<Record<string, unknown>> = [];
	const failed: number[] = [];
	const reportPath = path.join(output, pass, "preview-export-all-frames.json");
	await frames.reduce(async (previous, frame) => {
		await previous;
		const preview = await captureBodyOperationPreview({
			page,
			output,
			stage: `${pass}/all-previews`,
			frame: frame.frameIndex,
			fps,
		});
		const exact = preview.rgbaSha256 === frame.rgbaSha256;
		if (!exact) failed.push(frame.frameIndex);
		rows.push({ ...preview, exportRgbaSha256: frame.rgbaSha256, exact });
		await writeFile(
			reportPath,
			`${JSON.stringify({ pass, plane: "full 1080x1920 pre-encode RGBA", rows, failed }, null, 2)}\n`
		);
	}, Promise.resolve());
	expect(failed, `${pass} full-frame paused preview/export mismatches`).toEqual(
		[]
	);
	return {
		file: reportPath,
		comparedFrames: rows.length,
		exactFrames: rows.length - failed.length,
	};
}

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { expect, type Locator } from "@playwright/test";
import type { BeautyLabIndependentStatus } from "../../../types/electron";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";
import {
	armCompositeCapture,
	installCompositeExportCapture,
	type CapturedExportFrame,
} from "./helpers/portrait-composite-capture";
import type { CompositeSettings } from "./helpers/portrait-composite-project";
import { createBodyImageEvidence } from "./helpers/body-image-evidence";
import {
	runBodyEditorCommand,
	readBodyPortraitAdjustments,
} from "./helpers/body-desktop-editor";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const FFPROBE = path.join(path.dirname(FFMPEG), "ffprobe");
const ENGINE = path.resolve("research/independent-beauty/research");
const PYTHON = path.join(ENGINE, ".venv/bin/python");
const PHOTO =
	process.env.QCUT_BODY_PHOTO ??
	path.resolve(
		"output/playwright/jianying-portrait-control-audit/fixtures/body-original.png"
	);
const SETTINGS: CompositeSettings = {
	width: 1080,
	height: 1920,
	fps: 24,
	seconds: 0.25,
	totalFrames: 6,
	transitionSeconds: 0,
	fit: "contain",
	samples: [0, 3, 5],
};
const CONTROLS = [
	["SmallHead", "小头"],
	["SwanNeck", "天鹅颈"],
	["SlimArm", "瘦手臂"],
	["OrthoShoulder", "直角肩"],
	["WidenShoulderTest", "宽肩"],
	["SlimBody", "瘦身"],
	["SlimWaist", "瘦腰"],
	["StretchLeg", "长腿"],
	["SlimBreast", "胸型"],
	["SlimHip", "美胯"],
] as const;

const { rgba, difference } = createBodyImageEvidence({
	ffmpeg: FFMPEG,
	width: SETTINGS.width,
	height: SETTINGS.height,
});

async function setNumber({
	container,
	label,
	value,
}: {
	container: Locator;
	label: string;
	value: number;
}) {
	const input = container.getByLabel(`${label}数值`, { exact: true });
	await expect(input).toBeEnabled();
	await input.fill(String(value));
	await input.press("Tab");
}

test.use({ captureScreenshotVideo: false, appLocale: "zh" });
test.setTimeout(900_000);

test("ten independent smart body sliders and manual tools reach 1080p preview and export through desktop UI", async ({
	apiPort,
	page,
}, testInfo) => {
	test.skip(
		!existsSync(FFMPEG) ||
			!existsSync(FFPROBE) ||
			!existsSync(PYTHON) ||
			!existsSync(PHOTO),
		"local body image or independent environment missing"
	);
	const status = await page.evaluate(() =>
		(
			window as unknown as {
				electronAPI?: {
					beautyLab?: {
						inspectIndependent: () => Promise<BeautyLabIndependentStatus>;
					};
				};
			}
		).electronAPI?.beautyLab?.inspectIndependent()
	);
	test.skip(
		!status?.available,
		status?.message ?? "independent engine missing"
	);
	for (const [key] of CONTROLS)
		expect(status?.controls).toContain(`body_adjust_${key}`);
	for (const tool of ["stretch", "slim", "zoom"])
		expect(status?.manualBodyTools).toContain(tool);
	const base = path.resolve(
		"output/playwright/portrait-independent-body-composite"
	);
	mkdirSync(base, { recursive: true });
	const output = mkdtempSync(path.join(base, "run-"));
	writeFileSync(
		path.join(output, "status.json"),
		JSON.stringify(status, null, 2)
	);
	const original = path.join(output, "original.png");
	execFileSync(FFMPEG, [
		"-v",
		"error",
		"-i",
		PHOTO,
		"-vf",
		"scale=1080:1920:flags=lanczos,format=rgb24",
		original,
	]);
	const run = <T>(...args: string[]) =>
		runBodyEditorCommand<T>({ apiPort, args });
	const { projectId } = await run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"Independent body composite UI acceptance",
		"--width",
		"1080",
		"--height",
		"1920",
		"--fps",
		"24",
		"--open",
		"--wait-ready"
	);
	const pid = ["--project-id", projectId];
	const { tracks } = await run<{
		tracks: Array<{ id: string; isMain?: boolean }>;
	}>("editor:track:list", ...pid);
	const main = tracks.find((track) => track.isMain);
	if (!main) throw new Error("Main track missing");
	await run("editor:media:batch-import", ...pid, "--sources", original);
	const { elementId } = await run<{ elementId: string }>(
		"editor:timeline:add-element",
		...pid,
		"--data",
		JSON.stringify({
			type: "media",
			sourceName: path.basename(original),
			trackId: main.id,
			startTime: 0,
			duration: SETTINGS.seconds,
			fitMode: "contain",
		})
	);
	await run(
		"editor:timeline:select",
		...pid,
		"--elements",
		JSON.stringify([{ trackId: main.id, elementId }])
	);
	await page
		.getByTestId("media-properties")
		.getByRole("tab", { name: "美颜美体", exact: true })
		.click();
	const panel = page.getByTestId("jianying-portrait-adjustments");
	await panel.getByRole("combobox", { name: "美颜处理引擎" }).click();
	await page.getByRole("option", { name: "自研", exact: true }).click();
	const toggle = panel.getByRole("switch", { name: "启用自研美颜美体" });
	await expect(toggle).toBeEnabled({ timeout: 60_000 });
	if ((await toggle.getAttribute("aria-checked")) !== "true")
		await toggle.click();
	await panel.getByRole("tab", { name: "美体", exact: true }).click();
	await expect(panel.getByTestId("portrait-body-scope")).toContainText(
		"首个检测人物"
	);
	const smart = panel.getByTestId("portrait-section-body");
	await CONTROLS.reduce(
		(previous, [, label]) =>
			previous.then(() => setNumber({ container: smart, label, value: 25 })),
		Promise.resolve()
	);
	const expectedValues = Object.fromEntries(
		CONTROLS.map(([key]) => [`body_adjust_${key}`, 25])
	);
	await expect
		.poll(
			async () =>
				(await readBodyPortraitAdjustments({ page, elementId }))?.values
		)
		.toEqual(expectedValues);
	await expect(panel.getByTestId("portrait-engine-issue")).toHaveCount(0);
	await page.screenshot({
		path: path.join(output, "01-smart-controls.png"),
		animations: "disabled",
	});
	await panel.getByRole("button", { name: "手动美体", exact: true }).click();
	const manual = panel.getByTestId("portrait-manual-body-controls");
	await setNumber({ container: manual, label: "强度", value: 12 });
	await manual.getByRole("button", { name: "瘦身瘦腿", exact: true }).click();
	await setNumber({ container: manual, label: "强度", value: 16 });
	await manual.getByRole("button", { name: "放大缩小", exact: true }).click();
	const canvas = page
		.locator(`[data-preview-element-id="${elementId}"]`)
		.getByTestId("color-preview-canvas");
	const before = Number(
		(await canvas.getAttribute("data-rendered-frame-count")) ?? 0
	);
	await setNumber({ container: manual, label: "强度", value: 8 });
	const adjustments = await readBodyPortraitAdjustments({ page, elementId });
	expect(adjustments).toMatchObject({
		enabled: true,
		engine: "independent",
		values: expectedValues,
		manualBody: {
			stretch: { intensity: 12 },
			slim: { intensity: 16 },
			zoom: { intensity: 8 },
		},
	});
	await expect
		.poll(
			async () =>
				Number((await canvas.getAttribute("data-rendered-frame-count")) ?? 0),
			{ timeout: 180_000 }
		)
		.toBeGreaterThan(before);
	await expect(canvas).toHaveAttribute(
		"data-rendered-portrait-status",
		"applied"
	);
	await expect(canvas).toHaveAttribute(
		"data-rendered-portrait-engine",
		"independent"
	);
	const preview = await canvas.evaluate((node) => {
		const rendered = node as HTMLCanvasElement;
		return {
			width: rendered.width,
			height: rendered.height,
			png: rendered.toDataURL("image/png"),
			metadata: { ...rendered.dataset },
		};
	});
	expect([preview.width, preview.height]).toEqual([1080, 1920]);
	const previewFile = path.join(output, "preview.png");
	writeFileSync(previewFile, Buffer.from(preview.png.split(",")[1], "base64"));
	await page.screenshot({
		path: path.join(output, "02-combined-controls.png"),
		animations: "disabled",
	});
	const requestFile = path.join(output, "request.json");
	writeFileSync(
		requestFile,
		JSON.stringify(
			{ values: adjustments?.values, manualBody: adjustments?.manualBody },
			null,
			2
		)
	);
	const reference = path.join(output, "independent.png");
	execFileSync(
		PYTHON,
		[
			"-B",
			path.join(ENGINE, "independent_pipeline.py"),
			"--image",
			original,
			"--request",
			requestFile,
			"--resolution",
			"original",
			"--output",
			reference,
			"--report",
			path.join(output, "engine-receipt.json"),
		],
		{ timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }
	);
	const engineReceipt = JSON.parse(
		readFileSync(path.join(output, "engine-receipt.json"), "utf8")
	) as {
		stages: Array<{
			id: string;
			receipt: { identity: boolean; controls: Record<string, number> };
		}>;
	};
	expect(engineReceipt.stages.map((stage) => stage.id)).toEqual([
		"manual-body",
		"smart-body",
	]);
	expect(engineReceipt.stages[1].receipt).toMatchObject({
		identity: false,
		controls: Object.fromEntries(CONTROLS.map(([key]) => [key, 25])),
	});
	const previewRgba = rgba({ file: previewFile });
	const referenceRgba = rgba({ file: reference });
	const previewVsReference = difference({
		left: previewRgba,
		right: referenceRgba,
	});
	expect(previewVsReference.maxRgb).toBeLessThanOrEqual(1);
	expect(previewVsReference.maxAlpha).toBe(0);
	const changed = difference({
		left: referenceRgba,
		right: rgba({ file: original }),
		output: path.join(output, "difference-original-x4.png"),
	});
	expect(changed.changedPixels).toBeGreaterThan(1080 * 1920 * 0.01);
	expect(changed.meanRgb).toBeGreaterThan(0.5);
	const frames: CapturedExportFrame[] = [];
	await installCompositeExportCapture({
		page,
		output,
		frames,
		settings: SETTINGS,
		allowedPasses: ["combined"],
	});
	await armCompositeCapture({ page, pass: "combined", settings: SETTINGS });
	const video = path.join(output, "combined.mp4");
	const job = await runBodyEditorCommand<{ engine?: string }>({
		apiPort,
		timeout: 600_000,
		args: [
			"editor:export:start",
			...pid,
			"--preset",
			"tiktok",
			"--fps",
			"24",
			"--format",
			"mp4",
			"--output",
			video,
			"--poll",
		],
	});
	expect(job.engine).toBe("renderer-muxer");
	expect(frames.map((frame) => frame.frameIndex).sort((a, b) => a - b)).toEqual(
		SETTINGS.samples
	);
	const comparisons = frames.map((frame) => ({
		frameIndex: frame.frameIndex,
		...difference({
			left: previewRgba,
			right: rgba({ file: path.join(output, frame.file) }),
			...(frame.frameIndex === 3
				? { output: path.join(output, "difference-preview-export-x4.png") }
				: {}),
		}),
	}));
	for (const comparison of comparisons) {
		expect(comparison.maxRgb).toBeLessThanOrEqual(1);
		expect(comparison.maxAlpha).toBe(0);
	}
	execFileSync(FFMPEG, ["-v", "error", "-i", video, "-f", "null", "-"], {
		timeout: 60_000,
	});
	const probe = JSON.parse(
		execFileSync(
			FFPROBE,
			[
				"-v",
				"error",
				"-count_frames",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=width,height,r_frame_rate,nb_read_frames",
				"-of",
				"json",
				video,
			],
			{ encoding: "utf8" }
		)
	) as {
		streams: Array<{
			width: number;
			height: number;
			r_frame_rate: string;
			nb_read_frames: string;
		}>;
	};
	expect(probe.streams).toEqual([
		{ width: 1080, height: 1920, r_frame_rate: "24/1", nb_read_frames: "6" },
	]);
	const decoded = path.join(output, "export-decoded.png");
	execFileSync(FFMPEG, [
		"-v",
		"error",
		"-ss",
		"0.125",
		"-i",
		video,
		"-frames:v",
		"1",
		decoded,
	]);
	const decodedVsPreview = difference({
		left: previewRgba,
		right: rgba({ file: decoded }),
	});
	expect(decodedVsPreview.meanRgb).toBeLessThan(5);
	execFileSync(FFMPEG, [
		"-v",
		"error",
		"-i",
		original,
		"-i",
		reference,
		"-i",
		path.join(output, "difference-original-x4.png"),
		"-filter_complex",
		"[0:v]scale=360:640[a];[1:v]scale=360:640[b];[2:v]scale=360:640[c];[a][b][c]hstack=inputs=3",
		"-frames:v",
		"1",
		path.join(output, "original-effect-difference.png"),
	]);
	const receipt = {
		scope: "1080p still-photo desktop UI smart10 + manual3",
		passed: true,
		projectId,
		elementId,
		settings: SETTINGS,
		adjustments,
		previewMetadata: preview.metadata,
		previewVsReference,
		changed,
		comparisons,
		decodedVsPreview,
		probe,
		sourceSha256: createHash("sha256")
			.update(readFileSync(original))
			.digest("hex"),
		frames,
		videoTemporalAcceptance: false,
		nativeParityAcceptance: false,
		output,
	};
	writeFileSync(
		path.join(output, "acceptance.json"),
		JSON.stringify(receipt, null, 2)
	);
	await testInfo.attach("body-composite-acceptance", {
		path: path.join(output, "acceptance.json"),
		contentType: "application/json",
	});
	await testInfo.attach("original-effect-difference", {
		path: path.join(output, "original-effect-difference.png"),
		contentType: "image/png",
	});
	console.log(`Body desktop evidence: ${output}`);
});

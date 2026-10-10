import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ElectronApplication, Page } from "@playwright/test";
import type {
	JianyingPortraitAdjustmentRenderRequest as RenderRequest,
	JianyingPortraitAdjustmentRenderResult as RenderResult,
} from "../../../../../../electron/jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract";
import { getFFmpegPath } from "../../../../../../electron/ffmpeg/paths";
import type { ReferenceWindow } from "./portrait-reference";

const execFileAsync = promisify(execFile);
export const ORIGINAL_SHA256 =
	"82368440b756da91aa081b4851b2b7a7c2a161d62a602a34b7db77aa22f31234";
// Chromium truncates currentTime to microseconds; seek inside frame 65, not just before its PTS.
export const TARGET_SECONDS = 65 / 30 + 0.001;
export const VIDEO_SIZE = { width: 854, height: 480 };

export function sha256({ bytes }: { bytes: Uint8Array }) {
	return createHash("sha256").update(bytes).digest("hex");
}

export async function prepareBrowserFixture({
	source,
	output,
}: {
	source: string;
	output: string;
}) {
	const sourceSha256 = sha256({ bytes: await readFile(source) });
	if (sourceSha256 !== ORIGINAL_SHA256)
		throw new Error("Occlusion source does not match the pinned local fixture");
	const browserSource = path.join(output, "portrait-motion-browser.mp4");
	const args = [
		"-v",
		"error",
		"-n",
		"-i",
		source,
		"-an",
		"-vf",
		"scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"0",
		"-g",
		"30",
		"-colorspace",
		"bt709",
		"-color_primaries",
		"bt709",
		"-color_trc",
		"bt709",
		"-color_range",
		"tv",
		"-movflags",
		"+faststart",
		browserSource,
	];
	await execFileAsync(getFFmpegPath(), args, { timeout: 60_000 });
	return {
		source,
		sourceSha256,
		browserSource,
		browserSha256: sha256({ bytes: await readFile(browserSource) }),
		ffmpeg: getFFmpegPath(),
		args,
	};
}

export async function runtimeIdentity() {
	const sourceFiles = [
		"electron/jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.ts",
		"electron/jianying-portrait-adjustment-runtime/provider.ts",
		"electron/jianying-portrait-adjustment-runtime/tracking-scope-pool.ts",
		"electron/jianying-portrait-adjustment-runtime/source-preroll.ts",
		"apps/web/src/lib/portrait/portrait-source-preroll.ts",
		"apps/web/src/lib/portrait/jianying-portrait-adjustment-preview.ts",
		"apps/web/src/components/editor/preview-panel/color-preview-canvas.tsx",
		"apps/web/src/lib/export/export-engine-renderer.ts",
		"apps/web/src/lib/export/export-engine.ts",
		"apps/web/src/test/e2e/portrait-source-preroll.e2e.ts",
		"apps/web/src/test/e2e/helpers/portrait-source-preroll-evidence.ts",
	];
	const builtFiles = [
		"dist/electron/main.js",
		"dist/electron/preload.js",
		"dist/electron/jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-handler.js",
		"dist/electron/jianying-portrait-adjustment-runtime/provider.js",
		"dist/electron/jianying-portrait-adjustment-runtime/source-preroll.js",
		"dist/electron/jianying-portrait-adjustment-runtime/tracking-scope-pool.js",
		"apps/web/dist/index.html",
	];
	// Bind the renderer build, including lazy decoder chunks, without scanning private caches.
	const assets = await readdir("apps/web/dist/assets");
	const files = [
		...sourceFiles,
		...builtFiles,
		...assets
			.filter((name) => name.endsWith(".js"))
			.map((name) => `apps/web/dist/assets/${name}`),
	].sort();
	return Object.fromEntries(
		await Promise.all(
			files.map(async (file) => [file, sha256({ bytes: await readFile(file) })])
		)
	);
}

export interface Observation {
	phase: string;
	sourceKey?: string;
	timestampSeconds?: number;
	width: number;
	height: number;
	inputSha256: string;
	outputSha256: string;
	needsSourcePreRoll: boolean;
	history: { timestampSeconds: number; sha256: string }[];
	completed: boolean;
}

interface CapturedRender {
	event: unknown;
	request: RenderRequest;
	result: RenderResult;
}

interface Probe {
	phase: string;
	observations: Observation[];
	captured: Map<string, CapturedRender>;
	invoke: (...args: unknown[]) => unknown;
	holdNext: boolean;
	held: boolean;
	release?: () => void;
}

interface ProbeGlobal {
	__portraitSourceProbe: Probe;
}

export async function installProbe({ app }: { app: ElectronApplication }) {
	await app.evaluate(({ ipcMain }) => {
		const handlers = (
			ipcMain as unknown as {
				_invokeHandlers: Map<string, (...args: unknown[]) => unknown>;
			}
		)._invokeHandlers;
		const channel = "jianying-portrait-adjustment:render";
		const original = handlers.get(channel);
		if (!original) throw new Error("Portrait render handler missing");
		const crypto = process.getBuiltinModule("crypto");
		const hash = (bytes: Uint8Array) =>
			crypto.createHash("sha256").update(bytes).digest("hex");
		const probe: Probe = {
			phase: "setup",
			observations: [],
			captured: new Map(),
			invoke: original,
			holdNext: false,
			held: false,
		};
		(globalThis as unknown as ProbeGlobal).__portraitSourceProbe = probe;
		handlers.set(channel, async (...args: unknown[]) => {
			if (probe.observations.length >= 100)
				throw new Error("Portrait E2E observation limit exceeded");
			const request = args[1] as RenderRequest;
			const phase = request.sourceKey?.startsWith("video:")
				? "export"
				: probe.phase;
			const hold = probe.holdNext;
			probe.holdNext = false;
			const observation: Observation = {
				phase,
				sourceKey: request.sourceKey,
				timestampSeconds: request.timestampSeconds,
				width: request.width,
				height: request.height,
				inputSha256: hash(request.rgba),
				outputSha256: "",
				needsSourcePreRoll: false,
				completed: false,
				history:
					request.sourcePreRoll?.frames.map((frame) => ({
						timestampSeconds: frame.timestampSeconds,
						sha256: hash(frame.rgba),
					})) ?? [],
			};
			probe.observations.push(observation);
			const result = (await original(...args)) as RenderResult;
			observation.outputSha256 = hash(result.rgba);
			observation.needsSourcePreRoll = result.needsSourcePreRoll === true;
			observation.completed = true;
			const key = `${phase}:${request.sourcePreRoll ? "recovery" : "cold"}`;
			if (!probe.captured.has(key))
				probe.captured.set(key, { event: args[0], request, result });
			if (hold) {
				// Delay only delivery, not native processing or pixels, to deterministically cancel an in-flight UI request.
				await new Promise<void>((resolve) => {
					const timeout = setTimeout(resolve, 15_000);
					probe.held = true;
					probe.release = () => {
						clearTimeout(timeout);
						resolve();
					};
				});
				probe.held = false;
			}
			return result;
		});
	});
}

export async function setPhase({
	app,
	phase,
	holdNext = false,
}: {
	app: ElectronApplication;
	phase: string;
	holdNext?: boolean;
}) {
	await app.evaluate(
		(_, options) => {
			const probe = (globalThis as unknown as ProbeGlobal)
				.__portraitSourceProbe;
			probe.phase = options.phase;
			probe.holdNext = options.holdNext;
		},
		{ phase, holdNext }
	);
}

export async function releaseDelivery({ app }: { app: ElectronApplication }) {
	await app.evaluate(() =>
		(globalThis as unknown as ProbeGlobal).__portraitSourceProbe.release?.()
	);
}

export async function readProbe({ app }: { app: ElectronApplication }) {
	return app.evaluate(() => {
		const probe = (globalThis as unknown as ProbeGlobal).__portraitSourceProbe;
		return { observations: probe.observations, held: probe.held };
	});
}

export async function sequentialReference({
	app,
	phase,
}: {
	app: ElectronApplication;
	phase: string;
}) {
	return app.evaluate(async (_, phase) => {
		const probe = (globalThis as unknown as ProbeGlobal).__portraitSourceProbe;
		const capture = probe.captured.get(`${phase}:recovery`);
		if (!capture?.request.sourcePreRoll)
			throw new Error(`No real decoder recovery for ${phase}`);
		const { sourcePreRoll, ...target } = capture.request;
		const sourceKey = `e2e-sequential-reference:${phase}:${Date.now()}`;
		// Reference replays observed browser-decoded frames individually, never injecting history into the UI.
		await sourcePreRoll.frames.reduce(async (previous, frame, index) => {
			await previous;
			await probe.invoke(capture.event, {
				...target,
				sourceKey,
				rgba: frame.rgba,
				timestampSeconds: frame.timestampSeconds,
				frameNumber: index,
			});
		}, Promise.resolve());
		const result = (await probe.invoke(capture.event, {
			...target,
			sourceKey,
			frameNumber: sourcePreRoll.frames.length,
		})) as RenderResult;
		return {
			width: target.width,
			height: target.height,
			input: Buffer.from(target.rgba).toString("base64"),
			recovered: Buffer.from(capture.result.rgba).toString("base64"),
			reference: Buffer.from(result.rgba).toString("base64"),
			referenceNeedsSourcePreRoll: result.needsSourcePreRoll === true,
		};
	}, phase);
}

export async function pixelEvidence({
	output,
	name,
	input,
	actual,
	reference,
	width,
	height,
}: {
	output: string;
	name: string;
	input: Buffer;
	actual: Buffer;
	reference: Buffer;
	width: number;
	height: number;
}) {
	if (
		[input, actual, reference].some(
			(bytes) => bytes.length !== width * height * 4
		)
	)
		throw new Error("Evidence RGBA dimensions mismatch");
	let changedPixels = 0;
	let differingPixels = 0;
	let graySum = 0;
	let grayMax = 0;
	const grayDiff = Buffer.alloc(width * height);
	for (let pixel = 0; pixel < width * height; pixel += 1) {
		const offset = pixel * 4;
		if (
			!actual
				.subarray(offset, offset + 4)
				.equals(input.subarray(offset, offset + 4))
		)
			changedPixels += 1;
		if (
			!actual
				.subarray(offset, offset + 4)
				.equals(reference.subarray(offset, offset + 4))
		)
			differingPixels += 1;
		const gray = (bytes: Buffer) =>
			(77 * bytes[offset] + 150 * bytes[offset + 1] + 29 * bytes[offset + 2]) >>
			8;
		const delta = Math.abs(gray(actual) - gray(reference));
		grayDiff[pixel] = delta;
		graySum += delta;
		grayMax = Math.max(grayMax, delta);
	}
	const savePng = ({
		bytes,
		suffix,
		pixelFormat,
	}: {
		bytes: Buffer;
		suffix: string;
		pixelFormat: "rgba" | "gray";
	}) =>
		new Promise<void>((resolve, reject) => {
			const child = execFile(
				getFFmpegPath(),
				[
					"-v",
					"error",
					"-y",
					"-f",
					"rawvideo",
					"-pixel_format",
					pixelFormat,
					"-video_size",
					`${width}x${height}`,
					"-i",
					"pipe:0",
					"-frames:v",
					"1",
					"-threads",
					"1",
					path.join(output, `${name}-${suffix}.png`),
				],
				{ timeout: 30_000 },
				(error) => (error ? reject(error) : resolve())
			);
			child.stdin?.on("error", reject);
			child.stdin?.end(bytes);
		});
	await Promise.all([
		...[
			{ name: "input", bytes: input },
			{ name: "actual", bytes: actual },
			{ name: "sequential", bytes: reference },
		].map(({ name: suffix, bytes }) =>
			savePng({ bytes, suffix, pixelFormat: "rgba" })
		),
		savePng({
			bytes: grayDiff,
			suffix: "gray-difference",
			pixelFormat: "gray",
		}),
	]);
	return {
		changedPixels,
		differingPixels,
		grayMeanAbsoluteDifference: graySum / (width * height),
		grayMax,
		inputSha256: sha256({ bytes: input }),
		actualSha256: sha256({ bytes: actual }),
		referenceSha256: sha256({ bytes: reference }),
	};
}

type PlaybackWindow = ReferenceWindow & {
	__playbackStore: {
		getState: () => { seek: (time: number) => void; currentTime: number };
	};
};

export async function seekSource({
	page,
	seconds,
	sourceSeconds = seconds,
}: {
	page: Page;
	seconds: number;
	sourceSeconds?: number;
}) {
	await page.evaluate((seconds) => {
		(window as unknown as PlaybackWindow).__playbackStore
			.getState()
			.seek(seconds);
	}, seconds);
	await page.waitForFunction((seconds) => {
		const video = document.querySelector<HTMLVideoElement>(
			'[data-testid="preview-capture-surface"] video'
		);
		return (
			video &&
			!video.seeking &&
			video.readyState >= 2 &&
			Math.abs(video.currentTime - seconds) < 0.002
		);
	}, sourceSeconds);
}

export async function previewState({ page }: { page: Page }) {
	return page.evaluate(async () => {
		const surface = document.querySelector(
			'[data-testid="preview-capture-surface"]'
		);
		const video = surface?.querySelector("video");
		const canvas = surface?.querySelector<HTMLCanvasElement>(
			'[data-testid="color-preview-canvas"]'
		);
		if (!video) throw new Error("Actual timeline video missing");
		const source = document.createElement("canvas");
		source.width = canvas?.width ?? video.videoWidth;
		source.height = canvas?.height ?? video.videoHeight;
		const ctx = source.getContext("2d");
		if (!ctx) throw new Error("Source canvas unavailable");
		ctx.drawImage(video, 0, 0, source.width, source.height);
		const paintedCanvas = canvas ?? source;
		const painted = paintedCanvas
			.getContext("2d")
			?.getImageData(0, 0, source.width, source.height);
		if (!painted) throw new Error("Painted canvas pixels unavailable");
		const digest = await crypto.subtle.digest("SHA-256", painted.data);
		const paintedSha256 = Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, "0")
		).join("");
		const sourceDigest = await crypto.subtle.digest(
			"SHA-256",
			ctx.getImageData(0, 0, source.width, source.height).data
		);
		const sourceSha256 = Array.from(new Uint8Array(sourceDigest), (byte) =>
			byte.toString(16).padStart(2, "0")
		).join("");
		return {
			canvasPresent: Boolean(canvas),
			paintedSha256,
			sourceSha256,
			timestampSeconds: video.currentTime,
			sourceUrl: video.currentSrc,
			timelineSeconds: (
				window as unknown as PlaybackWindow
			).__playbackStore.getState().currentTime,
			paused: video.paused,
			width: source.width,
			height: source.height,
			paintedPng: paintedCanvas.toDataURL("image/png").split(",")[1],
			sourcePng: source.toDataURL("image/png").split(",")[1],
			commits: Number(canvas?.dataset.renderedFrameCount ?? 0),
		};
	});
}

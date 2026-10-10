import { createHash } from "node:crypto";
import {
	access,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import os from "node:os";
import path from "node:path";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import { z } from "zod";
import {
	BEAUTY_LAB_INDEPENDENT_PROVIDER,
	type BeautyLabIndependentRequest,
	type BeautyLabIndependentResult,
} from "./beauty-lab-independent-contract.js";
import { runIndependentBeautyJob } from "./beauty-lab-independent-process.js";
import { verifyIndependentBeautyRuntime } from "../beauty-lab-runtime-payload.js";
import {
	independentBeautyEnvironment,
	verifyIndependentBeautyEnvironment,
} from "./beauty-lab-runtime-environment.js";

const requestSchema = z
	.object({
		requestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
		sourceKey: z.string().min(1).max(256),
		width: z.number().int().min(1).max(1280),
		height: z.number().int().min(1).max(1280),
		rgba: z.instanceof(Uint8Array),
		adjustments: z
			.object({
				enabled: z.literal(true),
				values: z.record(z.string(), z.number().finite()),
				makeup: z
					.record(
						z.string(),
						z
							.object({ cardId: z.string(), intensity: z.number().finite() })
							.strict()
					)
					.optional(),
				faceTarget: z
					.object({ mode: z.literal("all") })
					.strict()
					.optional(),
				faces: z.array(z.never()).max(0).optional(),
				skinToneResourceId: z.null().optional(),
				manualBody: z.object({}).strict().optional(),
				manualRetouch: z
					.object({ strokes: z.array(z.never()).max(0) })
					.strict()
					.optional(),
			})
			.strict(),
	})
	.strict();
const hash = ({ bytes }: { bytes: Uint8Array }) =>
	createHash("sha256").update(bytes).digest("hex");
const catalogSchema = z.object({
	controls: z.array(
		z.object({ name: z.string(), min: z.number(), max: z.number() })
	),
	makeup: z.array(z.object({ id: z.string(), category: z.string() })),
});

export function independentBeautyAdjustments({
	request,
	catalog,
}: {
	request: unknown;
	catalog: z.infer<typeof catalogSchema>;
}) {
	const parsed = requestSchema.parse(request);
	if (
		parsed.rgba.buffer instanceof SharedArrayBuffer ||
		parsed.rgba.length !== parsed.width * parsed.height * 4
	)
		throw new Error("Invalid independent input RGBA");
	for (let index = 3; index < parsed.rgba.length; index += 4)
		if (parsed.rgba[index] !== 255)
			throw new Error("Independent beauty requires an opaque photo");
	const values: Record<string, number> = {};
	for (const [key, value] of Object.entries(parsed.adjustments.values)) {
		const name = key.startsWith("face_adjust_") ? key.slice(12) : key;
		const control = catalog.controls.find((entry) => entry.name === name);
		if (!control) {
			if (value === 0) continue;
			throw new Error(`Independent beauty does not support ${key}`);
		}
		if (
			Object.hasOwn(values, name) ||
			value < control.min ||
			value > control.max
		)
			throw new Error(`Invalid independent control ${key}`);
		values[name] = Object.is(value, -0) ? 0 : value;
	}
	const makeup = parsed.adjustments.makeup ?? {};
	for (const [category, selection] of Object.entries(makeup)) {
		if (
			!catalog.makeup.some(
				(card) => card.id === selection.cardId && card.category === category
			) ||
			selection.intensity < 0 ||
			selection.intensity > 100
		)
			throw new Error(`Unsupported independent makeup ${category}`);
	}
	return {
		request: structuredClone(parsed) as BeautyLabIndependentRequest,
		adjustments: { values, makeup },
	};
}

export function createBeautyLabIndependentProvider({
	engineRoot,
	runtimeRoot = path.join(engineRoot, "runtime"),
	python = path.join(engineRoot, "research/.venv/bin/python"),
	platform = process.platform,
	environment = process.env,
	runJob = runIndependentBeautyJob,
	verifyRuntime = verifyIndependentBeautyRuntime,
	verifyEnvironment = verifyIndependentBeautyEnvironment,
}: {
	engineRoot: string;
	runtimeRoot?: string;
	python?: string;
	platform?: NodeJS.Platform;
	environment?: NodeJS.ProcessEnv;
	runJob?: typeof runIndependentBeautyJob;
	verifyRuntime?: typeof verifyIndependentBeautyRuntime;
	verifyEnvironment?: typeof verifyIndependentBeautyEnvironment;
}) {
	let active:
		| { id: string; controller: AbortController; done: Promise<void> }
		| undefined;
	let disposed = false;
	let verifiedEnvironmentKey: string | null = null;
	async function resolveBun() {
		const candidates = [
			environment.QCUT_INDEPENDENT_BEAUTY_BUN,
			...(environment.PATH ?? "")
				.split(path.delimiter)
				.filter(Boolean)
				.map((directory) => path.join(directory, "bun")),
			path.join(os.homedir(), ".bun/bin/bun"),
			"/opt/homebrew/bin/bun",
			"/usr/local/bin/bun",
		].filter((file): file is string => Boolean(file));
		const found = await Promise.all(
			candidates.map(async (file) => {
				try {
					await access(file, constants.X_OK);
					return file;
				} catch {
					return null;
				}
			})
		);
		const executable = found.find((file): file is string => file !== null);
		if (!executable)
			throw new Error("Bun is required for the independent pipeline planner");
		return executable;
	}
	async function catalog() {
		return catalogSchema.parse(
			JSON.parse(
				await readFile(
					path.join(engineRoot, "research/independent-pipeline-catalog.json"),
					"utf8"
				)
			)
		);
	}
	async function verifySources() {
		const manifestBytes = await readFile(
			path.join(engineRoot, "source-manifest.json")
		);
		const manifest = z
			.object({
				files: z.array(
					z.object({
						path: z.string(),
						sha256: z.string().regex(/^[a-f0-9]{64}$/),
					})
				),
				generatedFiles: z.array(
					z.object({
						path: z.string(),
						sha256: z.string().regex(/^[a-f0-9]{64}$/),
					})
				),
			})
			.parse(JSON.parse(manifestBytes.toString("utf8")));
		await Promise.all(
			[...manifest.files, ...manifest.generatedFiles].map(async (file) => {
				if (
					path.isAbsolute(file.path) ||
					file.path.split(/[\\/]/).includes("..")
				)
					throw new Error("Invalid independent source path");
				if (
					hash({ bytes: await readFile(path.join(engineRoot, file.path)) }) !==
					file.sha256
				)
					throw new Error(`Independent source changed: ${file.path}`);
			})
		);
		return hash({ bytes: manifestBytes });
	}
	async function inspect({ signal }: { signal?: AbortSignal } = {}) {
		try {
			if (platform !== "darwin" || disposed)
				throw new Error(
					"Independent photo engine requires macOS and an active provider"
				);
			const sourceManifestSha256 = await verifySources();
			const [, , bun] = await Promise.all([
				access(python, constants.X_OK),
				verifyRuntime({ runtimeRoot, sourceManifestSha256 }),
				resolveBun(),
			]);
			const environmentKey = JSON.stringify([
				python,
				bun,
				sourceManifestSha256,
				environment.DEVELOPER_DIR,
				environment.SDKROOT,
			]);
			if (verifiedEnvironmentKey !== environmentKey) {
				verifiedEnvironmentKey = null;
				await verifyEnvironment({
					python,
					bun,
					cwd: engineRoot,
					environment,
					signal,
				});
				signal?.throwIfAborted();
				verifiedEnvironmentKey = environmentKey;
			}
			const inventory = await catalog();
			return {
				available: true,
				provider: BEAUTY_LAB_INDEPENDENT_PROVIDER,
				message:
					"Single opaque photo, max edge 1280; composite native parity unverified",
				controls: inventory.controls.map(({ name }) => `face_adjust_${name}`),
				makeupCards: inventory.makeup.map(({ id }) => id),
			};
		} catch (error) {
			return {
				available: false,
				provider: BEAUTY_LAB_INDEPENDENT_PROVIDER,
				message: String(error),
				controls: [],
				makeupCards: [],
			};
		}
	}
	async function render({
		request,
	}: {
		request: unknown;
	}): Promise<BeautyLabIndependentResult> {
		if (active || disposed)
			throw new Error("Independent engine busy or disposed");
		const input = structuredClone(requestSchema.parse(request));
		let finish = () => {};
		const job = {
			id: input.requestId,
			controller: new AbortController(),
			done: new Promise<void>((resolve) => {
				finish = resolve;
			}),
		};
		active = job;
		let directory: string | undefined;
		try {
			const status = await inspect({ signal: job.controller.signal });
			if (!status.available) throw new Error(status.message);
			const validated = independentBeautyAdjustments({
				request: input,
				catalog: await catalog(),
			});
			const manifestSha256 = await verifySources();
			job.controller.signal.throwIfAborted();
			directory = await mkdtemp(
				path.join(os.tmpdir(), "qcut-independent-beauty-")
			);
			const canvas = createCanvas(input.width, input.height);
			canvas
				.getContext("2d")
				.putImageData(
					new ImageData(
						new Uint8ClampedArray(input.rgba),
						input.width,
						input.height
					),
					0,
					0
				);
			await Promise.all([
				writeFile(
					path.join(directory, "input.png"),
					canvas.toBuffer("image/png")
				),
				writeFile(
					path.join(directory, "request.json"),
					JSON.stringify(validated.adjustments)
				),
			]);
			const cleanEnvironment = independentBeautyEnvironment({ environment });
			cleanEnvironment.PATH = [
				path.dirname(await resolveBun()),
				cleanEnvironment.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
			].join(path.delimiter);
			await runJob({
				python,
				cwd: engineRoot,
				environment: cleanEnvironment,
				signal: job.controller.signal,
				timeoutMs: 600_000,
				args: [
					"-B",
					path.join(engineRoot, "research/independent_pipeline.py"),
					"--image",
					path.join(directory, "input.png"),
					"--request",
					path.join(directory, "request.json"),
					"--runtime",
					runtimeRoot,
					"--output",
					path.join(directory, "owned.png"),
					"--report",
					path.join(directory, "owned.json"),
				],
			});
			job.controller.signal.throwIfAborted();
			const budgets = await Promise.all([
				stat(path.join(directory, "owned.png")),
				stat(path.join(directory, "owned.json")),
			]);
			if (budgets.some((file) => !file.isFile() || file.size > 16 * 1024 ** 2))
				throw new Error("Independent output budget exceeded");
			const [png, source] = await Promise.all([
				readFile(path.join(directory, "owned.png")),
				readFile(path.join(directory, "owned.json"), "utf8"),
			]);
			if (
				png.length > 16 * 1024 ** 2 ||
				source.length > 16 * 1024 ** 2 ||
				png.length < 33 ||
				png.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
				png.readUInt32BE(16) !== input.width ||
				png.readUInt32BE(20) !== input.height
			)
				throw new Error("Invalid independent PNG budget or dimensions");
			const report = JSON.parse(source) as Record<string, unknown>;
			const decoded = await loadImage(png);
			canvas.getContext("2d").drawImage(decoded, 0, 0);
			const rgba = new Uint8Array(
				canvas.getContext("2d").getImageData(0, 0, input.width, input.height)
					.data
			);
			const inputSha256 = hash({ bytes: input.rgba }),
				outputSha256 = hash({ bytes: rgba });
			const isolation = report.independence as
				| { private_native_images?: unknown }
				| undefined;
			if (
				report.passed !== true ||
				report.nativeInputsUsed !== false ||
				report.nativeProductParityVerified !== false ||
				!Array.isArray(isolation?.private_native_images) ||
				isolation.private_native_images.length !== 0 ||
				report.nativeFallbackUsed !== false ||
				report.nativeGeometryUsed !== false ||
				report.width !== input.width ||
				report.height !== input.height ||
				!isDeepStrictEqual(report.adjustments, validated.adjustments) ||
				report.inputRgbaSha256 !== inputSha256 ||
				report.outputRgbaSha256 !== outputSha256 ||
				report.outputPngSha256 !== hash({ bytes: png })
			)
				throw new Error("Independent pixel identity or isolation failed");
			const stages = z
				.array(
					z.object({
						inputRgbaSha256: z.string(),
						outputRgbaSha256: z.string(),
					})
				)
				.parse(report.stages);
			let previous = inputSha256;
			for (const stage of stages) {
				if (stage.inputRgbaSha256 !== previous)
					throw new Error("Independent stage hash chain mismatch");
				previous = stage.outputRgbaSha256;
			}
			if (previous !== outputSha256)
				throw new Error("Independent final stage hash mismatch");
			if ((await verifySources()) !== manifestSha256)
				throw new Error("Independent source manifest changed during execution");
			report.qcutSourceManifestSha256 = manifestSha256;
			job.controller.signal.throwIfAborted();
			return {
				provider: BEAUTY_LAB_INDEPENDENT_PROVIDER,
				requestId: input.requestId,
				sourceKey: input.sourceKey,
				width: input.width,
				height: input.height,
				rgba,
				png: new Uint8Array(png),
				inputSha256,
				outputSha256,
				report,
			};
		} finally {
			try {
				if (directory) await rm(directory, { recursive: true, force: true });
			} finally {
				if (active === job) active = undefined;
				finish();
			}
		}
	}
	function cancel({ request }: { request: { requestId: string } }) {
		z.object({ requestId: z.string().min(1).max(128) })
			.strict()
			.parse(request);
		if (!active || active.id !== request.requestId) return { cancelled: false };
		active.controller.abort();
		return { cancelled: true };
	}
	async function dispose() {
		disposed = true;
		active?.controller.abort();
		await active?.done;
	}
	return { inspect, render, cancel, dispose };
}

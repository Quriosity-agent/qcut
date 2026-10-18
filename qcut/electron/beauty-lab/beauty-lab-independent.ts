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
	INDEPENDENT_BEAUTY_MAX_EDGE,
	INDEPENDENT_BEAUTY_MAX_PIXELS,
	type BeautyLabIndependentRequest,
	type BeautyLabIndependentResult,
} from "./beauty-lab-independent-contract.js";
import type { runIndependentBeautyJob } from "./beauty-lab-independent-process.js";
import { createIndependentBeautyWorker } from "./beauty-lab-independent-worker.js";
import { verifyIndependentBeautyRuntime } from "./beauty-lab-runtime-payload.js";
import {
	independentBeautyEnvironment,
	verifyIndependentBeautyEnvironment,
} from "./beauty-lab-runtime-environment.js";
import {
	independentSourceEvidenceSchema,
	independentSourceEvidenceIdentity,
	writeIndependentSourceEvidence,
	verifyIndependentSourceEvidenceReceipt,
} from "./beauty-lab-independent-source-evidence.js";
import {
	canonicalIndependentManualBody,
	independentManualBodySchema,
} from "./beauty-lab-independent-manual-body.js";
import {
	independentBodyVideoAvailable,
	IndependentSequenceGapError,
} from "./beauty-lab-independent-body-video.js";

const requestSchema = z
	.object({
		requestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
		sourceKey: z.string().min(1).max(256),
		width: z.number().int().min(1).max(INDEPENDENT_BEAUTY_MAX_EDGE),
		height: z.number().int().min(1).max(INDEPENDENT_BEAUTY_MAX_EDGE),
		rgba: z.instanceof(Uint8Array),
		sourceEvidence: independentSourceEvidenceSchema.optional(),
		// A body-video frame: the worker renders it from the session's history.
		sequence: z
			.object({
				session: z.string().regex(/^[a-f0-9]{64}$/),
				frame: z.number().int().min(0),
				timestamp: z.number().finite().min(0),
				checkpoints: z
					.string()
					.min(1)
					.max(4096)
					.refine((value) => path.isAbsolute(value)),
			})
			.strict()
			.optional(),
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
				manualBody: independentManualBodySchema.optional(),
				manualRetouch: z
					.object({ strokes: z.array(z.never()).max(0) })
					.strict()
					.optional(),
			})
			.strict(),
	})
	.strict()
	.refine(
		({ width, height }) => width * height <= INDEPENDENT_BEAUTY_MAX_PIXELS,
		"Independent frame exceeds the pixel budget"
	);
const hash = ({ bytes }: { bytes: Uint8Array }) =>
	createHash("sha256").update(bytes).digest("hex");
const catalogSchema = z.object({
	controls: z.array(
		z.object({
			name: z.string(),
			min: z.number(),
			max: z.number(),
			/** "body" controls are the editor's body_adjust_* keys; all others face_adjust_*. */
			group: z.string().optional(),
		})
	),
	makeup: z.array(z.object({ id: z.string(), category: z.string() })),
	stages: z
		.array(
			z.object({ kind: z.string(), tools: z.array(z.string()).optional() })
		)
		.optional(),
});

/** The manual body tools the engine's manual-body stage renders. */
function catalogManualBodyTools({
	catalog,
}: {
	catalog: z.infer<typeof catalogSchema>;
}) {
	return (catalog.stages ?? [])
		.filter(({ kind }) => kind === "manual-body")
		.flatMap(({ tools }) => tools ?? []);
}

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
	independentSourceEvidenceIdentity(parsed);
	const values: Record<string, number> = {};
	for (const [key, value] of Object.entries(parsed.adjustments.values)) {
		const body = key.startsWith("body_adjust_");
		const name = body || key.startsWith("face_adjust_") ? key.slice(12) : key;
		const control = catalog.controls.find(
			(entry) => entry.name === name && (entry.group === "body") === body
		);
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
	const manualBody = canonicalIndependentManualBody({
		manualBody: parsed.adjustments.manualBody,
	});
	const tools = catalogManualBodyTools({ catalog });
	for (const tool of Object.keys(manualBody ?? {}))
		if (!tools.includes(tool))
			throw new Error(
				`Independent beauty does not support manual body ${tool}`
			);
	return {
		request: structuredClone(parsed) as BeautyLabIndependentRequest,
		adjustments: { values, makeup, ...(manualBody ? { manualBody } : {}) },
	};
}

export function createBeautyLabIndependentProvider({
	engineRoot,
	runtimeRoot = path.join(engineRoot, "runtime"),
	python = path.join(engineRoot, "research/.venv/bin/python"),
	platform = process.platform,
	environment = process.env,
	runJob,
	verifyRuntime = verifyIndependentBeautyRuntime,
	verifyEnvironment = verifyIndependentBeautyEnvironment,
	createWorker = createIndependentBeautyWorker,
}: {
	engineRoot: string;
	runtimeRoot?: string;
	python?: string;
	platform?: NodeJS.Platform;
	environment?: NodeJS.ProcessEnv;
	runJob?: typeof runIndependentBeautyJob;
	verifyRuntime?: typeof verifyIndependentBeautyRuntime;
	verifyEnvironment?: typeof verifyIndependentBeautyEnvironment;
	createWorker?: typeof createIndependentBeautyWorker;
}) {
	const worker = createWorker({
		python,
		engineRoot,
		runtimeRoot,
	});
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
			const [inventory, bodyVideo] = await Promise.all([
				catalog(),
				independentBodyVideoAvailable({ runtimeRoot }),
			]);
			return {
				available: true,
				provider: BEAUTY_LAB_INDEPENDENT_PROVIDER,
				message:
					"Single opaque photo, max edge 4096 / 8,294,400 pixels; resident rendering, general native parity unverified",
				controls: inventory.controls.map(({ name, group }) =>
					group === "body" ? `body_adjust_${name}` : `face_adjust_${name}`
				),
				makeupCards: inventory.makeup.map(({ id }) => id),
				manualBodyTools: catalogManualBodyTools({ catalog: inventory }),
				bodyVideo,
			};
		} catch (error) {
			return {
				available: false,
				provider: BEAUTY_LAB_INDEPENDENT_PROVIDER,
				message: String(error),
				controls: [],
				makeupCards: [],
				manualBodyTools: [],
				bodyVideo: false,
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
			const sourceEvidence = await writeIndependentSourceEvidence({
				directory,
				sourceEvidence: input.sourceEvidence,
				width: input.width,
				height: input.height,
				rgba: input.rgba,
				signal: job.controller.signal,
			});
			const cleanEnvironment = independentBeautyEnvironment({ environment });
			cleanEnvironment.PATH = [
				path.dirname(await resolveBun()),
				cleanEnvironment.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
			].join(path.delimiter);
			const execution = {
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
			};
			if (Math.max(input.width, input.height) > 1280)
				execution.args.push("--resolution", "original");
			if (sourceEvidence)
				execution.args.push("--source-evidence", sourceEvidence.path);
			if (runJob) {
				if (input.sequence)
					throw new Error("Independent body video needs the resident worker");
				await runJob(execution);
			} else {
				// A session frame runs to completion: the engine's history has
				// advanced once the frame is in flight, and the result is cached.
				const outcome = await worker.run({
					request: {
						image: path.join(directory, "input.png"),
						request: path.join(directory, "request.json"),
						output: path.join(directory, "owned.png"),
						report: path.join(directory, "owned.json"),
						...(sourceEvidence ? { source_evidence: sourceEvidence.path } : {}),
						...(input.sequence ? { sequence: input.sequence } : {}),
					},
					sourceIdentity: manifestSha256,
					environment: cleanEnvironment,
					signal: input.sequence
						? new AbortController().signal
						: job.controller.signal,
					timeoutMs: execution.timeoutMs,
				});
				if (outcome.gap)
					throw new IndependentSequenceGapError({
						restartFrom: outcome.gap.restartFrom,
					});
			}
			if (!input.sequence) job.controller.signal.throwIfAborted();
			const budgets = await Promise.all([
				stat(path.join(directory, "owned.png")),
				stat(path.join(directory, "owned.json")),
			]);
			if (
				budgets.some(
					(file, index) =>
						!file.isFile() || file.size > (index === 0 ? 64 : 16) * 1024 ** 2
				)
			)
				throw new Error("Independent output budget exceeded");
			const [png, source] = await Promise.all([
				readFile(path.join(directory, "owned.png")),
				readFile(path.join(directory, "owned.json"), "utf8"),
			]);
			if (
				png.length > 64 * 1024 ** 2 ||
				source.length > 16 * 1024 ** 2 ||
				png.length < 33 ||
				png.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
				png.readUInt32BE(16) !== input.width ||
				png.readUInt32BE(20) !== input.height
			)
				throw new Error("Invalid independent PNG budget or dimensions");
			const report = JSON.parse(source) as Record<string, unknown>;
			verifyIndependentSourceEvidenceReceipt({
				expected: sourceEvidence,
				receipt: report.sourceEvidence,
			});
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
		await worker.dispose();
	}
	return { inspect, render, cancel, dispose };
}

// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createBeautyLabIndependentProvider,
	independentBeautyAdjustments,
} from "../beauty-lab/beauty-lab-independent";
import { IndependentSequenceGapError } from "../beauty-lab/beauty-lab-independent-body-video";
import type { BeautyLabIndependentRequest } from "../beauty-lab/beauty-lab-independent-contract";
import { runIndependentBeautyJob } from "../beauty-lab/beauty-lab-independent-process";
import type { createIndependentBeautyWorker } from "../beauty-lab/beauty-lab-independent-worker";
import { verifyIndependentBeautyRuntime } from "../beauty-lab/beauty-lab-runtime-payload";
import { verifyIndependentBeautyEnvironment } from "../beauty-lab/beauty-lab-runtime-environment";
import independentCatalog from "../../research/independent-beauty/research/independent-pipeline-catalog.json";

const catalog = {
	controls: [{ name: "Nose", min: -50, max: 100 }],
	makeup: [{ id: "lip-coral-nude", category: "lip" }],
};
const hash = ({ bytes }: { bytes: Uint8Array }) =>
	createHash("sha256").update(bytes).digest("hex");
const request: BeautyLabIndependentRequest = {
	requestId: "one",
	sourceKey: "photo",
	width: 1,
	height: 1,
	rgba: new Uint8Array([10, 20, 30, 255]),
	adjustments: { enabled: true, values: { face_adjust_Nose: 30 } },
};
let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "beauty-lab-owned-test-"));
	await mkdir(path.join(directory, "research"));
	await writeFile(
		path.join(directory, "research/independent-pipeline-catalog.json"),
		JSON.stringify(catalog)
	);
	await writeFile(
		path.join(directory, "source-manifest.json"),
		JSON.stringify({ files: [], generatedFiles: [] })
	);
});
afterEach(async () => {
	// Windows releases a killed worker's cwd handle after the process exits, so
	// let rm retry the transient EBUSY instead of failing the lifetime tests.
	await rm(directory, {
		recursive: true,
		force: true,
		maxRetries: 10,
		retryDelay: 100,
	});
});

/** What the engine leaves for the provider: the owned PNG and its passing report. */
async function writeOwnedResult({
	adjustmentsPath,
	output,
	report,
	evidencePath,
	mutate,
}: {
	adjustmentsPath: string;
	output: string;
	report: string;
	evidencePath?: string;
	mutate?: (report: Record<string, unknown>) => void;
}) {
	const adjustments = JSON.parse(
		await readFile(adjustmentsPath, "utf8")
	) as unknown;
	const rgba = new Uint8Array([11, 20, 30, 255]);
	const canvas = createCanvas(1, 1);
	canvas
		.getContext("2d")
		.putImageData(new ImageData(new Uint8ClampedArray(rgba), 1, 1), 0, 0);
	const png = canvas.toBuffer("image/png");
	const inputHash = hash({ bytes: request.rgba }),
		outputHash = hash({ bytes: rgba });
	const receipt: Record<string, unknown> = {
		passed: true,
		width: 1,
		height: 1,
		adjustments,
		nativeInputsUsed: false,
		nativeGeometryUsed: false,
		nativeFallbackUsed: false,
		nativeProductParityVerified: false,
		independence: { private_native_images: [] },
		inputRgbaSha256: inputHash,
		outputRgbaSha256: outputHash,
		outputPngSha256: hash({ bytes: png }),
		stages: [{ inputRgbaSha256: inputHash, outputRgbaSha256: outputHash }],
	};
	if (evidencePath) {
		const manifest = await readFile(evidencePath);
		const evidence = JSON.parse(manifest.toString()) as {
			policy: string;
			status: string;
		};
		receipt.sourceEvidence = {
			manifestSha256: hash({ bytes: manifest }),
			policy: evidence.policy,
			status: evidence.status,
		};
	}
	mutate?.(receipt);
	await Promise.all([
		writeFile(output, png),
		writeFile(report, JSON.stringify(receipt)),
	]);
}

/** A resident worker that answers from `outcomes`, rendering when an outcome has no gap. */
function fakeWorker({
	outcomes = [],
}: {
	outcomes?: Array<{ gap?: { restartFrom: number } }>;
} = {}) {
	const run = vi.fn(
		async ({
			request: sent,
		}: {
			request: {
				request: string;
				output: string;
				report: string;
				sequence?: unknown;
			};
			signal: AbortSignal;
		}) => {
			const outcome = outcomes.shift() ?? {};
			if (outcome.gap) return outcome;
			await writeOwnedResult({
				adjustmentsPath: sent.request,
				output: sent.output,
				report: sent.report,
			});
			return {};
		}
	);
	return { run, dispose: vi.fn(async () => {}) };
}

function setup({
	mutate,
	run,
	worker,
	sessionsDirectory,
	environment = {
		PATH: process.env.PATH,
		QCUT_INDEPENDENT_BEAUTY_BUN: process.execPath,
		DYLD_LIBRARY_PATH: "private",
		PYTHONPATH: "private",
		PYTHONDONTWRITEBYTECODE: "0",
	},
	verifyRuntime = vi
		.fn<typeof verifyIndependentBeautyRuntime>()
		.mockResolvedValue({
			profile: "fixture",
			verifiedFiles: 1,
			verifiedBytes: 1,
		}),
	verifyEnvironment = vi
		.fn<typeof verifyIndependentBeautyEnvironment>()
		.mockResolvedValue({
			pythonVersion: "3.12",
			packages: {
				onnxruntime: "1.22.1",
				onnx: "1.19.0",
				numpy: "2.5.3",
				pillow: "12.2.0",
				"opencv-python-headless": "4.12.0.88",
			},
			cpuInferenceVerified: true,
			compilerExecutionVerified: true,
			metalShaderVerified: true,
			gpuRenderVerified: false,
		}),
}: {
	mutate?: (report: Record<string, unknown>) => void;
	run?: typeof runIndependentBeautyJob;
	/** Serves renders instead of one-shot jobs, as the editor does. */
	worker?: ReturnType<typeof createIndependentBeautyWorker>;
	sessionsDirectory?: string;
	environment?: NodeJS.ProcessEnv;
	verifyRuntime?: typeof verifyIndependentBeautyRuntime;
	verifyEnvironment?: typeof verifyIndependentBeautyEnvironment;
} = {}) {
	const runJob = vi.fn<typeof runIndependentBeautyJob>(
		run ??
			(async ({ args, environment }) => {
				expect(environment).not.toHaveProperty("DYLD_LIBRARY_PATH");
				expect(environment).not.toHaveProperty("PYTHONPATH");
				expect(environment.PYTHONDONTWRITEBYTECODE).toBe("1");
				const file = ({ flag }: { flag: string }) =>
					args[args.indexOf(flag) + 1];
				await writeOwnedResult({
					adjustmentsPath: file({ flag: "--request" }),
					output: file({ flag: "--output" }),
					report: file({ flag: "--report" }),
					evidencePath: args.includes("--source-evidence")
						? file({ flag: "--source-evidence" })
						: undefined,
					mutate,
				});
			})
	);
	const provider = createBeautyLabIndependentProvider({
		engineRoot: directory,
		runtimeRoot: directory,
		python: process.execPath,
		platform: "darwin",
		environment,
		...(worker
			? {
					createWorker: () =>
						worker as ReturnType<typeof createIndependentBeautyWorker>,
				}
			: { runJob }),
		...(sessionsDirectory ? { sessionsDirectory } : {}),
		verifyRuntime,
		verifyEnvironment,
	});
	return { provider, runJob, verifyEnvironment, verifyRuntime, environment };
}

describe("independent body video frames", () => {
	const sessions = path.join(os.tmpdir(), "sessions");
	const sequence = {
		session: "5".repeat(64),
		frame: 2,
		timestamp: 2 / 24,
		checkpoints: path.join(sessions, "5".repeat(64)),
	};
	it("renders a session frame through the resident worker and reports the capability", async () => {
		const worker = fakeWorker();
		const { provider } = setup({ worker, sessionsDirectory: sessions });
		const result = await provider.render({
			request: { ...request, sequence },
		});
		expect([...result.rgba]).toEqual([11, 20, 30, 255]);
		expect(worker.run).toHaveBeenCalledTimes(1);
		const sent = worker.run.mock.calls[0][0];
		expect(sent.request.sequence).toEqual(sequence);
		expect(sent.signal.aborted).toBe(false);
		expect(await provider.inspect()).toMatchObject({
			available: true,
			bodyVideo: false,
		});
	});
	it("surfaces a worker history gap as a typed error without a result", async () => {
		const worker = fakeWorker({ outcomes: [{ gap: { restartFrom: 1 } }] });
		const { provider } = setup({ worker, sessionsDirectory: sessions });
		const failure = await provider
			.render({ request: { ...request, sequence } })
			.catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(IndependentSequenceGapError);
		expect((failure as IndependentSequenceGapError).restartFrom).toBe(1);
		await expect(
			provider.render({ request: { ...request, requestId: "two", sequence } })
		).resolves.toMatchObject({ requestId: "two" });
	});
	it("needs the resident worker and a checkpoint folder inside the sessions folder", async () => {
		const { provider, runJob } = setup({ sessionsDirectory: sessions });
		await expect(
			provider.render({ request: { ...request, sequence } })
		).rejects.toThrow("resident worker");
		expect(runJob).not.toHaveBeenCalled();
		const worker = fakeWorker();
		const { provider: resident } = setup({
			worker,
			sessionsDirectory: sessions,
		});
		for (const checkpoints of [
			"sessions",
			sessions,
			path.join(sessions, "..", "elsewhere"),
			path.join(os.tmpdir(), "sessions-other", "5".repeat(64)),
			"/",
		])
			await expect(
				resident.render({
					request: { ...request, sequence: { ...sequence, checkpoints } },
				})
			).rejects.toThrow();
		const { provider: unconfigured } = setup({ worker });
		await expect(
			unconfigured.render({ request: { ...request, sequence } })
		).rejects.toThrow("sessions folder");
		expect(worker.run).not.toHaveBeenCalled();
	});
});

describe("independent photo provider", () => {
	it("binds a source sidecar to the worker result and removes its private files", async () => {
		const { provider, runJob } = setup();
		const sourceEvidence = {
			policy: "single-face-bidirectional-v1" as const,
			status: "available" as const,
			targetTimestampSeconds: 1,
			frames: [0.92, 0.96, 1.04, 1.08].map((timestampSeconds) => ({
				timestampSeconds,
				rgba: request.rgba,
			})),
		};
		const result = await provider.render({
			request: { ...request, sourceEvidence },
		});
		expect(result.report.sourceEvidence).toMatchObject({
			policy: sourceEvidence.policy,
			status: "available",
		});
		const args = runJob.mock.calls[0][0].args;
		const sidecar = args[args.indexOf("--source-evidence") + 1];
		expect(path.basename(sidecar)).toBe("source-evidence.json");
		await expect(readFile(sidecar)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(
			readFile(path.join(path.dirname(sidecar), "source-evidence-0.rgba"))
		).rejects.toMatchObject({ code: "ENOENT" });
	});
	it("rejects a result bound to another source sidecar", async () => {
		const { provider } = setup({
			mutate: (report) => {
				report.sourceEvidence = {
					manifestSha256: "wrong",
					policy: "single-face-bidirectional-v1",
					status: "unavailable",
				};
			},
		});
		await expect(
			provider.render({
				request: {
					...request,
					sourceEvidence: {
						policy: "single-face-bidirectional-v1",
						status: "unavailable",
						reason: "insufficient-neighbors",
					},
				},
			})
		).rejects.toThrow(/receipt mismatch/);
	});
	it("accepts full HD pixels without reducing the frame dimensions", () => {
		const rgba = new Uint8Array(1080 * 1920 * 4).fill(255);
		const validated = independentBeautyAdjustments({
			request: { ...request, width: 1080, height: 1920, rgba },
			catalog,
		});
		expect(validated.request.width).toBe(1080);
		expect(validated.request.height).toBe(1920);
		expect(validated.request.rgba.byteLength).toBe(rgba.byteLength);
	});
	it.each([
		{ width: 4097, height: 1 },
		{ width: 4096, height: 2160 },
	])("rejects oversized frames before environment checks: %j", async (dimensions) => {
		const { provider, verifyEnvironment, runJob } = setup();
		await expect(
			provider.render({ request: { ...request, ...dimensions } })
		).rejects.toThrow();
		expect(verifyEnvironment).not.toHaveBeenCalled();
		expect(runJob).not.toHaveBeenCalled();
	});
	it("reuses successful probes across availability and rendering while checking payload each time", async () => {
		const { provider, verifyEnvironment, verifyRuntime } = setup();
		expect((await provider.inspect()).available).toBe(true);
		expect((await provider.inspect()).available).toBe(true);
		await provider.render({ request });
		expect(verifyEnvironment).toHaveBeenCalledTimes(1);
		expect(verifyRuntime).toHaveBeenCalledTimes(3);
	});
	it("blocks changed payload and sources even after successful environment probes", async () => {
		const { provider, verifyEnvironment, verifyRuntime, runJob } = setup();
		expect((await provider.inspect()).available).toBe(true);
		vi.mocked(verifyRuntime).mockRejectedValueOnce(
			new Error("changed payload")
		);
		await expect(provider.render({ request })).rejects.toThrow(
			"changed payload"
		);
		await writeFile(
			path.join(directory, "source-manifest.json"),
			JSON.stringify({
				files: [{ path: "missing.py", sha256: "a".repeat(64) }],
				generatedFiles: [],
			})
		);
		expect((await provider.inspect()).available).toBe(false);
		expect(verifyEnvironment).toHaveBeenCalledTimes(1);
		expect(runJob).not.toHaveBeenCalled();
	});
	it("invalidates successful probes when the resolved Bun changes", async () => {
		const { provider, verifyEnvironment, environment } = setup();
		await provider.inspect();
		const nextBun = path.join(directory, "next-bun");
		await writeFile(nextBun, "fixture", { mode: 0o755 });
		environment.QCUT_INDEPENDENT_BEAUTY_BUN = nextBun;
		expect((await provider.inspect()).available).toBe(true);
		expect(verifyEnvironment).toHaveBeenCalledTimes(2);
		expect(verifyEnvironment).toHaveBeenLastCalledWith(
			expect.objectContaining({ bun: nextBun })
		);
	});
	it("invalidates successful probes when source manifest identity changes", async () => {
		const { provider, verifyEnvironment } = setup();
		await provider.inspect();
		await writeFile(
			path.join(directory, "source-manifest.json"),
			JSON.stringify({ files: [], generatedFiles: [] }, null, 2)
		);
		expect((await provider.inspect()).available).toBe(true);
		expect(verifyEnvironment).toHaveBeenCalledTimes(2);
	});
	it.each([
		{ key: "DEVELOPER_DIR" },
		{ key: "SDKROOT" },
	])("invalidates probes when $key changes", async ({ key }) => {
		const { provider, verifyEnvironment, environment } = setup();
		await provider.inspect();
		environment[key] = "/changed-toolchain";
		expect((await provider.inspect()).available).toBe(true);
		expect(verifyEnvironment).toHaveBeenCalledTimes(2);
	});
	it("retries failed probes instead of caching unavailable status", async () => {
		const { provider, verifyEnvironment } = setup();
		vi.mocked(verifyEnvironment).mockRejectedValueOnce(
			new Error("dependency missing")
		);
		expect((await provider.inspect()).available).toBe(false);
		expect((await provider.inspect()).available).toBe(true);
		await provider.inspect();
		expect(verifyEnvironment).toHaveBeenCalledTimes(2);
	});
	it("keeps probe caches local to each provider", async () => {
		const first = setup(),
			second = setup();
		await first.provider.inspect();
		await second.provider.inspect();
		expect(first.verifyEnvironment).toHaveBeenCalledTimes(1);
		expect(second.verifyEnvironment).toHaveBeenCalledTimes(1);
	});
	it("cancels the environment probe before dispatching an image job", async () => {
		let probing: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			probing = resolve;
		});
		const verifyEnvironment = vi
			.fn<typeof verifyIndependentBeautyEnvironment>()
			.mockImplementation(
				({ signal }) =>
					new Promise((_, reject) => {
						probing();
						const cancel = () => reject(new Error("environment cancelled"));
						if (signal?.aborted) cancel();
						else signal?.addEventListener("abort", cancel, { once: true });
					})
			);
		const { provider, runJob } = setup({ verifyEnvironment });
		const pending = provider.render({ request });
		const rejected = expect(pending).rejects.toThrow("environment cancelled");
		await started;
		await provider.cancel({ request: { requestId: request.requestId } });
		await rejected;
		expect(runJob).not.toHaveBeenCalled();
	});
	it("blocks rendering when Python imports or Metal capability checks fail", async () => {
		const verifyEnvironment = vi
			.fn<typeof verifyIndependentBeautyEnvironment>()
			.mockRejectedValue(new Error("numpy version mismatch"));
		const { provider, runJob } = setup({ verifyEnvironment });
		expect(await provider.inspect()).toMatchObject({
			available: false,
			message: expect.stringContaining("numpy version mismatch"),
		});
		await expect(provider.render({ request })).rejects.toThrow(
			"numpy version mismatch"
		);
		expect(runJob).not.toHaveBeenCalled();
	});
	it("reports missing payload and blocks dispatch before rendering", async () => {
		const verifyRuntime = vi
			.fn<typeof verifyIndependentBeautyRuntime>()
			.mockRejectedValue(new Error("Missing Cache whitening LUT"));
		const { provider, runJob } = setup({ verifyRuntime });
		expect(await provider.inspect()).toMatchObject({
			available: false,
			message: expect.stringContaining("Missing Cache"),
		});
		await expect(provider.render({ request })).rejects.toThrow("Missing Cache");
		expect(runJob).not.toHaveBeenCalled();
	});
	it("reserves the job before asynchronous validation so immediate cancellation works", async () => {
		const { provider, runJob } = setup();
		const job = provider.render({ request });
		expect(
			provider.cancel({ request: { requestId: request.requestId } })
		).toEqual({ cancelled: true });
		await expect(job).rejects.toThrow();
		expect(runJob).not.toHaveBeenCalled();
		await provider.dispose();
	});
	it("rejects concurrent submissions made before source inspection settles", async () => {
		const { provider, runJob } = setup();
		const outcomes = await Promise.allSettled([
			provider.render({ request }),
			provider.render({ request: { ...request, requestId: "two" } }),
		]);
		expect(outcomes[0].status).toBe("fulfilled");
		expect(outcomes[1]).toMatchObject({
			status: "rejected",
			reason: expect.objectContaining({
				message: "Independent engine busy or disposed",
			}),
		});
		expect(runJob).toHaveBeenCalledOnce();
		await provider.dispose();
	});
	it("maps native control keys and ignores inactive unsupported keys", () => {
		const value = independentBeautyAdjustments({
			request: {
				...request,
				adjustments: {
					enabled: true,
					values: { face_adjust_Nose: -50, unused: 0 },
				},
			},
			catalog,
		});
		expect(value.adjustments).toEqual({ values: { Nose: -50 }, makeup: {} });
	});
	it("names body controls with the editor's body prefix and maps them back", async () => {
		const withBody = {
			...catalog,
			controls: [
				...catalog.controls,
				{ name: "StretchLeg", min: 0, max: 100, group: "body" },
			],
		};
		await writeFile(
			path.join(directory, "research/independent-pipeline-catalog.json"),
			JSON.stringify(withBody)
		);
		const { provider } = setup();
		expect((await provider.inspect()).controls).toEqual([
			"face_adjust_Nose",
			"body_adjust_StretchLeg",
		]);
		const adjusted = independentBeautyAdjustments({
			request: {
				...request,
				adjustments: {
					enabled: true,
					values: { body_adjust_StretchLeg: 60, face_adjust_Nose: 10 },
				},
			},
			catalog: withBody,
		});
		expect(adjusted.adjustments.values).toEqual({ StretchLeg: 60, Nose: 10 });
		// A prefix only reaches controls of its own group.
		for (const values of [
			{ face_adjust_StretchLeg: 60 },
			{ body_adjust_Nose: 10 },
			{ body_adjust_SlimWaist: 10 },
		])
			expect(() =>
				independentBeautyAdjustments({
					request: { ...request, adjustments: { enabled: true, values } },
					catalog: withBody,
				})
			).toThrow(/does not support/);
	});
	it("advertises all smart body controls and preserves signed values through rendering", async () => {
		await writeFile(
			path.join(directory, "research/independent-pipeline-catalog.json"),
			JSON.stringify(independentCatalog)
		);
		const { provider, runJob } = setup();
		try {
			const status = await provider.inspect();
			const controls = independentCatalog.controls.filter(
				({ group }) => group === "body"
			);
			expect(controls).toHaveLength(10);
			expect(
				status.controls.filter((key) => key.startsWith("body_adjust_"))
			).toEqual(controls.map(({ name }) => `body_adjust_${name}`));
			const values = Object.fromEntries(
				controls.map(({ name, min, max }) => [
					`body_adjust_${name}`,
					min < 0 ? min : max,
				])
			);
			const result = await provider.render({
				request: { ...request, adjustments: { enabled: true, values } },
			});
			expect(result.report.adjustments).toEqual({
				values: Object.fromEntries(
					controls.map(({ name, min, max }) => [name, min < 0 ? min : max])
				),
				makeup: {},
			});
			expect(runJob).toHaveBeenCalledOnce();
		} finally {
			await provider.dispose();
		}
	});
	it.each([
		{ key: "body_adjust_WidenShoulderTest", value: -50.01 },
		{ key: "body_adjust_SlimBreast", value: 50.01 },
		{ key: "body_adjust_SlimHip", value: -50.01 },
		{ key: "body_adjust_SlimWaist", value: -1 },
		{ key: "face_adjust_SmallHead", value: 20 },
	])("rejects smart body edits outside the catalog contract: $key", ({
		key,
		value,
	}) => {
		expect(() =>
			independentBeautyAdjustments({
				request: {
					...request,
					adjustments: { enabled: true, values: { [key]: value } },
				},
				catalog: independentCatalog,
			})
		).toThrow();
	});
	it("keeps an active stretch band for an engine whose catalog renders it", () => {
		const stretch = { intensity: -30, upper: 0.72, bottom: 0.18 };
		const withStage = {
			...catalog,
			stages: [{ kind: "manual-body", tools: ["stretch"] }],
		};
		const value = independentBeautyAdjustments({
			request: {
				...request,
				adjustments: { enabled: true, values: {}, manualBody: { stretch } },
			},
			catalog: withStage,
		});
		expect(value.adjustments).toEqual({
			values: {},
			makeup: {},
			manualBody: { stretch },
		});
		// An idle band is not part of the canonical adjustments.
		expect(
			independentBeautyAdjustments({
				request: {
					...request,
					adjustments: {
						enabled: true,
						values: {},
						manualBody: { stretch: { ...stretch, intensity: 0 } },
					},
				},
				catalog: withStage,
			}).adjustments
		).toEqual({ values: {}, makeup: {} });
		// An engine without the stage refuses it rather than ignoring it.
		expect(() =>
			independentBeautyAdjustments({
				request: {
					...request,
					adjustments: { enabled: true, values: {}, manualBody: { stretch } },
				},
				catalog,
			})
		).toThrow(/manual body stretch/);
	});
	it("keeps active slim and zoom for an engine whose catalog renders them", () => {
		const slim = {
			intensity: 25,
			x: 0.5,
			y: 0.42,
			width: 0.3,
			height: 0.35,
			rotation: -0,
		};
		const zoom = { intensity: -15, x: 0.48, y: 0.64, radius: 0.12 };
		const value = independentBeautyAdjustments({
			request: {
				...request,
				adjustments: {
					enabled: true,
					values: {},
					manualBody: {
						stretch: { intensity: 0, upper: 0.6, bottom: 0.4 },
						slim,
						zoom,
					},
				},
			},
			catalog: {
				...catalog,
				stages: [{ kind: "manual-body", tools: ["stretch", "slim", "zoom"] }],
			},
		});
		// The idle stretch is dropped and −0 is written as 0, as the engine's plan keeps them.
		expect(value.adjustments.manualBody).toEqual({
			slim: { ...slim, rotation: 0 },
			zoom,
		});
		expect(Object.is(value.adjustments.manualBody?.slim?.rotation, -0)).toBe(
			false
		);
		// An engine that renders only the stretch refuses them.
		expect(() =>
			independentBeautyAdjustments({
				request: {
					...request,
					adjustments: { enabled: true, values: {}, manualBody: { zoom } },
				},
				catalog: {
					...catalog,
					stages: [{ kind: "manual-body", tools: ["stretch"] }],
				},
			})
		).toThrow(/manual body zoom/);
	});
	const slim = {
		intensity: 10,
		x: 0.5,
		y: 0.5,
		width: 0.2,
		height: 0.2,
		rotation: 0,
	};
	const zoom = { intensity: 10, x: 0.5, y: 0.5, radius: 0.2 };
	it.each([
		{ stretch: { intensity: 51, upper: 0.7, bottom: 0.2 } },
		{ stretch: { intensity: 10, upper: 0.21, bottom: 0.2 } },
		{ stretch: { intensity: 10, upper: 0.7 } },
		{ slim: { ...slim, rotation: 181 } },
		{ slim: { ...slim, width: 0.01 } },
		{ slim: { ...slim, x: 1.1 } },
		{ zoom: { ...zoom, radius: 0.6 } },
		{ zoom: { ...zoom, intensity: -51 } },
		{ zoom: { ...zoom, rotation: 0 } },
		{ twist: zoom },
	])("rejects manual body settings it cannot render: %j", (manualBody) => {
		expect(() =>
			independentBeautyAdjustments({
				request: {
					...request,
					adjustments: { enabled: true, values: {}, manualBody },
				} as unknown as BeautyLabIndependentRequest,
				catalog: {
					...catalog,
					stages: [{ kind: "manual-body", tools: ["stretch", "slim", "zoom"] }],
				},
			})
		).toThrow();
	});
	it.each([
		{ enabled: true, values: { unknown: 1 } },
		{ enabled: true, values: { Nose: 101 } },
		{ enabled: true, values: { Nose: 30, face_adjust_Nose: 30 } },
		{ enabled: false, values: {} },
		{ enabled: true, values: {}, faceTarget: { mode: "single", faceId: 1 } },
		{
			enabled: true,
			values: {},
			makeup: { eyes: { cardId: "lip-coral-nude", intensity: 20 } },
		},
	])("rejects unsupported selections before launching a process: %j", async (adjustments) => {
		const { provider, runJob } = setup();
		await expect(
			provider.render({ request: { ...request, adjustments } })
		).rejects.toThrow();
		expect(runJob).not.toHaveBeenCalled();
	});
	it.each([
		new Uint8Array([10, 20, 30, 0]),
		new Uint8Array(3),
	])("rejects transparent or malformed RGBA", async (rgba) => {
		const { provider, runJob } = setup();
		await expect(
			provider.render({ request: { ...request, rgba } })
		).rejects.toThrow(/input|opaque/);
		expect(runJob).not.toHaveBeenCalled();
	});
	it("returns real decoded PNG pixels with exact input and output identities", async () => {
		const { provider } = setup();
		const result = await provider.render({ request });
		expect(result).toMatchObject({
			requestId: "one",
			sourceKey: "photo",
			provider: "qcut-independent-photo-v1",
			width: 1,
			height: 1,
		});
		expect(result.rgba).toEqual(new Uint8Array([11, 20, 30, 255]));
		expect(result.outputSha256).toBe(hash({ bytes: result.rgba }));
		await provider.dispose();
	});
	it.each([
		{ nativeInputsUsed: true },
		{ nativeFallbackUsed: true },
		{ nativeGeometryUsed: true },
		{ nativeProductParityVerified: true },
		{ independence: { private_native_images: ["libAGFX.dylib"] } },
		{ inputRgbaSha256: "wrong" },
		{ outputPngSha256: "wrong" },
		{ width: 2 },
		{ adjustments: { values: {}, makeup: {} } },
		{ stages: [{ inputRgbaSha256: "wrong", outputRgbaSha256: "wrong" }] },
	])("rejects false provenance and broken stage chains: %j", async (patch) => {
		const { provider } = setup({
			mutate: (report) => Object.assign(report, patch),
		});
		await expect(provider.render({ request })).rejects.toThrow(
			/identity|isolation|hash/
		);
	});
	it("verifies imported and generated sources before dispatch", async () => {
		await writeFile(
			path.join(directory, "source-manifest.json"),
			JSON.stringify({
				files: [],
				generatedFiles: [{ path: "runtime.ts", sha256: "0".repeat(64) }],
			})
		);
		await writeFile(path.join(directory, "runtime.ts"), "changed");
		const { provider, runJob } = setup();
		expect(await provider.inspect()).toMatchObject({
			available: false,
			message: expect.stringContaining("source changed"),
		});
		await expect(provider.render({ request })).rejects.toThrow(
			"source changed"
		);
		expect(runJob).not.toHaveBeenCalled();
	});
	it("blocks concurrent work and cancels only the current request, then permits retry", async () => {
		let evidencePath = "";
		let entered = () => {};
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const { provider, runJob } = setup({
			run: async ({ signal, args }) => {
				evidencePath = args[args.indexOf("--source-evidence") + 1];
				await readFile(evidencePath);
				entered();
				await new Promise<void>((_resolve, reject) =>
					signal.addEventListener(
						"abort",
						() => reject(new Error("cancelled")),
						{ once: true }
					)
				);
			},
		});
		const job = provider.render({
			request: {
				...request,
				sourceEvidence: {
					policy: "single-face-bidirectional-v1",
					status: "available",
					targetTimestampSeconds: 1,
					frames: [0.92, 0.96, 1.04, 1.08].map((timestampSeconds) => ({
						timestampSeconds,
						rgba: request.rgba,
					})),
				},
			},
		});
		const outcome = expect(job).rejects.toThrow("cancelled");
		await started;
		await expect(provider.render({ request })).rejects.toThrow("busy");
		expect(provider.cancel({ request: { requestId: "other" } })).toEqual({
			cancelled: false,
		});
		expect(provider.cancel({ request: { requestId: "one" } })).toEqual({
			cancelled: true,
		});
		await outcome;
		await expect(readFile(evidencePath)).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(
			readFile(path.join(path.dirname(evidencePath), "source-evidence-0.rgba"))
		).rejects.toMatchObject({ code: "ENOENT" });
		expect(await provider.inspect()).toMatchObject({ available: true });
		expect(runJob).toHaveBeenCalledOnce();
		await provider.dispose();
		await expect(provider.render({ request })).rejects.toThrow("disposed");
	});
});

describe("independent process lifetime", () => {
	it("kills nested child processes when cancelling a live worker", async () => {
		const pidFile = path.join(directory, "child.pid");
		const controller = new AbortController();
		const script =
			"import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); writeFileSync(process.argv[1],String(child.pid)); setInterval(()=>{},1000);";
		const job = runIndependentBeautyJob({
			python: process.execPath,
			cwd: directory,
			environment: process.env,
			signal: controller.signal,
			timeoutMs: 5000,
			args: ["--input-type=module", "-e", script, pidFile],
		});
		const outcome = expect(job).rejects.toThrow("cancelled");
		const pid = await vi.waitFor(async () =>
			Number(await readFile(pidFile, "utf8"))
		);
		expect(pid).toBeGreaterThan(0);
		controller.abort();
		await outcome;
		await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
	});
	const options = () => ({
		python: process.execPath,
		cwd: directory,
		environment: process.env,
		signal: new AbortController().signal,
		timeoutMs: 2000,
	});
	it("propagates worker failure with bounded diagnostics", async () => {
		await expect(
			runIndependentBeautyJob({
				...options(),
				args: ["-e", "process.stderr.write('worker error');process.exit(2)"],
			})
		).rejects.toThrow("worker error");
	});
	it("terminates a hanging process on timeout", async () => {
		await expect(
			runIndependentBeautyJob({
				...options(),
				timeoutMs: 50,
				args: ["-e", "setInterval(()=>{},1000)"],
			})
		).rejects.toThrow("timed out");
	});
	it("rejects an already cancelled job without spawning", async () => {
		const controller = new AbortController();
		controller.abort();
		expect(() =>
			runIndependentBeautyJob({
				...options(),
				signal: controller.signal,
				args: [],
			})
		).toThrow();
	});
});

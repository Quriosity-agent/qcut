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
import type { BeautyLabIndependentRequest } from "../beauty-lab/beauty-lab-independent-contract";
import { runIndependentBeautyJob } from "../beauty-lab/beauty-lab-independent-process";
import { verifyIndependentBeautyRuntime } from "../beauty-lab-runtime-payload";
import { verifyIndependentBeautyEnvironment } from "../beauty-lab-runtime-environment";

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

function setup({
	mutate,
	run,
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
				const adjustments = JSON.parse(
					await readFile(file({ flag: "--request" }), "utf8")
				) as unknown;
				const rgba = new Uint8Array([11, 20, 30, 255]);
				const canvas = createCanvas(1, 1);
				canvas
					.getContext("2d")
					.putImageData(new ImageData(new Uint8ClampedArray(rgba), 1, 1), 0, 0);
				const png = canvas.toBuffer("image/png");
				const inputHash = hash({ bytes: request.rgba }),
					outputHash = hash({ bytes: rgba });
				const report: Record<string, unknown> = {
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
					stages: [
						{ inputRgbaSha256: inputHash, outputRgbaSha256: outputHash },
					],
				};
				mutate?.(report);
				await Promise.all([
					writeFile(file({ flag: "--output" }), png),
					writeFile(file({ flag: "--report" }), JSON.stringify(report)),
				]);
			})
	);
	const provider = createBeautyLabIndependentProvider({
		engineRoot: directory,
		runtimeRoot: directory,
		python: process.execPath,
		platform: "darwin",
		environment,
		runJob,
		verifyRuntime,
		verifyEnvironment,
	});
	return { provider, runJob, verifyEnvironment, verifyRuntime, environment };
}

describe("independent photo provider", () => {
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
		let entered = () => {};
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const { provider, runJob } = setup({
			run: async ({ signal }) => {
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
		const job = provider.render({ request });
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

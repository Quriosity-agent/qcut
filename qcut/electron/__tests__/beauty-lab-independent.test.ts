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
} from "../beauty-lab-independent";
import type { BeautyLabIndependentRequest } from "../beauty-lab-independent-contract";
import { runIndependentBeautyJob } from "../beauty-lab-independent-process";

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
	await rm(directory, { recursive: true, force: true });
});

function setup({
	mutate,
	run,
}: {
	mutate?: (report: Record<string, unknown>) => void;
	run?: typeof runIndependentBeautyJob;
} = {}) {
	const runJob = vi.fn<typeof runIndependentBeautyJob>(
		run ??
			(async ({ args, environment }) => {
				expect(environment).not.toHaveProperty("DYLD_LIBRARY_PATH");
				expect(environment).not.toHaveProperty("PYTHONPATH");
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
		environment: {
			PATH: process.env.PATH,
			DYLD_LIBRARY_PATH: "private",
			PYTHONPATH: "private",
		},
		runJob,
	});
	return { provider, runJob };
}

describe("independent photo provider", () => {
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

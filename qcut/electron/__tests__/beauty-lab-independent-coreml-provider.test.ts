// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBeautyLabIndependentProvider } from "../beauty-lab/beauty-lab-independent";
import type { inspectIndependentCoreML } from "../beauty-lab/beauty-lab-independent-coreml";
import type { createIndependentCoreMLInspector } from "../beauty-lab/beauty-lab-independent-coreml-inspector";
import type { createIndependentBeautyWorker } from "../beauty-lab/beauty-lab-independent-worker";

const { inspectResidentCoreML } = vi.hoisted(() => ({
	inspectResidentCoreML:
		vi.fn<ReturnType<typeof createIndependentCoreMLInspector>["inspect"]>(),
}));
vi.mock("node:fs/promises", async (original) => {
	const fs = await original<typeof import("node:fs/promises")>();
	return { ...fs, readFile: vi.fn(fs.readFile) };
});
vi.mock("../beauty-lab/beauty-lab-independent-coreml-inspector", () => ({
	createIndependentCoreMLInspector: () => ({
		inspect: inspectResidentCoreML,
		dispose: vi.fn(async () => {}),
	}),
}));
vi.mock(
	"../beauty-lab/beauty-lab-independent-body-video",
	async (original) => ({
		...(await original<
			typeof import("../beauty-lab/beauty-lab-independent-body-video")
		>()),
		independentBodyVideoAvailable: async () => true,
	})
);
let directory: string;
beforeEach(async () => {
	vi.mocked(readFile).mockClear();
	inspectResidentCoreML
		.mockReset()
		.mockImplementation(async () => structuredClone(capability));
	directory = await mkdtemp(path.join(os.tmpdir(), "coreml-provider-"));
	await mkdir(path.join(directory, "research"));
	await writeFile(
		path.join(directory, "source-manifest.json"),
		JSON.stringify({ files: [], generatedFiles: [] })
	);
	await writeFile(
		path.join(directory, "research/independent-pipeline-catalog.json"),
		JSON.stringify({
			controls: [{ name: "SlimBody", group: "body", min: 0, max: 100 }],
			makeup: [],
		})
	);
});
afterEach(async () => {
	await rm(directory, { force: true, recursive: true });
});
const execution = {
	profile: "swing-coreml-v1" as const,
	sources: "validated",
	networks: { cpu: "pinned", coreml: "pinned" },
};
const capability = {
	available: true as const,
	message: "ready",
	identitySha256: "e".repeat(64),
	identity: {
		execution,
		helper: { sourceSha256: "a".repeat(64), binarySha256: "b".repeat(64) },
		python: "3.12",
		hardwareModel: "Mac",
	},
};
const generation = "d".repeat(64);
function input() {
	return {
		requestId: "profiled",
		sourceKey: "timeline-frame",
		width: 1,
		height: 1,
		rgba: new Uint8Array([1, 2, 3, 255]),
		adjustments: {
			enabled: true,
			values: { body_adjust_SlimBody: 25 },
			bodyVideoProfile: "swing-coreml-v1",
		},
		sequence: {
			session: generation,
			frame: 0,
			timestamp: 0,
			checkpoints: path.join(directory, "sessions", generation),
			executionProfile: "swing-coreml-v1",
			executionGeneration: generation,
			executionIdentitySha256: capability.identitySha256,
		},
	};
}
function setup({
	mutate = (_report: Record<string, unknown>) => {},
	resident = false,
} = {}) {
	const inspectCoreML = vi.fn<typeof inspectIndependentCoreML>(async () =>
		structuredClone(capability)
	);
	const run = vi.fn<ReturnType<typeof createIndependentBeautyWorker>["run"]>(
		async ({ request, environment, signal }) => {
			signal.throwIfAborted();
			expect(environment.QCUT_BODY_COREML_MODEL_ROOT).toBe("/external/models");
			expect(environment.QCUT_BODY_SKELETON_BACKEND).toBe("onnx-exact");
			const canvas = createCanvas(1, 1),
				rgba = input().rgba;
			canvas
				.getContext("2d")
				.putImageData(new ImageData(new Uint8ClampedArray(rgba), 1, 1), 0, 0);
			const png = canvas.toBuffer("image/png");
			const sha = (bytes: Uint8Array) =>
				createHash("sha256").update(bytes).digest("hex");
			const report: Record<string, unknown> = {
				passed: true,
				width: 1,
				height: 1,
				adjustments: JSON.parse(await readFile(request.request, "utf8")),
				nativeInputsUsed: false,
				nativeGeometryUsed: false,
				nativeFallbackUsed: false,
				nativeProductParityVerified: false,
				independence: { private_native_images: [] },
				inputRgbaSha256: sha(rgba),
				outputRgbaSha256: sha(rgba),
				outputPngSha256: sha(png),
				stages: [
					{
						script: "body_smart_render.py",
						inputRgbaSha256: sha(rgba),
						outputRgbaSha256: sha(rgba),
						receipt: {
							executionIdentity: { ...execution, generation },
							executionRoutes: [
								{ network: "coarse", backend: "cpu" },
								{ network: "refine", backend: "coreml" },
							],
						},
					},
				],
			};
			mutate(report);
			await Promise.all([
				writeFile(request.output, png),
				writeFile(request.report, JSON.stringify(report)),
			]);
			return {};
		}
	);
	const provider = createBeautyLabIndependentProvider({
		engineRoot: directory,
		runtimeRoot: directory,
		sessionsDirectory: path.join(directory, "sessions"),
		python: process.execPath,
		platform: "darwin",
		...(resident ? {} : { inspectCoreML }),
		environment: {
			PATH: process.env.PATH,
			QCUT_INDEPENDENT_BEAUTY_BUN: process.execPath,
			QCUT_BODY_COREML_MODEL_ROOT: "/external/models",
			QCUT_BODY_SKELETON_BACKEND: "onnx-exact",
		},
		verifyRuntime: async () => ({
			profile: "fixture",
			verifiedFiles: 1,
			verifiedBytes: 1,
		}),
		verifyEnvironment: vi.fn(),
		createWorker: () => ({ run, dispose: vi.fn(async () => {}) }),
	});
	return { provider, inspectCoreML, run };
}

async function pinSource() {
	const file = "research/pinned.py";
	const source = "original";
	const manifest = JSON.stringify({
		files: [
			{
				path: file,
				sha256: createHash("sha256").update(source).digest("hex"),
			},
		],
		generatedFiles: [],
	});
	const sourceFile = path.join(directory, file);
	await Promise.all([
		writeFile(sourceFile, source),
		writeFile(path.join(directory, "source-manifest.json"), manifest),
	]);
	return {
		sourceFile,
		manifestSha256: createHash("sha256").update(manifest).digest("hex"),
	};
}

describe("CoreML provider binding", () => {
	it("verifies source bytes once per status inspection without reusing them across calls", async () => {
		const { sourceFile, manifestSha256 } = await pinSource();
		const test = setup({ resident: true });
		await expect(test.provider.inspect()).resolves.toMatchObject({
			available: true,
		});
		expect(
			vi.mocked(readFile).mock.calls.filter(([file]) => file === sourceFile)
		).toHaveLength(1);
		expect(inspectResidentCoreML).toHaveBeenLastCalledWith(
			expect.objectContaining({ sourceIdentity: manifestSha256 })
		);
		await expect(test.provider.inspect()).resolves.toMatchObject({
			available: true,
		});
		expect(
			vi.mocked(readFile).mock.calls.filter(([file]) => file === sourceFile)
		).toHaveLength(2);
		await writeFile(sourceFile, "modified");
		await expect(test.provider.inspect()).resolves.toMatchObject({
			available: false,
			message: expect.stringContaining("Independent source changed"),
		});
		expect(inspectResidentCoreML).toHaveBeenCalledTimes(2);
		await test.provider.dispose();
	});
	it("verifies fresh source bytes for standalone profile inspection", async () => {
		const { sourceFile } = await pinSource();
		const test = setup({ resident: true });
		await expect(test.provider.inspect()).resolves.toMatchObject({
			available: true,
		});
		await writeFile(sourceFile, "modified");
		await expect(test.provider.inspectProfile()).rejects.toThrow(
			"Independent source changed"
		);
		expect(inspectResidentCoreML).toHaveBeenCalledOnce();
		await test.provider.dispose();
	});
	it("revalidates source bytes after prediction instead of reusing the pre-render hash", async () => {
		const { sourceFile } = await pinSource();
		const test = setup({ resident: true });
		const run = test.run.getMockImplementation()!;
		test.run.mockImplementationOnce(async (request) => {
			const result = await run(request);
			await writeFile(sourceFile, "modified");
			return result;
		});
		await expect(test.provider.render({ request: input() })).rejects.toThrow(
			"Independent source changed"
		);
		expect(test.run).toHaveBeenCalledOnce();
		expect(inspectResidentCoreML).toHaveBeenCalledOnce();
		await test.provider.dispose();
	});
	it("publishes capability separately from warm availability", async () => {
		const test = setup();
		test.inspectCoreML.mockResolvedValue({
			available: false,
			message: "external model absent",
		});
		expect(await test.provider.inspect()).toMatchObject({
			available: true,
			bodyVideo: true,
			bodyVideoProfiles: {
				"swing-coreml-v1": {
					available: false,
					message: "external model absent",
				},
			},
		});
		await test.provider.dispose();
	});
	it("sends only Python's profile fields and binds actual worker/source receipt identity", async () => {
		const test = setup();
		const result = await test.provider.render({ request: input() });
		const sent = test.run.mock.calls[0][0];
		expect(sent.request.sequence).toMatchObject({
			executionProfile: "swing-coreml-v1",
			executionGeneration: generation,
		});
		expect(sent.request.sequence).not.toHaveProperty("executionIdentitySha256");
		expect(sent.sourceIdentity).toMatch(
			new RegExp(`:${capability.identitySha256}$`)
		);
		expect(result.report.adjustments).toEqual({
			values: { SlimBody: 25 },
			makeup: {},
		});
		expect(test.inspectCoreML).toHaveBeenCalledTimes(2);
		await test.provider.dispose();
	});
	it("rejects model changes between cache lookup and worker submission", async () => {
		const test = setup();
		const changed = input();
		changed.sequence.executionIdentitySha256 = "f".repeat(64);
		await expect(test.provider.render({ request: changed })).rejects.toThrow(
			"before rendering"
		);
		expect(test.run).not.toHaveBeenCalled();
		await test.provider.dispose();
	});
	it("rejects resources changed after prediction", async () => {
		const test = setup();
		test.inspectCoreML
			.mockResolvedValueOnce(capability)
			.mockResolvedValueOnce({ ...capability, identitySha256: "f".repeat(64) });
		await expect(test.provider.render({ request: input() })).rejects.toThrow(
			"during rendering"
		);
		await test.provider.dispose();
	});
	it("rejects a warm receipt instead of accepting silent substitution", async () => {
		const test = setup({
			mutate: (report) => {
				report.stages = [
					{
						script: "body_smart_render.py",
						receipt: {
							executionIdentity: { profile: "bef-cpu-warm-v1" },
							executionRoutes: [],
						},
					},
				];
			},
		});
		await expect(test.provider.render({ request: input() })).rejects.toThrow(
			"execution identity mismatch"
		);
		await test.provider.dispose();
	});
	it("forwards active cancellation to the resident worker's process-tree signal", async () => {
		const test = setup();
		test.run.mockImplementation(
			({ signal }) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener(
						"abort",
						() => reject(new Error("worker killed")),
						{ once: true }
					);
				})
		);
		const pending = test.provider.render({ request: input() });
		await vi.waitFor(() => expect(test.run).toHaveBeenCalledOnce());
		test.provider.cancel({ request: { requestId: input().requestId } });
		expect(test.run.mock.calls[0][0].signal.aborted).toBe(true);
		await expect(pending).rejects.toThrow("worker killed");
		await test.provider.dispose();
	});
	it("rejects direct still requests before consulting a worker", async () => {
		const test = setup();
		const { sequence: _sequence, ...still } = input();
		await expect(test.provider.render({ request: still })).rejects.toThrow(
			"profiled sequence"
		);
		expect(test.run).not.toHaveBeenCalled();
		await test.provider.dispose();
	});
});

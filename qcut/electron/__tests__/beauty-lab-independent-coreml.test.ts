// @vitest-environment node
import { access, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
	inspectIndependentCoreML,
	coreMLSequenceIdentity,
	verifyCoreMLSequenceReceipt,
} from "../beauty-lab/beauty-lab-independent-coreml";
import type { runIndependentBeautyJob } from "../beauty-lab/beauty-lab-independent-process";

const identity = {
	execution: {
		profile: "swing-coreml-v1" as const,
		networks: { models: "pinned" },
		sources: "source",
		schedule: "native",
	},
	helper: { sourceSha256: "a".repeat(64), binarySha256: "b".repeat(64) },
	python: "3.12.9",
	hardwareModel: "Mac15,7",
};
const receipt = { schemaVersion: 1, profile: "swing-coreml-v1", identity };
function inspector({
	value = receipt,
	environment = {} as NodeJS.ProcessEnv,
} = {}) {
	let output = "";
	const runJob = vi.fn<typeof runIndependentBeautyJob>(
		async ({ args, signal, environment: clean }) => {
			signal.throwIfAborted();
			expect(clean).not.toHaveProperty("DYLD_INSERT_LIBRARIES");
			expect(clean).not.toHaveProperty("LD_PRELOAD");
			expect(clean).not.toHaveProperty("PYTHONPATH");
			expect(clean.QCUT_BODY_COREML_MODEL_ROOT).toBe("/external/models");
			output = args[args.indexOf("--output") + 1];
			await writeFile(output, JSON.stringify(value));
		}
	);
	return {
		runJob,
		output: () => output,
		inspect: (overrides = {}) =>
			inspectIndependentCoreML({
				engineRoot: "/owned",
				runtimeRoot: "/runtime",
				python: "/python",
				platform: "darwin",
				environment: {
					QCUT_BODY_COREML_MODEL_ROOT: "/external/models",
					...environment,
				},
				runJob,
				...overrides,
			}),
	};
}

describe("CoreML profile resource inspection", () => {
	it("requires macOS and explicitly configured private resources", async () => {
		const probe = inspector();
		expect(await probe.inspect({ platform: "linux" })).toMatchObject({
			available: false,
		});
		expect(await probe.inspect({ environment: {} })).toMatchObject({
			available: false,
		});
		expect(probe.runJob).not.toHaveBeenCalled();
	});
	it("validates independently, strips injection and cleans its receipt", async () => {
		const probe = inspector({
			environment: {
				DYLD_INSERT_LIBRARIES: "/vendor",
				LD_PRELOAD: "/vendor",
				PYTHONPATH: "/vendor",
				QCUT_BODY_SKELETON_BACKEND: "onnx-exact",
			},
		});
		const result = await probe.inspect();
		expect(result).toMatchObject({ available: true, identity });
		expect(
			probe.runJob.mock.calls[0][0].environment.QCUT_BODY_SKELETON_BACKEND
		).toBe("onnx-exact");
		await expect(access(probe.output())).rejects.toThrow();
		expect(await probe.inspect()).toEqual(result);
	});
	it.each([
		"models",
		"sources",
		"helper",
		"hardware",
		"python",
	])("isolates changed %s identities", async (part) => {
		const changed = structuredClone(receipt);
		if (part === "models")
			changed.identity.execution.networks.models = "changed";
		if (part === "sources") changed.identity.execution.sources = "changed";
		if (part === "helper")
			changed.identity.helper.binarySha256 = "c".repeat(64);
		if (part === "hardware") changed.identity.hardwareModel = "OtherMac";
		if (part === "python") changed.identity.python = "3.12.10";
		const before = await inspector().inspect(),
			after = await inspector({ value: changed }).inspect();
		expect(before.available && before.identitySha256).not.toBe(
			after.available && after.identitySha256
		);
	});
	it("rejects generation-dependent capability receipts", async () => {
		const changed = {
			...receipt,
			identity: {
				...identity,
				execution: { ...identity.execution, generation: "random" },
			},
		};
		expect(await inspector({ value: changed }).inspect()).toMatchObject({
			available: false,
		});
	});
	it("rejects oversized receipts and loader failures", async () => {
		const changed = {
			...receipt,
			identity: { ...identity, python: "x".repeat(65536) },
		};
		expect(await inspector({ value: changed }).inspect()).toMatchObject({
			available: false,
		});
		const probe = inspector();
		probe.runJob.mockRejectedValue(new Error("compiled payload mismatch"));
		expect(await probe.inspect()).toMatchObject({
			available: false,
			message: expect.stringContaining("payload mismatch"),
		});
	});
	it("does not convert cancellation into an unavailable capability", async () => {
		const probe = inspector(),
			controller = new AbortController();
		controller.abort(new Error("cancelled"));
		await expect(probe.inspect({ signal: controller.signal })).rejects.toThrow(
			"cancelled"
		);
		expect(probe.runJob).not.toHaveBeenCalled();
	});
});

describe("CoreML request and actual execution receipts", () => {
	const sequence = {
		executionProfile: "swing-coreml-v1",
		executionGeneration: "d".repeat(64),
		executionIdentitySha256: "e".repeat(64),
	};
	it("rejects still requests and unexplained execution fields", () => {
		expect(() =>
			coreMLSequenceIdentity({ profile: "swing-coreml-v1" })
		).toThrow("profiled sequence");
		expect(() =>
			coreMLSequenceIdentity({ profile: undefined, sequence })
		).toThrow("explicit");
		expect(() =>
			coreMLSequenceIdentity({ profile: "swing-coreml-v1", sequence })
		).not.toThrow();
		expect(() => coreMLSequenceIdentity({ profile: undefined })).not.toThrow();
	});
	it("requires the actual body execution identity, generation and routes", () => {
		const valid = {
			script: "body_smart_render.py",
			receipt: {
				executionIdentity: {
					...identity.execution,
					generation: sequence.executionGeneration,
				},
				executionRoutes: [{ network: "refine", backend: "coreml" }],
			},
		};
		const verify = (stages: unknown) =>
			verifyCoreMLSequenceReceipt({
				stages,
				generation: sequence.executionGeneration,
				execution: identity.execution,
			});
		expect(() => verify([valid])).not.toThrow();
		expect(() => verify([])).toThrow("smart-body stage");
		expect(() => verify([valid, valid])).toThrow("smart-body stage");
		expect(() =>
			verify([
				{
					...valid,
					receipt: {
						...valid.receipt,
						executionIdentity: { profile: "bef-cpu-warm-v1" },
					},
				},
			])
		).toThrow("identity mismatch");
		expect(() =>
			verify([
				{
					...valid,
					receipt: {
						...valid.receipt,
						executionIdentity: {
							...valid.receipt.executionIdentity,
							generation: "other",
						},
					},
				},
			])
		).toThrow("identity mismatch");
		expect(() =>
			verify([
				{
					...valid,
					receipt: {
						...valid.receipt,
						executionRoutes: [{ network: "refine", backend: "fallback" }],
					},
				},
			])
		).toThrow();
	});
});

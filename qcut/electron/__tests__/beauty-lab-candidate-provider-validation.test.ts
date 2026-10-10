// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
	BEAUTY_LAB_CANDIDATE_STAGES,
	type BeautyLabCandidateResult,
	type BeautyLabCandidateStageId,
} from "../beauty-lab/beauty-lab-candidate-contract.js";
import {
	createBeautyLabCandidateProvider,
	type BeautyLabCandidateBackend,
} from "../beauty-lab/beauty-lab-candidate-provider.js";
import {
	beautyLabCandidateIdentity,
	parseBeautyLabCandidateRequest,
} from "../beauty-lab/beauty-lab-candidate-request.js";
import {
	deferred,
	fixture,
	makeRequest,
	makeResult,
	sparseCopy,
} from "./beauty-lab-candidate-provider-fixture.js";

describe("Beauty Lab live candidate validation (unit stubs, not runtime evidence)", () => {
	it.each([
		null,
		false,
		1,
		{},
		"validate",
	])("rejects a non-function raw request validator: %j", (validateRequest) => {
		const { backend, render } = fixture();
		expect(() =>
			createBeautyLabCandidateProvider({
				backend: {
					...backend,
					validateRequest,
				} as unknown as BeautyLabCandidateBackend,
			})
		).toThrow(/request validator/);
		expect(render).not.toHaveBeenCalled();
	});
	it("receives the raw request before normalization and identity computation", async () => {
		const { backend, render } = fixture();
		const request = {
			...makeRequest(),
			untrusted: true,
			inputSha256: "forged",
		};
		const validateRequest = vi.fn<
			NonNullable<BeautyLabCandidateBackend["validateRequest"]>
		>(({ request: raw }) => {
			expect(raw).toBe(request);
			expect(raw).toHaveProperty("untrusted", true);
			expect(raw).toHaveProperty("inputSha256", "forged");
			expect(render).not.toHaveBeenCalled();
		});
		const provider = createBeautyLabCandidateProvider({
			backend: { ...backend, validateRequest },
		});
		await provider.render({ request });
		expect(validateRequest).toHaveBeenCalledExactlyOnceWith({ request });
		const parsed = parseBeautyLabCandidateRequest({ request });
		expect(render).toHaveBeenCalledExactlyOnceWith({
			...parsed,
			...beautyLabCandidateIdentity({ request: parsed }),
		});
	});
	it("rejects raw input before even reading parser fields and recovers after validation failure", async () => {
		const { backend, render } = fixture();
		const readProtocol = vi.fn(() => {
			throw new Error("Parser must not read rejected input");
		});
		const request = Object.defineProperty({}, "protocol", {
			get: readProtocol,
		});
		const failure = new Error("Raw request denied");
		const validateRequest =
			vi.fn<NonNullable<BeautyLabCandidateBackend["validateRequest"]>>();
		validateRequest.mockImplementationOnce(() => {
			throw failure;
		});
		const provider = createBeautyLabCandidateProvider({
			backend: { ...backend, validateRequest },
		});
		await expect(provider.render({ request })).rejects.toBe(failure);
		expect(readProtocol).not.toHaveBeenCalled();
		expect(render).not.toHaveBeenCalled();
		await expect(
			provider.render({ request: makeRequest() })
		).resolves.toHaveProperty("source", "live-candidate");
		expect(validateRequest).toHaveBeenCalledTimes(2);
		expect(render).toHaveBeenCalledOnce();
	});
	it("pins the bound raw validator against backend mutation", async () => {
		const { backend, render } = fixture();
		const contexts: unknown[] = [];
		backend.validateRequest = function ({ request }) {
			contexts.push(this);
			expect(request).toEqual(makeRequest());
			throw new Error("Pinned validator denied request");
		};
		const provider = createBeautyLabCandidateProvider({ backend });
		const replacement =
			vi.fn<NonNullable<BeautyLabCandidateBackend["validateRequest"]>>();
		backend.validateRequest = replacement;
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			/Pinned validator/
		);
		expect(contexts).toEqual([backend]);
		expect(replacement).not.toHaveBeenCalled();
		expect(render).not.toHaveBeenCalled();
	});
	it("keeps providers registered without a hook compatible after backend mutation", async () => {
		const { backend, provider, render } = fixture();
		const validateRequest = vi.fn(() => {
			throw new Error("Late hook must not run");
		});
		backend.validateRequest = validateRequest;
		await provider.render({ request: makeRequest() });
		expect(validateRequest).not.toHaveBeenCalled();
		expect(render).toHaveBeenCalledOnce();
	});
	it.each([
		"blocked",
		"disposed",
		"busy",
	])("does not call the raw validator when %s", async (state) => {
		const { backend, render } = fixture();
		const validateRequest =
			vi.fn<NonNullable<BeautyLabCandidateBackend["validateRequest"]>>();
		backend.validateRequest = validateRequest;
		if (state === "blocked") backend.stages[0].parity = "blocked";
		const provider = createBeautyLabCandidateProvider({ backend });
		if (state === "disposed") await provider.dispose();
		const release = deferred<void>();
		let pending: ReturnType<typeof provider.render> | undefined;
		if (state === "busy") {
			render.mockImplementationOnce(async (request) => {
				await release.promise;
				return makeResult({ request });
			});
			pending = provider.render({ request: makeRequest() });
			validateRequest.mockClear();
		}
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			/unavailable|already running/
		);
		expect(validateRequest).not.toHaveBeenCalled();
		expect(render).toHaveBeenCalledTimes(state === "busy" ? 1 : 0);
		release.resolve({ value: undefined });
		await pending;
	});
	it("accepts all-native descriptors and ten zero-duration measurements", async () => {
		const native = [...BEAUTY_LAB_CANDIDATE_STAGES];
		const { provider, render } = fixture({ native });
		render.mockImplementationOnce(async ({ ...request }) => ({
			...makeResult({ request, native }),
			stageMetrics: BEAUTY_LAB_CANDIDATE_STAGES.map((id) => ({
				id,
				durationMs: 0,
			})),
		}));
		const result = await provider.render({ request: makeRequest() });
		expect(result.nativeDependencies).toEqual(native);
		expect(result.stageMetrics).toHaveLength(10);
		expect(
			result.stageMetrics.every(({ durationMs }) => durationMs === 0)
		).toBe(true);
	});

	it("passes an owned, sanitized request and computed identities to the backend", async () => {
		const { provider, render } = fixture();
		const request = {
			...makeRequest(),
			inputSha256: "forged",
			requestFingerprint: "forged",
			untrusted: true,
		};
		const parsed = parseBeautyLabCandidateRequest({ request });
		const identity = beautyLabCandidateIdentity({ request: parsed });
		const result = await provider.render({ request });
		expect(render).toHaveBeenCalledExactlyOnceWith({ ...parsed, ...identity });
		const input = render.mock.calls[0][0];
		expect(input.rgba.buffer).not.toBe(request.rgba.buffer);
		expect(input.adjustments).not.toBe(request.adjustments);
		expect(input.adjustments.values).not.toBe(request.adjustments.values);
		expect(input).not.toHaveProperty("untrusted");
		expect(result).toEqual(makeResult({ request: { ...parsed, ...identity } }));
	});

	it("returns only whitelisted metadata without reading extra backend response fields", async () => {
		const { provider, render } = fixture();
		render.mockImplementationOnce(async ({ ...request }) => {
			const result = makeResult({ request });
			Object.assign(result, { internalDiagnostic: { unitOnly: true } });
			Object.assign(result.stageMetrics[0], { privateDetail: "unit-only" });
			Object.defineProperty(result, "unexpectedResponse", {
				enumerable: true,
				get: () => {
					throw new Error("extra backend field must not be read");
				},
			});
			return result;
		});
		const request = makeRequest();
		const result = await provider.render({ request });
		expect(result).toEqual(
			makeResult({
				request: { ...request, ...beautyLabCandidateIdentity({ request }) },
			})
		);
		expect(result).not.toHaveProperty("internalDiagnostic");
		expect(result).not.toHaveProperty("unexpectedResponse");
		expect(result.stageMetrics[0]).not.toHaveProperty("privateDetail");
	});

	it.each([
		{
			label: "stale backend version",
			patch: { backendVersion: "unit-stub-v0" },
		},
		{ label: "missing source", patch: { sourceKey: undefined } },
		{ label: "missing timestamp", patch: { timestampSeconds: undefined } },
		{ label: "short RGBA", patch: { rgba: new Uint8Array(7) } },
		{
			label: "shared RGBA",
			patch: { rgba: new Uint8Array(new SharedArrayBuffer(8)) },
		},
		{
			label: "unsupported adjustment",
			patch: { adjustments: { enabled: true, values: { unknown: 1 } } },
		},
	])("rejects $label input before backend invocation and permits the next valid request", async ({
		patch,
	}) => {
		const { provider, render } = fixture();
		await expect(
			provider.render({ request: { ...makeRequest(), ...patch } })
		).rejects.toThrow();
		expect(render).not.toHaveBeenCalled();
		await expect(
			provider.render({ request: makeRequest() })
		).resolves.toMatchObject({ source: "live-candidate" });
	});

	it.each(
		[
			{ field: "protocol", wrong: "qcut-beauty-lab-candidate-v0" },
			{ field: "source", wrong: "verified-offline-replay" },
			{ field: "backendId", wrong: "native-jianying" },
			{ field: "backendVersion", wrong: "unit-stub-v0" },
			{ field: "requestId", wrong: "unit-request:old" },
			{ field: "sourceKey", wrong: "other-clip" },
			{ field: "frameNumber", wrong: 4 },
			{ field: "timestampSeconds", wrong: 0.125001 },
			{ field: "inputSha256", wrong: "a".repeat(64) },
			{ field: "requestFingerprint", wrong: "b".repeat(64) },
		].flatMap(({ field, wrong }) =>
			[wrong, undefined, null].map((value) => ({ field, value }))
		)
	)("rejects invalid provenance $field $value and clears busy", async ({
		field,
		value,
	}) => {
		const { provider, render } = fixture();
		render.mockImplementationOnce(
			async ({ ...request }) =>
				({
					...makeResult({ request }),
					[field]: value,
				}) as BeautyLabCandidateResult
		);
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			/current live request/i
		);
		await expect(
			provider.render({ request: makeRequest() })
		).resolves.toMatchObject({ source: "live-candidate" });
	});

	it.each(
		["offline", "research", "fixture", "native", "live-candidate "].map(
			(source) => ({ source })
		)
	)("never promotes source $source to a live result", async ({ source }) => {
		const { provider, render } = fixture();
		render.mockImplementationOnce(
			async ({ ...request }) =>
				({
					...makeResult({ request }),
					source,
				}) as unknown as BeautyLabCandidateResult
		);
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			/current live request/i
		);
	});

	it.each(
		[null, undefined, false, "result", {}].map((result) => ({ result }))
	)("rejects malformed result $result", async ({ result }) => {
		const { provider, render } = fixture();
		render.mockResolvedValueOnce(result as unknown as BeautyLabCandidateResult);
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow();
	});

	it.each([
		{ label: "short bytes", patch: { rgba: new Uint8Array(7) } },
		{ label: "long bytes", patch: { rgba: new Uint8Array(9) } },
		{ label: "plain array", patch: { rgba: new Array(8).fill(0) } },
		{ label: "ArrayBuffer", patch: { rgba: new ArrayBuffer(8) } },
		{ label: "clamped array", patch: { rgba: new Uint8ClampedArray(8) } },
		{
			label: "shared output",
			patch: { rgba: new Uint8Array(new SharedArrayBuffer(8)) },
		},
		{ label: "width", patch: { width: 1 } },
		{ label: "height", patch: { height: 2 } },
		{ label: "same area but transposed", patch: { width: 1, height: 2 } },
		{ label: "nonfinite dimension", patch: { width: Number.NaN } },
		{ label: "numeric string dimension", patch: { height: "1" } },
	])("rejects invalid output $label", async ({ patch }) => {
		const { provider, render } = fixture();
		render.mockImplementationOnce(
			async ({ ...request }) =>
				({
					...makeResult({ request }),
					...patch,
				}) as unknown as BeautyLabCandidateResult
		);
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			/RGBA/i
		);
	});

	it.each([
		{ label: "missing", dependencies: undefined },
		{ label: "null", dependencies: null },
		{ label: "boolean", dependencies: true },
		{ label: "string", dependencies: "detection" },
		{ label: "empty", dependencies: [] },
		{ label: "omitted", dependencies: ["detection"] },
		{ label: "extra", dependencies: ["detection", "sampling-160", "geometry"] },
		{ label: "duplicate", dependencies: ["detection", "detection"] },
		{ label: "qcut stage", dependencies: ["detection", "geometry"] },
		{ label: "unknown stage", dependencies: ["detection", "unknown"] },
		{
			label: "sparse",
			dependencies: sparseCopy({ values: ["detection", "sampling-160"] }),
		},
	])("rejects $label native dependencies", async ({ dependencies }) => {
		const { provider, render } = fixture({
			native: ["detection", "sampling-160"],
		});
		render.mockImplementationOnce(
			async ({ ...request }) =>
				({
					...makeResult({ request }),
					nativeDependencies: dependencies,
				}) as unknown as BeautyLabCandidateResult
		);
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			/dependencies/i
		);
	});

	it("accepts dependency and metric order changes only when membership is exact", async () => {
		const native: BeautyLabCandidateStageId[] = ["detection", "sampling-160"];
		const { provider, render } = fixture({ native });
		render.mockImplementationOnce(async ({ ...request }) => {
			const result = makeResult({ request, native });
			result.nativeDependencies.reverse();
			result.stageMetrics.reverse();
			return result;
		});
		expect(
			(await provider.render({ request: makeRequest() })).nativeDependencies
		).toEqual(native);
	});

	it("rejects a hidden native dependency from an all-QCut descriptor", async () => {
		const { provider, render } = fixture();
		render.mockImplementationOnce(async ({ ...request }) =>
			makeResult({ request, native: ["detection"] })
		);
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			/dependencies/i
		);
	});

	it.each(
		[undefined, null, {}, [], "metrics"].map((metrics) => ({ metrics }))
	)("rejects malformed metrics $metrics", async ({ metrics }) => {
		const { provider, render } = fixture();
		render.mockImplementationOnce(
			async ({ ...request }) =>
				({
					...makeResult({ request }),
					stageMetrics: metrics,
				}) as unknown as BeautyLabCandidateResult
		);
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			/metrics/i
		);
	});

	it.each(
		BEAUTY_LAB_CANDIDATE_STAGES.flatMap((id) =>
			[
				-1,
				Number.NaN,
				Number.POSITIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
				"0",
				null,
				undefined,
			].map((durationMs) => ({ id, durationMs }))
		)
	)("rejects $id duration $durationMs", async ({ id, durationMs }) => {
		const { provider, render } = fixture();
		render.mockImplementationOnce(async ({ ...request }) => {
			const result = makeResult({ request });
			return {
				...result,
				stageMetrics: result.stageMetrics.map((metric) =>
					metric.id === id ? { ...metric, durationMs } : metric
				),
			} as unknown as BeautyLabCandidateResult;
		});
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			/metrics/i
		);
	});

	it.each(
		["missing", "duplicate", "unknown", "null", "sparse", "extra"].map(
			(kind) => ({ kind })
		)
	)("rejects $kind stage metric coverage", async ({ kind }) => {
		const { provider, render } = fixture();
		render.mockImplementationOnce(async ({ ...request }) => {
			const result = makeResult({ request });
			const metrics = result.stageMetrics;
			const replacements = {
				missing: metrics.slice(1),
				duplicate: [metrics[1], ...metrics.slice(1)],
				unknown: [{ id: "unknown", durationMs: 0 }, ...metrics.slice(1)],
				null: [null, ...metrics.slice(1)],
				sparse: sparseCopy({ values: metrics }),
				extra: [...metrics, metrics[0]],
			};
			return {
				...result,
				stageMetrics: replacements[kind as keyof typeof replacements],
			} as unknown as BeautyLabCandidateResult;
		});
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			/metrics/i
		);
	});
});

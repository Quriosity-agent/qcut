// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	BEAUTY_LAB_CANDIDATE_STAGES,
	type BeautyLabCandidateRequest,
	type BeautyLabCandidateResult,
	type BeautyLabCandidateStage,
	type BeautyLabCandidateStageId,
} from "../beauty-lab-candidate-contract.js";
import {
	createBeautyLabCandidateProvider,
	type BeautyLabCandidateBackend,
} from "../beauty-lab-candidate-provider.js";
import {
	beautyLabCandidateIdentity,
	parseBeautyLabCandidateRequest,
} from "../beauty-lab-candidate-request.js";

type BackendRequest = Parameters<BeautyLabCandidateBackend["render"]>[0];

function makeRequest({
	patch = {},
}: {
	patch?: Partial<BeautyLabCandidateRequest>;
} = {}): BeautyLabCandidateRequest {
	return {
		protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
		requestId: "unit-request:1",
		backendVersion: "unit-stub-v1",
		width: 2,
		height: 1,
		rgba: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 127]),
		adjustments: { enabled: true, values: { face_adjust_eye: 40 } },
		sourceKey: "unit-media:clip-1",
		frameNumber: 3,
		timestampSeconds: 0.125,
		...patch,
	};
}

function makeStages({
	native = [],
}: {
	native?: BeautyLabCandidateStageId[];
} = {}): BeautyLabCandidateStage[] {
	return BEAUTY_LAB_CANDIDATE_STAGES.map((id) => ({
		id,
		implementation: native.includes(id) ? "native" : "qcut",
		parity: "accepted",
		message: "Synthetic unit stub; no runtime or parity evidence",
	}));
}

function makeResult({
	request,
	native = [],
}: {
	request: BackendRequest;
	native?: BeautyLabCandidateStageId[];
}): BeautyLabCandidateResult {
	return {
		protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
		source: "live-candidate",
		backendId: BEAUTY_LAB_CANDIDATE_BACKEND,
		backendVersion: request.backendVersion,
		requestId: request.requestId,
		requestFingerprint: request.requestFingerprint,
		inputSha256: request.inputSha256,
		sourceKey: request.sourceKey,
		frameNumber: request.frameNumber,
		timestampSeconds: request.timestampSeconds,
		width: request.width,
		height: request.height,
		rgba: new Uint8Array(request.rgba).fill(42),
		nativeDependencies: [...native],
		stageMetrics: BEAUTY_LAB_CANDIDATE_STAGES.map((id, index) => ({
			id,
			durationMs: index / 10,
		})),
	};
}

function fixture({
	native = [],
}: {
	native?: BeautyLabCandidateStageId[];
} = {}) {
	const render = vi.fn<BeautyLabCandidateBackend["render"]>(
		async ({ ...request }) => makeResult({ request, native })
	);
	const backend: BeautyLabCandidateBackend = {
		version: "unit-stub-v1",
		stages: makeStages({ native }),
		render,
	};
	return {
		backend,
		render,
		provider: createBeautyLabCandidateProvider({ backend }),
	};
}

function sparseCopy<T>({ values }: { values: T[] }): T[] {
	return Object.assign(
		new Array<T>(values.length),
		Object.fromEntries(
			values.slice(1).map((value, index) => [index + 1, value])
		)
	);
}

function deferred<T>() {
	let resolvePromise!: (value: T) => void;
	let rejectPromise!: (error: Error) => void;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		resolve: ({ value }: { value: T }) => resolvePromise(value),
		reject: ({ error }: { error: Error }) => rejectPromise(error),
	};
}

describe("Beauty Lab candidate descriptors (unit stubs, not runtime evidence)", () => {
	it("defaults to not-connected and never fabricates a render", async () => {
		const provider = createBeautyLabCandidateProvider();
		expect(provider.inspect()).toMatchObject({
			protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
			backendId: BEAUTY_LAB_CANDIDATE_BACKEND,
			backendVersion: null,
			state: "not-connected",
			available: false,
			stages: [],
		});
		expect(provider.inspect().blockers.length).toBeGreaterThan(0);
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			/unavailable/i
		);
	});

	it.each([
		{ native: [] },
		{ native: ["detection", "sampling-160"] },
		{ native: [...BEAUTY_LAB_CANDIDATE_STAGES] },
	] satisfies {
		native: BeautyLabCandidateStageId[];
	}[])("requires ten accepted unique stages, including native descriptor stages $native", ({
		native,
	}) => {
		const { provider, backend } = fixture({ native });
		expect(provider.inspect()).toEqual({
			protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
			backendId: BEAUTY_LAB_CANDIDATE_BACKEND,
			backendVersion: backend.version,
			state: "ready",
			available: true,
			blockers: [],
			stages: backend.stages,
		});
	});

	it.each(
		[
			undefined,
			null,
			1,
			true,
			false,
			{},
			{ toString: () => "unit-stub-v1" },
			"",
			" ",
			"unit v1",
			"a/b",
			"a\nb",
			"x".repeat(129),
		].map((version) => ({ version }))
	)("rejects malformed backend version $version before rendering", ({
		version,
	}) => {
		const { backend, render } = fixture();
		expect(() =>
			createBeautyLabCandidateProvider({
				backend: {
					...backend,
					version,
				} as unknown as BeautyLabCandidateBackend,
			})
		).toThrow(/version/i);
		expect(render).not.toHaveBeenCalled();
	});

	it.each(
		[undefined, null, 1, {}, "render"].map((renderer) => ({ renderer }))
	)("rejects non-function backend renderer $renderer", ({ renderer }) => {
		const { backend } = fixture();
		expect(() =>
			createBeautyLabCandidateProvider({
				backend: {
					...backend,
					render: renderer,
				} as unknown as BeautyLabCandidateBackend,
			})
		).toThrow(/renderer/i);
	});

	it.each(
		["x", "x".repeat(128), "Az09._:-"].map((version) => ({ version }))
	)("accepts bounded backend version $version", ({ version }) => {
		const { backend } = fixture();
		expect(
			createBeautyLabCandidateProvider({
				backend: { ...backend, version },
			}).inspect().backendVersion
		).toBe(version);
	});

	it.each([
		{ label: "missing", stages: undefined },
		{ label: "null", stages: null },
		{ label: "object", stages: {} },
		{ label: "empty", stages: [] },
		{ label: "missing stage", stages: makeStages().slice(1) },
		{ label: "extra stage", stages: [...makeStages(), makeStages()[0]] },
		{
			label: "duplicate replacing a stage",
			stages: [makeStages()[1], ...makeStages().slice(1)],
		},
		{
			label: "unknown stage",
			stages: [{ ...makeStages()[0], id: "unknown" }, ...makeStages().slice(1)],
		},
		{ label: "null entry", stages: [null, ...makeStages().slice(1)] },
		{ label: "sparse array", stages: sparseCopy({ values: makeStages() }) },
		{
			label: "unknown implementation",
			stages: [
				{ ...makeStages()[0], implementation: "offline" },
				...makeStages().slice(1),
			],
		},
		{
			label: "unknown parity",
			stages: [
				{ ...makeStages()[0], parity: "verified" },
				...makeStages().slice(1),
			],
		},
		{
			label: "non-string message",
			stages: [{ ...makeStages()[0], message: 1 }, ...makeStages().slice(1)],
		},
		{
			label: "oversized message",
			stages: [
				{ ...makeStages()[0], message: "x".repeat(513) },
				...makeStages().slice(1),
			],
		},
	])("rejects $label descriptors at construction", ({ stages }) => {
		const { backend } = fixture();
		expect(() =>
			createBeautyLabCandidateProvider({
				backend: { ...backend, stages } as unknown as BeautyLabCandidateBackend,
			})
		).toThrow();
	});

	it.each(
		BEAUTY_LAB_CANDIDATE_STAGES.flatMap((id) =>
			(["unverified", "blocked"] as const).map((parity) => ({ id, parity }))
		)
	)("blocks $id with parity $parity", async ({ id, parity }) => {
		const { backend, render } = fixture();
		backend.stages = backend.stages.map((stage) =>
			stage.id === id ? { ...stage, parity } : stage
		);
		const provider = createBeautyLabCandidateProvider({ backend });
		expect(provider.inspect()).toMatchObject({
			state: "blocked",
			available: false,
			blockers: [`${id}:${parity}`],
		});
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			/unavailable/i
		);
		expect(render).not.toHaveBeenCalled();
	});

	it("pins descriptor parity and native dependencies against caller and inspect mutations", async () => {
		const native: BeautyLabCandidateStageId[] = ["detection", "sampling-160"];
		const { backend, provider } = fixture({ native });
		backend.stages[0].implementation = "qcut";
		backend.stages[0].parity = "blocked";
		backend.stages[0].message = "mutated";
		backend.stages.length = 0;
		const status = provider.inspect();
		status.stages[1].parity = "unverified";
		status.stages.push(status.stages[0]);
		status.blockers.push("caller-blocker");
		expect(provider.inspect()).toMatchObject({
			state: "ready",
			available: true,
			blockers: [],
			stages: makeStages({ native }),
		});
		expect(
			(await provider.render({ request: makeRequest() })).nativeDependencies
		).toEqual(native);
	});

	it("cannot turn a blocked provider ready by changing its original or inspected descriptors", async () => {
		const { backend, render } = fixture();
		backend.stages[0].parity = "unverified";
		const provider = createBeautyLabCandidateProvider({ backend });
		backend.stages[0].parity = "accepted";
		provider.inspect().stages[0].parity = "accepted";
		expect(provider.inspect().state).toBe("blocked");
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow();
		expect(render).not.toHaveBeenCalled();
	});

	it("pins backend version at construction and rejects a mutated descriptor's new version", async () => {
		const { backend, provider, render } = fixture();
		backend.version = "unit-stub-v2";
		expect(provider.inspect().backendVersion).toBe("unit-stub-v1");
		await expect(
			provider.render({
				request: makeRequest({ patch: { backendVersion: "unit-stub-v2" } }),
			})
		).rejects.toThrow(/version/i);
		expect(render).not.toHaveBeenCalled();
		await expect(
			provider.render({ request: makeRequest() })
		).resolves.toMatchObject({ backendVersion: "unit-stub-v1" });
	});
});

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

describe("Beauty Lab candidate lifecycle (unit stubs, not runtime evidence)", () => {
	it("pins version and execution across backend mutation during an awaited render", async () => {
		const entered = deferred<BackendRequest>();
		const release = deferred<void>();
		const { backend, provider, render } = fixture();
		render.mockImplementationOnce(async ({ ...request }) => {
			entered.resolve({ value: request });
			await release.promise;
			return makeResult({ request });
		});
		const pending = provider.render({ request: makeRequest() });
		await entered.promise;
		backend.version = "unit-stub-v2";
		backend.stages[0].parity = "blocked";
		const replacement = vi.fn<BeautyLabCandidateBackend["render"]>();
		backend.render = replacement;
		expect(provider.inspect()).toMatchObject({
			backendVersion: "unit-stub-v1",
			available: true,
		});
		release.resolve({ value: undefined });
		await expect(pending).resolves.toMatchObject({
			backendVersion: "unit-stub-v1",
		});
		await expect(
			provider.render({ request: makeRequest() })
		).resolves.toMatchObject({ backendVersion: "unit-stub-v1" });
		expect(replacement).not.toHaveBeenCalled();
		expect(render).toHaveBeenCalledTimes(2);
	});

	it.each([
		{ label: "new request ID", patch: { requestId: "unit-request:2" } },
		{ label: "new source", patch: { sourceKey: "unit-media:clip-2" } },
		{ label: "new frame", patch: { frameNumber: 4 } },
		{ label: "new timestamp", patch: { timestampSeconds: 0.125001 } },
		{ label: "changed pixels", patch: { rgba: new Uint8Array(8).fill(1) } },
		{
			label: "changed parameters",
			patch: {
				adjustments: { enabled: true, values: { face_adjust_eye: 41 } },
			},
		},
		{ label: "changed dimensions", patch: { width: 1, height: 2 } },
	] satisfies {
		label: string;
		patch: Partial<BeautyLabCandidateRequest>;
	}[])("rejects replay of an earlier valid result for $label", async ({
		patch,
	}) => {
		const { provider, render } = fixture();
		const earlier = await provider.render({ request: makeRequest() });
		render.mockResolvedValueOnce(earlier);
		await expect(
			provider.render({ request: makeRequest({ patch }) })
		).rejects.toThrow();
		await expect(
			provider.render({ request: makeRequest({ patch }) })
		).resolves.toMatchObject({ source: "live-candidate" });
	});

	it("owns input bytes, nested parameters and metadata throughout an awaited backend", async () => {
		const entered = deferred<BackendRequest>();
		const release = deferred<void>();
		const { provider, render } = fixture();
		render.mockImplementationOnce(async () => {
			const request = render.mock.calls[0][0];
			entered.resolve({ value: request });
			await release.promise;
			return makeResult({ request });
		});
		const request = makeRequest({
			patch: {
				adjustments: {
					enabled: true,
					values: { face_adjust_eye: 40 },
					manualBody: { zoom: { intensity: 10, x: 0.5, y: 0.5, radius: 0.2 } },
				},
			},
		});
		const expected = structuredClone(request);
		const pending = provider.render({ request });
		const backendInput = await entered.promise;
		request.rgba.fill(0);
		request.adjustments.values.face_adjust_eye = 90;
		request.adjustments.manualBody!.zoom!.intensity = 40;
		request.requestId = "changed";
		request.sourceKey = "changed";
		request.timestampSeconds = 8;
		expect(backendInput).toEqual({
			...expected,
			...beautyLabCandidateIdentity({ request: expected }),
		});
		release.resolve({ value: undefined });
		await expect(pending).resolves.toMatchObject({
			requestId: expected.requestId,
			sourceKey: expected.sourceKey,
			timestampSeconds: expected.timestampSeconds,
			...beautyLabCandidateIdentity({ request: expected }),
		});
	});

	it("keeps a private validation snapshot when the backend mutates its own request", async () => {
		const { provider, render } = fixture();
		render.mockImplementationOnce(async () => {
			const request = render.mock.calls[0][0];
			const result = makeResult({ request });
			request.rgba.fill(0);
			request.adjustments.values.face_adjust_eye = 90;
			request.requestId = "backend-local";
			request.sourceKey = "backend-local";
			request.frameNumber = 99;
			request.timestampSeconds = 8;
			return result;
		});
		const request = makeRequest();
		await expect(provider.render({ request })).resolves.toMatchObject({
			requestId: request.requestId,
			sourceKey: request.sourceKey,
			frameNumber: request.frameNumber,
			timestampSeconds: request.timestampSeconds,
			...beautyLabCandidateIdentity({ request }),
		});
		expect(request).toEqual(makeRequest());
	});

	it("does not let a backend rewrite the validation snapshot or recompute its identity", async () => {
		const { provider, render } = fixture();
		const original = makeRequest();
		render.mockImplementationOnce(async () => {
			const request = render.mock.calls[0][0];
			request.rgba.fill(0);
			request.adjustments.values.face_adjust_eye = 90;
			request.requestId = "backend-forged";
			request.timestampSeconds = 8;
			return makeResult({
				request: { ...request, ...beautyLabCandidateIdentity({ request }) },
			});
		});
		await expect(provider.render({ request: original })).rejects.toThrow(
			/current live request/i
		);
		expect(original).toEqual(makeRequest());
		await expect(provider.render({ request: original })).resolves.toMatchObject(
			{ source: "live-candidate" }
		);
	});

	it("owns returned pixels, native dependencies and metric objects in both mutation directions", async () => {
		const native: BeautyLabCandidateStageId[] = ["detection"];
		const { provider, render } = fixture({ native });
		const request = makeRequest();
		const backendResult = makeResult({
			request: { ...request, ...beautyLabCandidateIdentity({ request }) },
			native,
		});
		render.mockResolvedValueOnce(backendResult);
		const result = await provider.render({ request });
		const snapshot = structuredClone(result);
		expect(result).not.toBe(backendResult);
		expect(result.rgba.buffer).not.toBe(backendResult.rgba.buffer);
		expect(result.nativeDependencies).not.toBe(
			backendResult.nativeDependencies
		);
		expect(result.stageMetrics[0]).not.toBe(backendResult.stageMetrics[0]);
		backendResult.rgba.fill(0);
		backendResult.nativeDependencies.length = 0;
		backendResult.stageMetrics[0].durationMs = 999;
		backendResult.requestId = "changed";
		expect(result).toEqual(snapshot);
		result.rgba.fill(255);
		result.nativeDependencies.push("geometry");
		result.stageMetrics[1].durationMs = 88;
		expect(backendResult.rgba[0]).toBe(0);
		expect(backendResult.nativeDependencies).toEqual([]);
		expect(backendResult.stageMetrics[1].durationMs).toBe(0.1);
	});

	it.each([
		{ kind: "uint8-view" },
		{ kind: "buffer-view" },
	])("owns only visible output pixels for $kind after backend detachment", async ({
		kind,
	}) => {
		const { provider, render } = fixture();
		const backing = new ArrayBuffer(12);
		new Uint8Array(backing).fill(99);
		const rgba =
			kind === "buffer-view"
				? Buffer.from(backing, 2, 8)
				: new Uint8Array(backing, 2, 8);
		rgba.fill(42);
		render.mockImplementationOnce(async ({ ...request }) => ({
			...makeResult({ request }),
			rgba,
		}));
		const result = await provider.render({ request: makeRequest() });
		expect(result.rgba).toEqual(new Uint8Array(8).fill(42));
		expect(result.rgba.byteOffset).toBe(0);
		expect(result.rgba.buffer.byteLength).toBe(8);
		structuredClone(backing, { transfer: [backing] });
		expect(rgba.byteLength).toBe(0);
		expect(result.rgba).toEqual(new Uint8Array(8).fill(42));
	});

	it.each(
		["success", "backend-rejection", "invalid-output"].map((outcome) => ({
			outcome,
		}))
	)("rejects a second in-flight render and releases busy after $outcome", async ({
		outcome,
	}) => {
		const entered = deferred<BackendRequest>();
		const release = deferred<void>();
		const { provider, render } = fixture();
		render.mockImplementationOnce(async ({ ...request }) => {
			entered.resolve({ value: request });
			await release.promise;
			return {
				...makeResult({ request }),
				...(outcome === "invalid-output" ? { requestId: "stale" } : {}),
			};
		});
		const pending = provider.render({ request: makeRequest() });
		const settled = pending.then(
			(result) => ({ result }),
			(error: unknown) => ({ error })
		);
		await entered.promise;
		await expect(
			provider.render({
				request: makeRequest({ patch: { requestId: "unit-request:2" } }),
			})
		).rejects.toThrow(/already running|busy/i);
		expect(render).toHaveBeenCalledTimes(1);
		expect(provider.inspect().state).toBe("ready");
		if (outcome === "backend-rejection")
			release.reject({ error: new Error("unit backend failure") });
		else release.resolve({ value: undefined });
		const completion = await settled;
		if (outcome === "success")
			expect(completion).toHaveProperty("result.source", "live-candidate");
		else expect(completion).toHaveProperty("error");
		await expect(
			provider.render({
				request: makeRequest({ patch: { requestId: "unit-request:3" } }),
			})
		).resolves.toMatchObject({ requestId: "unit-request:3" });
		expect(render).toHaveBeenCalledTimes(2);
	});

	it("releases busy after a synchronous backend throw", async () => {
		const { provider, render } = fixture();
		render.mockImplementationOnce(() => {
			throw new Error("unit sync failure");
		});
		await expect(provider.render({ request: makeRequest() })).rejects.toThrow(
			"unit sync failure"
		);
		await expect(
			provider.render({ request: makeRequest() })
		).resolves.toMatchObject({ source: "live-candidate" });
	});
});

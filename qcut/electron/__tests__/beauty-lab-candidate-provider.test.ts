// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	BEAUTY_LAB_CANDIDATE_STAGES,
	type BeautyLabCandidateRequest,
	type BeautyLabCandidateStageId,
} from "../beauty-lab/beauty-lab-candidate-contract.js";
import {
	createBeautyLabCandidateProvider,
	type BeautyLabCandidateBackend,
} from "../beauty-lab/beauty-lab-candidate-provider.js";
import { beautyLabCandidateIdentity } from "../beauty-lab/beauty-lab-candidate-request.js";
import {
	type BackendRequest,
	deferred,
	fixture,
	makeRequest,
	makeResult,
	makeStages,
	sparseCopy,
} from "./beauty-lab-candidate-provider-fixture.js";

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

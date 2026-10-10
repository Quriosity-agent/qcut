// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	BEAUTY_LAB_CANDIDATE_STAGES,
	type BeautyLabCandidateResult,
	type BeautyLabCandidateStageMetric,
} from "../beauty-lab/beauty-lab-candidate-contract.js";
import {
	createBeautyLabCandidateProvider,
	type BeautyLabCandidateBackend,
} from "../beauty-lab/beauty-lab-candidate-provider.js";
import { requestFor } from "./beauty-lab-live-candidate-fixture.js";

function fixture({
	scoped = true,
	modify = (_result: BeautyLabCandidateResult) => {},
}: {
	scoped?: boolean;
	modify?: (result: BeautyLabCandidateResult) => void;
} = {}) {
	const scope = scoped
		? {
				scope: "audited-single-static-frame" as const,
				timingScope: "cumulative-owned-worker-including-warmup" as const,
			}
		: {};
	const backend: BeautyLabCandidateBackend = {
		version: "synthetic-v1",
		...scope,
		stages: BEAUTY_LAB_CANDIDATE_STAGES.map((id) => ({
			id,
			implementation: id === "detection" ? "native" : "qcut",
			parity: "accepted",
			message: "Synthetic contract only",
		})),
		render: async (request) => {
			const result: BeautyLabCandidateResult = {
				...request,
				...scope,
				source: "live-candidate",
				protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
				backendId: BEAUTY_LAB_CANDIDATE_BACKEND,
				nativeDependencies: ["detection"],
				stageMetrics: BEAUTY_LAB_CANDIDATE_STAGES.map((id) =>
					id === "detection"
						? {
								id,
								durationMs: null,
								unavailableReason: "native-stage-not-instrumented",
							}
						: { id, durationMs: 0.25 }
				),
			};
			modify(result);
			return result;
		},
	};
	return {
		backend,
		provider: createBeautyLabCandidateProvider({ backend }),
		request: requestFor({ version: backend.version }),
	};
}

describe("candidate static scope and native timing gaps", () => {
	it.each([
		"auditSha256",
		"dependenciesSha256",
		"workerLogSha256",
		"workerBackendVersion",
	] as const)("rejects malformed provenance %s", async (key) => {
		const { provider, request } = fixture({
			modify: (result) => {
				result.provenance = {
					auditSha256: "a".repeat(64),
					dependenciesSha256: "b".repeat(64),
					workerLogSha256: "c".repeat(64),
					workerBackendVersion: `dependency-core-v1:${"d".repeat(64)}`,
				};
				result.provenance[key] = "invalid";
			},
		});
		await expect(provider.render({ request })).rejects.toThrow(/provenance/);
	});
	it("awaits the captured disposer exactly once and blocks further work", async () => {
		const { backend, request } = fixture();
		let close = () => {};
		const dispose = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					close = resolve;
				})
		);
		backend.dispose = dispose;
		const provider = createBeautyLabCandidateProvider({ backend });
		backend.dispose = vi.fn();
		const first = provider.dispose();
		expect(provider.dispose()).toBe(first);
		let finished = false;
		void first.then(() => {
			finished = true;
		});
		await Promise.resolve();
		expect(dispose).toHaveBeenCalledOnce();
		expect(finished).toBe(false);
		expect(provider.inspect()).toMatchObject({
			state: "blocked",
			available: false,
			blockers: ["candidate-backend-disposed"],
		});
		await expect(provider.render({ request })).rejects.toThrow(/disposed/);
		close();
		await first;
		expect(finished).toBe(true);
	});
	it("awaits an in-flight legacy backend and suppresses its late result", async () => {
		const { backend, request } = fixture({ scoped: false });
		const render = backend.render;
		let close = () => {};
		backend.render = async (bound) => {
			await new Promise<void>((resolve) => {
				close = resolve;
			});
			return render(bound);
		};
		const provider = createBeautyLabCandidateProvider({ backend });
		const rejected = expect(provider.render({ request })).rejects.toThrow(
			/disposed/
		);
		let finished = false;
		const disposal = provider.dispose().then(() => {
			finished = true;
		});
		await Promise.resolve();
		expect(finished).toBe(false);
		close();
		await rejected;
		await disposal;
		expect(finished).toBe(true);
	});
	it("surfaces disposer errors and stays unavailable", async () => {
		const { backend } = fixture();
		backend.dispose = async () => {
			throw new Error("cleanup failed");
		};
		const provider = createBeautyLabCandidateProvider({ backend });
		await expect(provider.dispose()).rejects.toThrow("cleanup failed");
		expect(provider.inspect().available).toBe(false);
	});
	it("rejects an invalid optional disposer", () => {
		const { backend } = fixture();
		expect(() =>
			createBeautyLabCandidateProvider({
				backend: {
					...backend,
					dispose: 42,
				} as unknown as BeautyLabCandidateBackend,
			})
		).toThrow(/disposer/);
	});
	it("preserves scoped metadata and explicit unavailable native timing", async () => {
		const { provider, request } = fixture();
		expect(provider.inspect()).toMatchObject({
			scope: "audited-single-static-frame",
			timingScope: "cumulative-owned-worker-including-warmup",
		});
		const result = await provider.render({ request });
		expect(result.scope).toBe("audited-single-static-frame");
		expect(result.timingScope).toBe("cumulative-owned-worker-including-warmup");
		expect(result.stageMetrics[0]).toEqual({
			id: "detection",
			durationMs: null,
			unavailableReason: "native-stage-not-instrumented",
		});
	});
	it("keeps unscoped legacy backends compatible", async () => {
		const { provider, request } = fixture({ scoped: false });
		expect(provider.inspect()).not.toHaveProperty("scope");
		expect(await provider.render({ request })).not.toHaveProperty(
			"timingScope"
		);
	});
	it.each([
		"scope",
		"timingScope",
	] as const)("rejects missing or different %s", async (key) => {
		const { provider, request } = fixture({
			modify: (result) => {
				result[key] = undefined;
			},
		});
		await expect(provider.render({ request })).rejects.toThrow(
			/current live request/
		);
	});
	it("rejects unexpected scope returned by a legacy backend", async () => {
		const { provider, request } = fixture({
			scoped: false,
			modify: (result) => {
				result.scope = "audited-single-static-frame";
			},
		});
		await expect(provider.render({ request })).rejects.toThrow(
			/current live request/
		);
	});
	it("captures scope at registration, not a mutable backend reference", async () => {
		const { backend, provider, request } = fixture();
		backend.scope = undefined;
		expect((await provider.render({ request })).scope).toBe(
			"audited-single-static-frame"
		);
	});
	it.each([
		{
			id: "sampling-120",
			durationMs: null,
			unavailableReason: "native-stage-not-instrumented",
		},
		{ id: "detection", durationMs: null },
		{ id: "detection", durationMs: null, unavailableReason: "not-available" },
		{
			id: "detection",
			durationMs: 0,
			unavailableReason: "native-stage-not-instrumented",
		},
		{ id: "detection", durationMs: Number.NaN },
		{ id: "detection", durationMs: -1 },
	])("rejects invalid timing: %j", async (metric) => {
		const { provider, request } = fixture({
			modify: (result) => {
				result.stageMetrics = result.stageMetrics.map((row) =>
					row.id === metric.id ? (metric as BeautyLabCandidateStageMetric) : row
				);
			},
		});
		await expect(provider.render({ request })).rejects.toThrow(/stage metrics/);
	});
	it("rejects invented backend scopes", () => {
		const { backend } = fixture();
		expect(() =>
			createBeautyLabCandidateProvider({
				backend: {
					...backend,
					scope: "timeline",
				} as unknown as BeautyLabCandidateBackend,
			})
		).toThrow(/scope/);
	});
});

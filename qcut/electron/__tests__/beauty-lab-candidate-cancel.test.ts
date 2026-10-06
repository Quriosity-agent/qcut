// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	BEAUTY_LAB_CANDIDATE_STAGES,
	type BeautyLabCandidateRequest,
	type BeautyLabCandidateResult,
} from "../beauty-lab-candidate-contract.js";
import {
	createBeautyLabCandidateProvider,
	type BeautyLabCandidateBackend,
} from "../beauty-lab-candidate-provider.js";

type BackendRequest = Parameters<BeautyLabCandidateBackend["render"]>[0];

function makeRequest({
	requestId = "unit-request:1",
}: {
	requestId?: string;
} = {}): BeautyLabCandidateRequest {
	return {
		protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
		requestId,
		backendVersion: "unit-stub-v1",
		width: 1,
		height: 1,
		rgba: new Uint8Array([1, 2, 3, 255]),
		adjustments: { enabled: true, values: { face_adjust_eye: 40 } },
		sourceKey: "unit-media:clip-1",
		frameNumber: 3,
		timestampSeconds: 0.125,
	};
}

function makeResult({
	request,
}: {
	request: BackendRequest;
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
		nativeDependencies: [],
		stageMetrics: BEAUTY_LAB_CANDIDATE_STAGES.map((id) => ({
			id,
			durationMs: 1,
		})),
	};
}

function makeBackend() {
	let release = () => {};
	let rejectRender = (_error: Error) => {};
	const cancel = vi.fn(() =>
		rejectRender(new Error("Live candidate job cancelled"))
	);
	const render = vi.fn(
		(request: BackendRequest) =>
			new Promise<BeautyLabCandidateResult>((resolve, reject) => {
				release = () => resolve(makeResult({ request }));
				rejectRender = reject;
			})
	);
	const backend: BeautyLabCandidateBackend = {
		version: "unit-stub-v1",
		stages: BEAUTY_LAB_CANDIDATE_STAGES.map((id) => ({
			id,
			implementation: "qcut",
			parity: "accepted",
			message: "Synthetic unit stub; no runtime or parity evidence",
		})),
		render,
		cancel,
	};
	return { backend, cancel, render, release: () => release() };
}

describe("candidate cancellation is bound to the running request", () => {
	it("aborts the running request and lets its render settle", async () => {
		const { backend, cancel, render } = makeBackend();
		const provider = createBeautyLabCandidateProvider({ backend });
		const pending = provider.render({ request: makeRequest() });
		await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
		expect(
			provider.cancel({ request: { requestId: "unit-request:1" } })
		).toEqual({ cancelled: true });
		expect(cancel).toHaveBeenCalledOnce();
		await expect(pending).rejects.toThrow(/cancelled/);
		expect(provider.inspect().available).toBe(true);
	});
	it("never aborts a different request that is running now", async () => {
		const { backend, cancel, render, release } = makeBackend();
		const provider = createBeautyLabCandidateProvider({ backend });
		const pending = provider.render({ request: makeRequest() });
		await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
		expect(
			provider.cancel({ request: { requestId: "unit-request:stale" } })
		).toEqual({ cancelled: false });
		expect(cancel).not.toHaveBeenCalled();
		release();
		await expect(pending).resolves.toHaveProperty(
			"requestId",
			"unit-request:1"
		);
	});
	it("reports nothing to cancel once the render has settled", async () => {
		const { backend, cancel, render, release } = makeBackend();
		const provider = createBeautyLabCandidateProvider({ backend });
		const pending = provider.render({ request: makeRequest() });
		await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
		release();
		await pending;
		expect(
			provider.cancel({ request: { requestId: "unit-request:1" } })
		).toEqual({ cancelled: false });
		expect(cancel).not.toHaveBeenCalled();
	});
	it("reports nothing to cancel when the backend cannot cancel", async () => {
		const { backend, render, release } = makeBackend();
		const provider = createBeautyLabCandidateProvider({
			backend: { ...backend, cancel: undefined },
		});
		const pending = provider.render({ request: makeRequest() });
		await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
		expect(
			provider.cancel({ request: { requestId: "unit-request:1" } })
		).toEqual({ cancelled: false });
		release();
		await pending;
	});
	it("reports nothing to cancel without a backend", () => {
		const provider = createBeautyLabCandidateProvider();
		expect(
			provider.cancel({ request: { requestId: "unit-request:1" } })
		).toEqual({ cancelled: false });
	});
	it.each([
		undefined,
		null,
		"unit-request:1",
		[],
		{},
		{ requestId: 1 },
		{ requestId: "" },
		{ requestId: "bad id with spaces" },
		{ requestId: "x".repeat(129) },
		{ requestId: "unit-request:1", extra: true },
	])("rejects malformed cancellation %j", (request) => {
		const { backend } = makeBackend();
		const provider = createBeautyLabCandidateProvider({ backend });
		expect(() => provider.cancel({ request })).toThrow(/cancellation request/);
	});
	it("rejects a backend canceller that is not a function", () => {
		const { backend } = makeBackend();
		expect(() =>
			createBeautyLabCandidateProvider({
				backend: { ...backend, cancel: "yes" as unknown as () => void },
			})
		).toThrow(/canceller/);
	});
});

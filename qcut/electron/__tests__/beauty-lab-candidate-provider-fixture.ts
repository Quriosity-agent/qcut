import { vi } from "vitest";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	BEAUTY_LAB_CANDIDATE_STAGES,
	type BeautyLabCandidateRequest,
	type BeautyLabCandidateResult,
	type BeautyLabCandidateStage,
	type BeautyLabCandidateStageId,
} from "../beauty-lab/beauty-lab-candidate-contract.js";
import {
	createBeautyLabCandidateProvider,
	type BeautyLabCandidateBackend,
} from "../beauty-lab/beauty-lab-candidate-provider.js";

export type BackendRequest = Parameters<BeautyLabCandidateBackend["render"]>[0];

export function makeRequest({
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

export function makeStages({
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

export function makeResult({
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

export function fixture({
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

export function sparseCopy<T>({ values }: { values: T[] }): T[] {
	return Object.assign(
		new Array<T>(values.length),
		Object.fromEntries(
			values.slice(1).map((value, index) => [index + 1, value])
		)
	);
}

export function deferred<T>() {
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

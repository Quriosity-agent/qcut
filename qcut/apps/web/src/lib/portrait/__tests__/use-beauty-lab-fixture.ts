import { createHash } from "node:crypto";
import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { readComparisonImage } from "@/components/editor/media-panel/views/adjustments/filter-comparison-input";
import type {
	BeautyLabAPI,
	BeautyLabCandidateRequest,
	BeautyLabCandidateResult,
	BeautyLabCandidateStatus,
	BeautyLabResearchFrame,
	JianyingPortraitAdjustmentAPI,
	JianyingPortraitAdjustmentDetectResult,
	JianyingPortraitAdjustmentRenderResult,
	JianyingPortraitAdjustmentStatus,
	JianyingPortraitDetectedFace,
} from "@/types/electron";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
} from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { BEAUTY_LAB_CANDIDATE_STAGES } from "../../../../../../electron/beauty-lab/beauty-lab-candidate-contract";
import { captureJianyingPortraitDetectionFrame } from "../jianying-portrait-face-detection";
import { useBeautyLab } from "../use-beauty-lab";

export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

export function makeAdjustments(): MediaPortraitAdjustments {
	return {
		enabled: false,
		values: { face_adjust_Smooth: 30 },
		makeup: { lip: { cardId: "lip-1", intensity: 40 } },
		faceTarget: { mode: "single", faceId: 1 },
		faces: [
			{
				trackId: 1,
				personBindingId: "timeline-person",
				bindingAnchor: {
					rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
					frameNumber: 7,
				},
				values: { face_adjust_Smooth: 10 },
			},
		],
		manualRetouch: {
			strokes: [
				{
					id: "stroke",
					tool: "smooth",
					mode: "paint",
					size: 0.2,
					intensity: 0.5,
					points: [{ x: 0.2, y: 0.3 }],
				},
			],
		},
		manualBody: { stretch: { intensity: 20, upper: 0.2, bottom: 0.8 } },
	};
}

function makeFrame({ name = "input.png" }: { name?: string } = {}) {
	return {
		name,
		width: 1,
		height: 1,
		rgba: new Uint8Array([10, 20, 30, 255]),
		resized: false,
	};
}

export function makeCapture({
	timestampSeconds,
}: {
	timestampSeconds?: number;
} = {}) {
	return {
		source: {
			width: 1,
			height: 1,
			data: new Uint8ClampedArray([10, 20, 30, 255]),
			colorSpace: "srgb",
		} as ImageData,
		timestampSeconds,
	};
}

export function makeResearchFrame(): BeautyLabResearchFrame {
	return {
		caseId: "front-smile",
		frameIndex: 2,
		width: 1,
		height: 1,
		input: new Uint8Array([10, 20, 30, 255]),
		native: new Uint8Array([11, 21, 31, 255]),
		candidate: new Uint8Array([12, 22, 32, 255]),
		adjustments: { enabled: true, values: { face_adjust_Smooth: 65 } },
		source: "verified-offline-replay",
		sourceHashesVerified: true,
		nativeDependencies: true,
	};
}

export function makeCandidateResult({
	request,
}: {
	request: BeautyLabCandidateRequest;
}): BeautyLabCandidateResult {
	return {
		protocol: request.protocol,
		source: "live-candidate",
		backendId: BEAUTY_LAB_CANDIDATE_BACKEND,
		backendVersion: request.backendVersion,
		requestId: request.requestId,
		requestFingerprint: createHash("sha256")
			.update(JSON.stringify(request))
			.digest("hex"),
		inputSha256: createHash("sha256").update(request.rgba).digest("hex"),
		sourceKey: request.sourceKey,
		frameNumber: request.frameNumber,
		timestampSeconds: request.timestampSeconds,
		width: request.width,
		height: request.height,
		rgba: new Uint8Array([12, 22, 32, 255]),
		nativeDependencies: ["effect-rendering"],
		stageMetrics: BEAUTY_LAB_CANDIDATE_STAGES.map((id) => ({
			id,
			durationMs: 1,
		})),
	};
}

function makeFace({
	trackId,
}: {
	trackId: number;
}): JianyingPortraitDetectedFace {
	return {
		trackId,
		faceId: trackId,
		freidTrackId: trackId,
		personBindingId: `person-${trackId}`,
		bindingStatus: "new",
		rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.4 },
		score: 0.95,
		yaw: 0,
		pitch: 0,
		roll: 0,
		trackingCount: 0,
		landmarkCount: 106,
	};
}

export const ready: JianyingPortraitAdjustmentStatus = {
	state: "ready",
	message: "ready",
	provider: "jianying-local-swing-v1",
	available: true,
	offlineReady: true,
	catalog: [],
	packages: [],
	makeupCards: [],
};
export const nativeOutput: JianyingPortraitAdjustmentRenderResult = {
	provider: "jianying-local-swing-v1",
	width: 1,
	height: 1,
	rgba: new Uint8Array([11, 21, 31, 255]),
	activeGroups: [],
};
export const detection: JianyingPortraitAdjustmentDetectResult = {
	provider: "jianying-local-swing-v1",
	faces: [makeFace({ trackId: 1 }), makeFace({ trackId: 2 })],
	appliedFaceLimit: 1,
	unmatchedPersonBindingIds: [],
};
export const candidateUnavailable: BeautyLabCandidateStatus = {
	protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
	backendId: BEAUTY_LAB_CANDIDATE_BACKEND,
	backendVersion: null,
	state: "not-connected",
	available: false,
	blockers: ["arbitrary-frame-backend-not-connected"],
	stages: [],
};
export const candidateReady: BeautyLabCandidateStatus = {
	...candidateUnavailable,
	backendVersion: "test-only-stub-v1",
	state: "ready",
	available: true,
	blockers: [],
	stages: BEAUTY_LAB_CANDIDATE_STAGES.map((id) => ({
		id,
		implementation: id === "effect-rendering" ? "native" : "qcut",
		parity: "accepted",
		message: "Test-only protocol stub; not native parity evidence",
	})),
};
export const inspect = vi.fn<JianyingPortraitAdjustmentAPI["inspect"]>();
export const renderNative = vi.fn<JianyingPortraitAdjustmentAPI["render"]>();
export const detect = vi.fn<JianyingPortraitAdjustmentAPI["detect"]>();
export const list = vi.fn<BeautyLabAPI["listResearchCases"]>();
export const load = vi.fn<BeautyLabAPI["loadResearchFrame"]>();
export const inspectCandidate = vi.fn<BeautyLabAPI["inspectCandidate"]>();
export const renderCandidate = vi.fn<BeautyLabAPI["renderCandidate"]>();
const readImage = vi.mocked(readComparisonImage);
export const capture = vi.mocked(captureJianyingPortraitDetectionFrame);
const file = new File(["fixture"], "input.png", { type: "image/png" });
export const ASYNC_OPERATIONS = [
	{ operation: "import" },
	{ operation: "render" },
	{ operation: "research" },
	{ operation: "detect" },
	{ operation: "candidate" },
] as const;

export function pendingOperation({
	operation,
	lab,
}: {
	operation: (typeof ASYNC_OPERATIONS)[number]["operation"];
	lab: ReturnType<typeof useBeautyLab>;
}) {
	if (operation === "import") {
		const job = deferred<Awaited<ReturnType<typeof readComparisonImage>>>();
		readImage.mockReturnValueOnce(job.promise);
		return {
			start: () => lab.importImage({ file }),
			resolve: () => job.resolve(makeFrame({ name: "stale.png" })),
			reject: job.reject,
		};
	}
	if (operation === "render") {
		const job = deferred<JianyingPortraitAdjustmentRenderResult>();
		renderNative.mockReturnValueOnce(job.promise);
		return {
			start: () => lab.renderNative(),
			resolve: () => job.resolve(nativeOutput),
			reject: job.reject,
		};
	}
	if (operation === "research") {
		const job = deferred<BeautyLabResearchFrame>();
		load.mockReturnValueOnce(job.promise);
		return {
			start: () => lab.loadRecord({ caseId: "front-smile", frameIndex: 2 }),
			resolve: () => job.resolve(makeResearchFrame()),
			reject: job.reject,
		};
	}
	if (operation === "candidate") {
		const job = deferred<BeautyLabCandidateResult>();
		renderCandidate.mockReturnValueOnce(job.promise);
		return {
			start: () => lab.renderCandidate(),
			resolve: () =>
				job.resolve(
					makeCandidateResult({
						request: renderCandidate.mock.calls.at(-1)![0],
					})
				),
			reject: job.reject,
		};
	}
	const job = deferred<JianyingPortraitAdjustmentDetectResult>();
	detect.mockReturnValueOnce(job.promise);
	return {
		start: () => lab.detectFaces(),
		resolve: () => job.resolve(detection),
		reject: job.reject,
	};
}

export async function mountLab({
	initialAdjustments = makeAdjustments(),
}: {
	initialAdjustments?: MediaPortraitAdjustments;
} = {}) {
	const view = renderHook(useBeautyLab, {
		initialProps: { elementId: "clip-1", currentFrame: 7, initialAdjustments },
	});
	await act(async () => {
		await Promise.resolve();
	});
	return view;
}

export async function importInput({
	result,
}: {
	result: { current: ReturnType<typeof useBeautyLab> };
}) {
	await act(async () => {
		await result.current.importImage({ file });
	});
}

/** Restores every renderer bridge stub to its default resolved value. */
export function resetBeautyLabMocks() {
	inspect.mockReset().mockResolvedValue(ready);
	renderNative.mockReset().mockResolvedValue(nativeOutput);
	detect.mockReset().mockResolvedValue(detection);
	list
		.mockReset()
		.mockResolvedValue([
			{ id: "front-smile", name: "Front smile", frameCount: 7 },
		]);
	load.mockReset().mockResolvedValue(makeResearchFrame());
	inspectCandidate.mockReset().mockResolvedValue(candidateUnavailable);
	renderCandidate
		.mockReset()
		.mockImplementation(async (request) => makeCandidateResult({ request }));
	readImage.mockReset().mockResolvedValue(makeFrame());
	capture.mockReset().mockReturnValue(makeCapture());
	vi.stubGlobal("electronAPI", {
		jianyingPortraitAdjustment: { inspect, render: renderNative, detect },
		beautyLab: {
			listResearchCases: list,
			loadResearchFrame: load,
			inspectCandidate,
			renderCandidate,
		} satisfies BeautyLabAPI,
	});
}

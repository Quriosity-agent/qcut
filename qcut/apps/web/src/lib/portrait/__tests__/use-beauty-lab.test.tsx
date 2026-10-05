import { createHash } from "node:crypto";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { BEAUTY_LAB_CANDIDATE_STAGES } from "../../../../../../electron/beauty-lab-candidate-contract";
import { captureJianyingPortraitDetectionFrame } from "../jianying-portrait-face-detection";
import { useBeautyLab } from "../use-beauty-lab";

vi.mock(
	"@/components/editor/media-panel/views/adjustments/filter-comparison-input",
	() => ({ readComparisonImage: vi.fn() })
);
vi.mock("../jianying-portrait-face-detection", () => ({
	captureJianyingPortraitDetectionFrame: vi.fn(),
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function makeAdjustments(): MediaPortraitAdjustments {
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

function makeCapture({ timestampSeconds }: { timestampSeconds?: number } = {}) {
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

function makeResearchFrame(): BeautyLabResearchFrame {
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

function makeCandidateResult({
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

const ready: JianyingPortraitAdjustmentStatus = {
	state: "ready",
	message: "ready",
	provider: "jianying-local-swing-v1",
	available: true,
	offlineReady: true,
	catalog: [],
	packages: [],
	makeupCards: [],
};
const nativeOutput: JianyingPortraitAdjustmentRenderResult = {
	provider: "jianying-local-swing-v1",
	width: 1,
	height: 1,
	rgba: new Uint8Array([11, 21, 31, 255]),
	activeGroups: [],
};
const detection: JianyingPortraitAdjustmentDetectResult = {
	provider: "jianying-local-swing-v1",
	faces: [makeFace({ trackId: 1 }), makeFace({ trackId: 2 })],
	appliedFaceLimit: 1,
	unmatchedPersonBindingIds: [],
};
const candidateUnavailable: BeautyLabCandidateStatus = {
	protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
	backendId: BEAUTY_LAB_CANDIDATE_BACKEND,
	backendVersion: null,
	state: "not-connected",
	available: false,
	blockers: ["arbitrary-frame-backend-not-connected"],
	stages: [],
};
const candidateReady: BeautyLabCandidateStatus = {
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
const inspect = vi.fn<JianyingPortraitAdjustmentAPI["inspect"]>();
const renderNative = vi.fn<JianyingPortraitAdjustmentAPI["render"]>();
const detect = vi.fn<JianyingPortraitAdjustmentAPI["detect"]>();
const list = vi.fn<BeautyLabAPI["listResearchCases"]>();
const load = vi.fn<BeautyLabAPI["loadResearchFrame"]>();
const inspectCandidate = vi.fn<BeautyLabAPI["inspectCandidate"]>();
const renderCandidate = vi.fn<BeautyLabAPI["renderCandidate"]>();
const readImage = vi.mocked(readComparisonImage);
const capture = vi.mocked(captureJianyingPortraitDetectionFrame);
const file = new File(["fixture"], "input.png", { type: "image/png" });
const ASYNC_OPERATIONS = [
	{ operation: "import" },
	{ operation: "render" },
	{ operation: "research" },
	{ operation: "detect" },
	{ operation: "candidate" },
] as const;

function pendingOperation({
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

async function mountLab({
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

async function importInput({
	result,
}: {
	result: { current: ReturnType<typeof useBeautyLab> };
}) {
	await act(async () => {
		await result.current.importImage({ file });
	});
}

beforeEach(() => {
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
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("useBeautyLab draft and provenance", () => {
	it.each([
		"7408757645705776384",
		null,
	] as const)("preserves global skin selection %j in the isolated draft", async (skinToneResourceId) => {
		const initial = { ...makeAdjustments(), skinToneResourceId };
		const { result } = await mountLab({ initialAdjustments: initial });
		expect(result.current.adjustments.skinToneResourceId).toBe(
			skinToneResourceId
		);
		expect(result.current.adjustments.faces).toBeUndefined();
	});
	it("deeply isolates the enabled draft and does not mutate initial or incoming parameters", async () => {
		const initial = makeAdjustments();
		const snapshot = structuredClone(initial);
		const { result } = await mountLab({ initialAdjustments: initial });
		expect(result.current.adjustments).toEqual({
			enabled: true,
			values: initial.values,
			makeup: initial.makeup,
		});
		expect(result.current.adjustments.values).not.toBe(initial.values);
		expect(result.current.adjustments.makeup?.lip).not.toBe(
			initial.makeup?.lip
		);
		expect(result.current.adjustments.faces).toBeUndefined();
		expect(result.current.adjustments.faceTarget).toBeUndefined();
		expect(result.current.adjustments.manualRetouch).toBeUndefined();
		expect(result.current.adjustments.manualBody).toBeUndefined();
		const incoming: MediaPortraitAdjustments = {
			enabled: true,
			values: { face_adjust_Smooth: 30 },
			makeup: { lip: { cardId: "lip-1", intensity: 40 } },
		};
		act(() => {
			result.current.changeAdjustments(incoming);
		});
		incoming.values.face_adjust_Smooth = 99;
		incoming.makeup!.lip!.intensity = 99;
		expect(result.current.adjustments.values.face_adjust_Smooth).toBe(30);
		expect(result.current.adjustments.makeup?.lip?.intensity).toBe(40);
		expect(initial).toEqual(snapshot);
	});

	it.each([
		{ source: "import" },
		{ source: "capture" },
	])("resets face targeting and detections for a new $source without changing global parameters", async ({
		source,
	}) => {
		const { result } = await mountLab();
		await importInput({ result });
		await act(async () => {
			await result.current.detectFaces();
		});
		expect(result.current.faces).toHaveLength(1);
		const targeted: MediaPortraitAdjustments = {
			...result.current.adjustments,
			faceTarget: { mode: "single", faceId: 1 },
			faces: makeAdjustments().faces,
		};
		const snapshot = structuredClone(targeted);
		act(() => {
			result.current.changeAdjustments(targeted);
		});
		await act(async () => {
			await result.current.renderNative();
		});
		expect(result.current.native).not.toBeNull();
		if (source === "import") await importInput({ result });
		if (source === "capture")
			act(() => {
				result.current.captureFrame();
			});
		expect(result.current.adjustments.faceTarget).toEqual({ mode: "all" });
		expect(result.current.adjustments.faces).toBeUndefined();
		expect(result.current.adjustments.values).toEqual(targeted.values);
		expect(result.current.adjustments.makeup).toEqual(targeted.makeup);
		expect(result.current.faces).toEqual([]);
		expect(result.current.native).toBeNull();
		expect(result.current.candidate).toBeNull();
		expect(result.current.candidateStatus).toEqual(candidateUnavailable);
		expect(result.current.candidateReport).toBeNull();
		expect(targeted).toEqual(snapshot);
	});

	it("inspects runtime and lists records once without fabricating input or candidates", async () => {
		const { result, rerender } = await mountLab();
		expect(result.current.status).toEqual(ready);
		expect(result.current.cases[0].id).toBe("front-smile");
		expect(result.current.input).toBeNull();
		expect(result.current.candidate).toBeNull();
		rerender({
			elementId: "clip-1",
			currentFrame: 8,
			initialAdjustments: makeAdjustments(),
		});
		expect(inspect).toHaveBeenCalledTimes(1);
		expect(list).toHaveBeenCalledTimes(1);
		expect(inspectCandidate).toHaveBeenCalledTimes(1);
	});

	it("renders exact dimensions and cloned parameters, leaving arbitrary-frame candidate absent", async () => {
		const { result } = await mountLab();
		await importInput({ result });
		const parameters = result.current.adjustments;
		await act(async () => {
			await result.current.renderNative();
		});
		const request = renderNative.mock.calls[0][0];
		expect(request).toMatchObject({
			width: 1,
			height: 1,
			rgba: result.current.input!.rgba,
			adjustments: parameters,
			frameNumber: 0,
			timestampSeconds: 0,
			sourceKey: expect.stringMatching(/^beauty-lab:/),
		});
		expect(request.adjustments).not.toBe(parameters);
		expect(request.adjustments.values).not.toBe(parameters.values);
		expect(result.current.native?.rgba).toEqual(nativeOutput.rgba);
		expect(result.current.candidate).toBeNull();
		expect(result.current.busy).toBeNull();
		request.adjustments.values.face_adjust_Smooth = 100;
		expect(result.current.adjustments.values.face_adjust_Smooth).toBe(30);
	});

	it.each([
		{ change: "provider", value: "untrusted-renderer" },
		{ change: "width", value: 2 },
		{ change: "height", value: 2 },
		{ change: "rgba", value: new Uint8Array(3) },
	])("rejects invalid native $change", async ({ change, value }) => {
		renderNative.mockResolvedValue({
			...nativeOutput,
			[change]: value,
		} as unknown as JianyingPortraitAdjustmentRenderResult);
		const { result } = await mountLab();
		await importInput({ result });
		await act(async () => {
			await result.current.renderNative();
		});
		expect(result.current.native).toBeNull();
		expect(result.current.candidate).toBeNull();
		expect(result.current.error).toBeTruthy();
		expect(result.current.busy).toBeNull();
	});

	it("keeps research parameters locked and resets the isolated draft when leaving", async () => {
		const initial = makeAdjustments();
		const snapshot = structuredClone(initial);
		const replay = makeResearchFrame();
		load.mockResolvedValue(replay);
		const { result } = await mountLab({ initialAdjustments: initial });
		await act(async () => {
			await result.current.loadRecord({ caseId: "front-smile", frameIndex: 2 });
		});
		expect(result.current.record).toEqual({
			caseId: "front-smile",
			frameIndex: 2,
		});
		expect(result.current.candidate?.rgba).toEqual(replay.candidate);
		expect(result.current.adjustments).toEqual(replay.adjustments);
		expect(result.current.adjustments).not.toBe(replay.adjustments);
		act(() => {
			result.current.changeAdjustments({
				enabled: true,
				values: { face_adjust_Smooth: 100 },
			});
		});
		await act(async () => {
			await Promise.all([
				result.current.renderNative(),
				result.current.detectFaces(),
			]);
		});
		expect(result.current.adjustments.values.face_adjust_Smooth).toBe(65);
		expect(renderNative).not.toHaveBeenCalled();
		expect(detect).not.toHaveBeenCalled();
		act(() => {
			result.current.leaveRecord();
		});
		expect(result.current.record).toBeNull();
		expect(result.current.input).toBeNull();
		expect(result.current.native).toBeNull();
		expect(result.current.candidate).toBeNull();
		expect(result.current.adjustments).toEqual({
			enabled: true,
			values: initial.values,
			makeup: initial.makeup,
		});
		expect(initial).toEqual(snapshot);
	});

	it.each([
		{ source: "import" },
		{ source: "capture" },
	])("restores the timeline draft when $source replaces locked probe values", async ({
		source,
	}) => {
		const initial = makeAdjustments();
		initial.values.face_adjust_eye = 40;
		const snapshot = structuredClone(initial);
		const replay = makeResearchFrame();
		replay.adjustments = {
			enabled: true,
			values: { face_adjust_eye: 100 },
		};
		load.mockResolvedValue(replay);
		const { result } = await mountLab({ initialAdjustments: initial });
		await act(async () => {
			await result.current.loadRecord({ caseId: "front-smile", frameIndex: 2 });
		});
		expect(result.current.adjustments.values.face_adjust_eye).toBe(100);
		if (source === "import") await importInput({ result });
		if (source === "capture") act(() => result.current.captureFrame());
		expect(result.current.record).toBeNull();
		expect(result.current.native).toBeNull();
		expect(result.current.candidate).toBeNull();
		expect(result.current.adjustments).toEqual({
			enabled: true,
			values: initial.values,
			makeup: initial.makeup,
			faceTarget: { mode: "all" },
			faces: undefined,
		});
		expect(result.current.adjustments.values).not.toBe(initial.values);
		expect(result.current.adjustments.makeup).not.toBe(initial.makeup);
		await act(async () => {
			await result.current.renderNative();
		});
		expect(renderNative.mock.calls[0][0].adjustments).toEqual(
			result.current.adjustments
		);
		expect(initial).toEqual(snapshot);
		expect(replay.adjustments.values.face_adjust_eye).toBe(100);
	});

	it.each([
		{ field: "source", value: "native-live" },
		{ field: "sourceHashesVerified", value: false },
		{ field: "nativeDependencies", value: false },
		{ field: "caseId", value: "other-case" },
		{ field: "frameIndex", value: 3 },
		{ field: "width", value: 4097 },
		{ field: "native", value: new Uint8Array(3) },
		{ field: "candidate", value: new Uint8Array(3) },
	])("rejects research data with invalid $field", async ({ field, value }) => {
		load.mockResolvedValue({
			...makeResearchFrame(),
			[field]: value,
		} as unknown as BeautyLabResearchFrame);
		const { result } = await mountLab();
		await act(async () => {
			await result.current.loadRecord({ caseId: "front-smile", frameIndex: 2 });
		});
		expect(result.current.record).toBeNull();
		expect(result.current.native).toBeNull();
		expect(result.current.candidate).toBeNull();
		expect(result.current.error).toBeTruthy();
	});

	it("uses the same source key for detection and render, rotating it for a new input", async () => {
		const { result } = await mountLab();
		await importInput({ result });
		await act(async () => {
			await result.current.detectFaces();
		});
		expect(result.current.faces).toEqual([detection.faces[0]]);
		await act(async () => {
			await result.current.renderNative();
		});
		expect(detect.mock.calls[0][0].sourceKey).toBe(
			renderNative.mock.calls[0][0].sourceKey
		);
		await importInput({ result });
		expect(result.current.faces).toEqual([]);
		await act(async () => {
			await result.current.detectFaces();
		});
		expect(detect.mock.calls[1][0].sourceKey).not.toBe(
			detect.mock.calls[0][0].sourceKey
		);
	});

	it("invalidates captured pixels on seek/source changes but preserves imported images", async () => {
		const { result, rerender } = await mountLab();
		act(() => {
			result.current.captureFrame();
		});
		expect(result.current.input?.name).toBe("Frame 7");
		rerender({
			elementId: "clip-1",
			currentFrame: 8,
			initialAdjustments: makeAdjustments(),
		});
		expect(result.current.input).toBeNull();
		act(() => {
			result.current.captureFrame();
		});
		rerender({
			elementId: "clip-2",
			currentFrame: 8,
			initialAdjustments: makeAdjustments(),
		});
		expect(result.current.input).toBeNull();
		await importInput({ result });
		const imported = result.current.input;
		rerender({
			elementId: "clip-3",
			currentFrame: 9,
			initialAdjustments: makeAdjustments(),
		});
		expect(result.current.input).toBe(imported);
	});

	it("reports an undecoded capture and disables native actions when unavailable", async () => {
		inspect.mockResolvedValue({ ...ready, available: false });
		capture.mockReturnValue(null);
		const { result } = await mountLab();
		act(() => {
			result.current.captureFrame();
		});
		expect(result.current.error).toContain("No decoded source frame");
		await importInput({ result });
		await act(async () => {
			await Promise.all([
				result.current.renderNative(),
				result.current.detectFaces(),
			]);
		});
		expect(renderNative).not.toHaveBeenCalled();
		expect(detect).not.toHaveBeenCalled();
	});
});

describe("useBeautyLab live candidate protocol with test-only stubs", () => {
	it.each([
		{ state: "not-connected", status: candidateUnavailable },
		{
			state: "blocked",
			status: {
				...candidateReady,
				state: "blocked",
				available: false,
			} as const,
		},
		{
			state: "missing version",
			status: { ...candidateReady, backendVersion: null },
		},
	])("does not call a candidate renderer when $state", async ({ status }) => {
		inspectCandidate.mockResolvedValue(status);
		const { result } = await mountLab();
		await importInput({ result });
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(result.current.candidateStatus).toEqual(status);
		expect(renderCandidate).not.toHaveBeenCalled();
		expect(result.current.candidate).toBeNull();
		expect(result.current.candidateReport).toBeNull();
		expect(result.current.busy).toBeNull();
		expect(result.current.error).toBeNull();
	});

	it.each([
		{ missing: "desktop", api: undefined },
		{ missing: "beautyLab", api: {} },
		{
			missing: "candidate methods",
			api: { beautyLab: { listResearchCases: list, loadResearchFrame: load } },
		},
	])("cannot render without the $missing API", async ({ api }) => {
		vi.stubGlobal("electronAPI", api);
		const { result } = await mountLab();
		await importInput({ result });
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(inspectCandidate).not.toHaveBeenCalled();
		expect(renderCandidate).not.toHaveBeenCalled();
		expect(result.current.candidateStatus).toBeNull();
		expect(result.current.candidateReport).toBeNull();
		expect(result.current.busy).toBeNull();
	});

	it("reports a missing renderer after a successful inspection without fabricating a candidate", async () => {
		inspectCandidate.mockResolvedValue(candidateReady);
		vi.stubGlobal("electronAPI", {
			beautyLab: {
				listResearchCases: list,
				loadResearchFrame: load,
				inspectCandidate,
			},
		});
		const { result } = await mountLab();
		await importInput({ result });
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(renderCandidate).not.toHaveBeenCalled();
		expect(result.current.error).toContain("requires QCut Desktop");
		expect(result.current.candidateReport).toBeNull();
		expect(result.current.busy).toBeNull();
	});

	it("reports candidate inspection failure and leaves inference unavailable", async () => {
		inspectCandidate.mockRejectedValue(
			new Error("candidate inspection failed")
		);
		const { result } = await mountLab();
		expect(result.current.error).toContain("candidate inspection failed");
		await importInput({ result });
		// Import clears operation errors; inspection failure must still leave the gate closed.
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(result.current.candidateStatus).toBeNull();
		expect(renderCandidate).not.toHaveBeenCalled();
	});

	it("requires input, idle state and a non-record input even for an accepted stub", async () => {
		inspectCandidate.mockResolvedValue(candidateReady);
		const { result } = await mountLab();
		await act(async () => {
			await result.current.renderCandidate();
		});
		await importInput({ result });
		const job = pendingOperation({ operation: "detect", lab: result.current });
		let pending!: Promise<void>;
		act(() => {
			pending = job.start();
		});
		await act(async () => {
			await result.current.renderCandidate();
			job.resolve();
			await pending;
			await result.current.loadRecord({ caseId: "front-smile", frameIndex: 2 });
		});
		const replay = result.current;
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(result.current).toBe(replay);
		expect(result.current.candidateReport).toBeNull();
		expect(renderCandidate).not.toHaveBeenCalled();
	});

	it.each([
		{ inspectionFails: false },
		{ inspectionFails: true },
	])("disables failed candidate retries after readiness refresh (inspectionFails=$inspectionFails)", async ({
		inspectionFails,
	}) => {
		inspectCandidate.mockResolvedValue(candidateReady);
		const { result } = await mountLab();
		await importInput({ result });
		await act(async () => {
			await result.current.renderNative();
		});
		const native = result.current.native;
		const blocked: BeautyLabCandidateStatus = {
			...candidateReady,
			available: false,
			state: "blocked",
			blockers: ["cleanup-unconfirmed-restart-required"],
		};
		if (inspectionFails)
			inspectCandidate.mockRejectedValue(new Error("IPC unavailable"));
		else inspectCandidate.mockResolvedValue(blocked);
		renderCandidate.mockRejectedValue(new Error("cleanup unconfirmed"));
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(result.current.candidateStatus).toEqual(
			inspectionFails ? null : blocked
		);
		expect(result.current.candidate).toBeNull();
		expect(result.current.candidateReport).toBeNull();
		expect(result.current.native).toBe(native);
		expect(result.current.error).toContain("cleanup unconfirmed");
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(renderCandidate).toHaveBeenCalledTimes(1);
	});

	it("binds the request to current imported pixels, parameters and version while preserving the native baseline", async () => {
		inspectCandidate.mockResolvedValue(candidateReady);
		const { result } = await mountLab();
		await importInput({ result });
		act(() => {
			result.current.changeAdjustments({
				...result.current.adjustments,
				values: { face_adjust_Smooth: 80 },
			});
		});
		await act(async () => {
			await result.current.renderNative();
		});
		const baseline = result.current.native;
		const original = result.current.input!;
		const parameters = result.current.adjustments;
		await act(async () => {
			await result.current.renderCandidate();
		});
		const request = renderCandidate.mock.calls[0][0];
		expect(request).toEqual({
			protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
			requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
			backendVersion: "test-only-stub-v1",
			width: original.width,
			height: original.height,
			rgba: original.rgba,
			adjustments: parameters,
			sourceKey: renderNative.mock.calls[0][0].sourceKey,
			frameNumber: 0,
			timestampSeconds: 0,
		});
		expect(request.rgba).not.toBe(original.rgba);
		expect(request.adjustments).not.toBe(parameters);
		expect(request.adjustments.values).not.toBe(parameters.values);
		expect(request.adjustments.makeup?.lip).not.toBe(parameters.makeup?.lip);
		expect(result.current.native).toBe(baseline);
		expect(result.current.candidate).toMatchObject({
			name: "Live candidate",
			rgba: new Uint8Array([12, 22, 32, 255]),
		});
		expect(result.current.candidateReport).toEqual(
			makeCandidateResult({ request })
		);
		expect(result.current.record).toBeNull();
		expect(result.current.busy).toBeNull();
		expect(result.current.error).toBeNull();
		request.rgba[0] = 99;
		request.adjustments.values.face_adjust_Smooth = 99;
		request.adjustments.makeup!.lip!.intensity = 99;
		expect(original.rgba[0]).toBe(10);
		expect(parameters.values.face_adjust_Smooth).toBe(80);
		expect(parameters.makeup?.lip?.intensity).toBe(40);
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(renderCandidate.mock.calls[1][0].requestId).not.toBe(
			request.requestId
		);
		expect(renderCandidate.mock.calls[1][0].sourceKey).toBe(request.sourceKey);
		expect(result.current.native).toBe(baseline);
	});

	it.each([
		{ field: "protocol", value: "unknown-protocol" },
		{ field: "backendId", value: "untrusted-provider" },
		{ field: "backendVersion", value: "other-version" },
		{ field: "requestId", value: "other-request" },
		{ field: "sourceKey", value: "other-source" },
		{ field: "frameNumber", value: 7 },
		{ field: "timestampSeconds", value: 0.5 },
		{ field: "source", value: "verified-offline-replay" },
		{ field: "source", value: "native-live" },
		{ field: "width", value: 2 },
		{ field: "height", value: 2 },
		{ field: "rgba", value: new Uint8Array(3) },
		{ field: "rgba", value: [12, 22, 32, 255] },
	])("rejects candidate $field=$value without losing the native baseline", async ({
		field,
		value,
	}) => {
		inspectCandidate.mockResolvedValue(candidateReady);
		renderCandidate.mockImplementation(
			async (request) =>
				({
					...makeCandidateResult({ request }),
					[field]: value,
				}) as unknown as BeautyLabCandidateResult
		);
		const { result } = await mountLab();
		await importInput({ result });
		await act(async () => {
			await result.current.renderNative();
		});
		const baseline = result.current.native;
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(result.current.native).toBe(baseline);
		expect(result.current.candidate).toBeNull();
		expect(result.current.candidateReport).toBeNull();
		expect(result.current.error).toBeTruthy();
		expect(result.current.busy).toBeNull();
	});

	it("clears an earlier candidate and report on inference failure but retains native pixels", async () => {
		inspectCandidate.mockResolvedValue(candidateReady);
		const { result } = await mountLab();
		await importInput({ result });
		await act(async () => {
			await result.current.renderNative();
		});
		const baseline = result.current.native;
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(result.current.candidateReport).not.toBeNull();
		renderCandidate.mockRejectedValueOnce(new Error("inference failed"));
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(result.current.native).toBe(baseline);
		expect(result.current.candidate).toBeNull();
		expect(result.current.candidateReport).toBeNull();
		expect(result.current.error).toContain("inference failed");
		expect(result.current.busy).toBeNull();
	});

	it.each([
		{ invalidation: "params" },
		{ invalidation: "capture" },
		{ invalidation: "record" },
		{ invalidation: "native" },
	])("clears completed live provenance on $invalidation replacement", async ({
		invalidation,
	}) => {
		inspectCandidate.mockResolvedValue(candidateReady);
		const { result } = await mountLab();
		await importInput({ result });
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(result.current.candidateReport).not.toBeNull();
		if (invalidation === "params") {
			act(() =>
				result.current.changeAdjustments({
					enabled: true,
					values: { face_adjust_Smooth: 80 },
				})
			);
		}
		if (invalidation === "capture") act(() => result.current.captureFrame());
		if (invalidation === "record") {
			await act(async () => {
				await result.current.loadRecord({
					caseId: "front-smile",
					frameIndex: 2,
				});
			});
			expect(result.current.candidate?.name).toBe("Verified offline replay");
		}
		if (invalidation === "native") {
			await act(async () => {
				await result.current.renderNative();
			});
			expect(result.current.native?.rgba).toEqual(nativeOutput.rgba);
		}
		if (invalidation !== "record") expect(result.current.candidate).toBeNull();
		expect(result.current.candidateReport).toBeNull();
		expect(result.current.busy).toBeNull();
		expect(result.current.error).toBeNull();
	});

	it.each([
		{ timestampSeconds: undefined },
		{ timestampSeconds: -1 },
		{ timestampSeconds: Number.NaN },
		{ timestampSeconds: Number.POSITIVE_INFINITY },
	])("cannot run candidate inference for an unknown capture clock $timestampSeconds", async ({
		timestampSeconds,
	}) => {
		inspectCandidate.mockResolvedValue(candidateReady);
		capture.mockReturnValue(makeCapture({ timestampSeconds }));
		const { result } = await mountLab();
		act(() => result.current.captureFrame());
		expect(result.current.input?.name).toBe("Frame 7");
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(renderCandidate).not.toHaveBeenCalled();
		expect(result.current.error).toContain("known source timestamp");
		expect(result.current.candidateReport).toBeNull();
		expect(result.current.busy).toBeNull();
	});

	it.each([
		{ timestampSeconds: 0 },
		{ timestampSeconds: 13.75 },
	])("passes captured source time $timestampSeconds to native and candidate, resetting imports to frame zero", async ({
		timestampSeconds,
	}) => {
		inspectCandidate.mockResolvedValue(candidateReady);
		capture.mockReturnValue(makeCapture({ timestampSeconds }));
		const { result } = await mountLab();
		act(() => result.current.captureFrame());
		await act(async () => {
			await result.current.renderNative();
		});
		const baseline = result.current.native;
		await act(async () => {
			await result.current.renderCandidate();
		});
		const nativeRequest = renderNative.mock.calls[0][0];
		const candidateRequest = renderCandidate.mock.calls[0][0];
		for (const request of [nativeRequest, candidateRequest]) {
			expect(request).toMatchObject({ frameNumber: 7, timestampSeconds });
		}
		expect(candidateRequest.sourceKey).toBe(nativeRequest.sourceKey);
		expect(result.current.native).toBe(baseline);
		expect(result.current.candidateReport).toMatchObject({
			frameNumber: 7,
			timestampSeconds,
		});
		await importInput({ result });
		expect(result.current.candidateReport).toBeNull();
		await act(async () => {
			await result.current.renderNative();
		});
		await act(async () => {
			await result.current.renderCandidate();
		});
		for (const request of [
			renderNative.mock.calls[1][0],
			renderCandidate.mock.calls[1][0],
		]) {
			expect(request).toMatchObject({ frameNumber: 0, timestampSeconds: 0 });
			expect(request.sourceKey).not.toBe(candidateRequest.sourceKey);
		}
	});
});

// Hook actions are recreated each render; a stale candidate settle may only clear
// the pending marker, so compare the lab's data rather than the returned object.
const LAB_DATA = [
	"status",
	"candidateStatus",
	"candidateReport",
	"cases",
	"adjustments",
	"input",
	"native",
	"candidate",
	"faces",
	"record",
	"busy",
	"error",
] as const;

function expectStaleCandidateSettled({
	before,
	after,
}: {
	before: ReturnType<typeof useBeautyLab>;
	after: ReturnType<typeof useBeautyLab>;
}) {
	expect(before.candidateJob).toMatchObject({ cancelling: false });
	expect(after.candidateJob).toBeNull();
	for (const key of LAB_DATA) expect(after[key]).toBe(before[key]);
}

describe("useBeautyLab async revisions and cleanup", () => {
	it.each(
		ASYNC_OPERATIONS.flatMap(({ operation }) => [
			{ operation, outcome: "resolve" },
			{ operation, outcome: "reject" },
		])
	)("ignores stale $operation $outcome after invalidation", async ({
		operation,
		outcome,
	}) => {
		inspectCandidate.mockResolvedValue(candidateReady);
		const { result } = await mountLab();
		await importInput({ result });
		const job = pendingOperation({ operation, lab: result.current });
		let pending!: Promise<void>;
		act(() => {
			pending = job.start();
		});
		if (operation === "render" || operation === "candidate") {
			act(() => {
				result.current.changeAdjustments({
					enabled: true,
					values: { face_adjust_Smooth: 80 },
				});
			});
		} else {
			await importInput({ result });
		}
		const latest = result.current;
		await act(async () => {
			if (outcome === "resolve") job.resolve();
			if (outcome === "reject") job.reject(new Error(`stale ${operation}`));
			await pending;
		});
		if (operation === "candidate")
			expectStaleCandidateSettled({ before: latest, after: result.current });
		else expect(result.current).toBe(latest);
		expect(result.current.native).toBeNull();
		expect(result.current.candidate).toBeNull();
		expect(result.current.candidateReport).toBeNull();
		expect(result.current.record).toBeNull();
		expect(result.current.faces).toEqual([]);
		expect(result.current.error).toBeNull();
		expect(result.current.busy).toBeNull();
	});

	it.each(
		ASYNC_OPERATIONS.flatMap(({ operation }) => [
			{ operation, outcome: "resolve" },
			{ operation, outcome: "reject" },
		])
	)("ignores pending $operation $outcome after unmount", async ({
		operation,
		outcome,
	}) => {
		inspectCandidate.mockResolvedValue(candidateReady);
		const { result, unmount } = await mountLab();
		await importInput({ result });
		const job = pendingOperation({ operation, lab: result.current });
		let pending!: Promise<void>;
		act(() => {
			pending = job.start();
		});
		const beforeUnmount = result.current;
		unmount();
		await act(async () => {
			if (outcome === "resolve") job.resolve();
			if (outcome === "reject") job.reject(new Error("unmounted"));
			await pending;
		});
		expect(result.current).toBe(beforeUnmount);
	});

	it.each(
		["params", "import", "seek", "source"].flatMap((invalidation) => [
			{ invalidation, outcome: "resolve" },
			{ invalidation, outcome: "reject" },
		])
	)("ignores candidate $outcome after $invalidation invalidation", async ({
		invalidation,
		outcome,
	}) => {
		inspectCandidate.mockResolvedValue(candidateReady);
		capture.mockReturnValue(makeCapture({ timestampSeconds: 13.75 }));
		const { result, rerender } = await mountLab();
		act(() => result.current.captureFrame());
		await act(async () => {
			await result.current.renderNative();
		});
		const job = pendingOperation({
			operation: "candidate",
			lab: result.current,
		});
		let pending!: Promise<void>;
		act(() => {
			pending = job.start();
		});
		expect(result.current.busy).toBe("candidate");
		if (invalidation === "params") {
			act(() =>
				result.current.changeAdjustments({
					enabled: true,
					values: { face_adjust_Smooth: 80 },
				})
			);
		}
		if (invalidation === "import") await importInput({ result });
		if (invalidation === "seek" || invalidation === "source") {
			rerender({
				elementId: invalidation === "source" ? "clip-2" : "clip-1",
				currentFrame: invalidation === "seek" ? 8 : 7,
				initialAdjustments: makeAdjustments(),
			});
			expect(result.current.input).toBeNull();
		}
		const latest = result.current;
		await act(async () => {
			if (outcome === "resolve") job.resolve();
			if (outcome === "reject") job.reject(new Error("stale candidate"));
			await pending;
		});
		expectStaleCandidateSettled({ before: latest, after: result.current });
		expect(result.current.native).toBeNull();
		expect(result.current.candidate).toBeNull();
		expect(result.current.candidateReport).toBeNull();
		expect(result.current.error).toBeNull();
		expect(result.current.busy).toBeNull();
	});

	it.each([
		{ outcome: "resolve" },
		{ outcome: "reject" },
	])("ignores runtime, catalog and candidate inspection $outcome after cleanup", async ({
		outcome,
	}) => {
		const runtime = deferred<JianyingPortraitAdjustmentStatus>();
		const catalog =
			deferred<Awaited<ReturnType<BeautyLabAPI["listResearchCases"]>>>();
		const candidateInspection = deferred<BeautyLabCandidateStatus>();
		inspect.mockReturnValue(runtime.promise);
		list.mockReturnValue(catalog.promise);
		inspectCandidate.mockReturnValue(candidateInspection.promise);
		const { result, unmount } = await mountLab();
		const previous = result.current;
		unmount();
		await act(async () => {
			if (outcome === "resolve") {
				runtime.resolve(ready);
				catalog.resolve([
					{ id: "front-smile", name: "Front smile", frameCount: 7 },
				]);
				candidateInspection.resolve(candidateReady);
			}
			if (outcome === "reject") {
				runtime.reject(new Error("stale inspection"));
				catalog.reject(new Error("stale list"));
				candidateInspection.reject(new Error("stale candidate inspection"));
			}
			await Promise.resolve();
		});
		expect(result.current).toBe(previous);
	});
});

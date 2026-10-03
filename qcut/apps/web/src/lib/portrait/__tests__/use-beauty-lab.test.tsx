import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readComparisonImage } from "@/components/editor/media-panel/views/adjustments/filter-comparison-input";
import type {
	BeautyLabAPI,
	BeautyLabResearchFrame,
	JianyingPortraitAdjustmentAPI,
	JianyingPortraitAdjustmentDetectResult,
	JianyingPortraitAdjustmentRenderResult,
	JianyingPortraitAdjustmentStatus,
	JianyingPortraitDetectedFace,
} from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
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
const inspect = vi.fn<JianyingPortraitAdjustmentAPI["inspect"]>();
const renderNative = vi.fn<JianyingPortraitAdjustmentAPI["render"]>();
const detect = vi.fn<JianyingPortraitAdjustmentAPI["detect"]>();
const list = vi.fn<BeautyLabAPI["listResearchCases"]>();
const load = vi.fn<BeautyLabAPI["loadResearchFrame"]>();
const readImage = vi.mocked(readComparisonImage);
const capture = vi.mocked(captureJianyingPortraitDetectionFrame);
const file = new File(["fixture"], "input.png", { type: "image/png" });
const ASYNC_OPERATIONS = [
	{ operation: "import" },
	{ operation: "render" },
	{ operation: "research" },
	{ operation: "detect" },
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
	readImage.mockReset().mockResolvedValue(makeFrame());
	capture.mockReset().mockReturnValue({
		source: {
			width: 1,
			height: 1,
			data: new Uint8ClampedArray([10, 20, 30, 255]),
			colorSpace: "srgb",
		} as ImageData,
	});
	vi.stubGlobal("electronAPI", {
		jianyingPortraitAdjustment: { inspect, render: renderNative, detect },
		beautyLab: { listResearchCases: list, loadResearchFrame: load },
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("useBeautyLab draft and provenance", () => {
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
		const { result } = await mountLab();
		await importInput({ result });
		const job = pendingOperation({ operation, lab: result.current });
		let pending!: Promise<void>;
		act(() => {
			pending = job.start();
		});
		if (operation === "render") {
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
		expect(result.current).toBe(latest);
		expect(result.current.native).toBeNull();
		expect(result.current.candidate).toBeNull();
		expect(result.current.record).toBeNull();
		expect(result.current.faces).toEqual([]);
		expect(result.current.error).toBeNull();
		expect(result.current.busy).toBeNull();
	});

	it.each(
		ASYNC_OPERATIONS
	)("ignores pending $operation rejection after unmount", async ({
		operation,
	}) => {
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
			job.reject(new Error("unmounted"));
			await pending;
		});
		expect(result.current).toBe(beforeUnmount);
	});

	it("ignores runtime inspection and catalog rejection after cleanup", async () => {
		const runtime = deferred<JianyingPortraitAdjustmentStatus>();
		const catalog =
			deferred<Awaited<ReturnType<BeautyLabAPI["listResearchCases"]>>>();
		inspect.mockReturnValue(runtime.promise);
		list.mockReturnValue(catalog.promise);
		const { result, unmount } = await mountLab();
		const previous = result.current;
		unmount();
		await act(async () => {
			runtime.reject(new Error("stale inspection"));
			catalog.reject(new Error("stale list"));
			await Promise.resolve();
		});
		expect(result.current).toBe(previous);
	});
});

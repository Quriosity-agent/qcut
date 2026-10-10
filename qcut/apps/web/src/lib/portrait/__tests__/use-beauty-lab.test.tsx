import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	BeautyLabResearchFrame,
	JianyingPortraitAdjustmentRenderResult,
} from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { useBeautyLab } from "../use-beauty-lab";
import {
	candidateUnavailable,
	capture,
	detect,
	detection,
	importInput,
	inspect,
	inspectCandidate,
	list,
	load,
	makeAdjustments,
	makeResearchFrame,
	mountLab,
	nativeOutput,
	ready,
	renderNative,
	resetBeautyLabMocks,
} from "./use-beauty-lab-fixture";

vi.mock(
	"@/components/editor/media-panel/views/adjustments/filter-comparison-input",
	() => ({ readComparisonImage: vi.fn() })
);
vi.mock("../jianying-portrait-face-detection", () => ({
	captureJianyingPortraitDetectionFrame: vi.fn(),
}));

beforeEach(resetBeautyLabMocks);

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
			freshTracking: true,
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

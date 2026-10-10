import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	BeautyLabCandidateResult,
	BeautyLabCandidateStatus,
} from "@/types/electron";
import { BEAUTY_LAB_CANDIDATE_PROTOCOL } from "@/types/electron";
import { useBeautyLab } from "../use-beauty-lab";
import {
	candidateReady,
	candidateUnavailable,
	capture,
	detect,
	importInput,
	inspectCandidate,
	list,
	load,
	makeCandidateResult,
	makeCapture,
	mountLab,
	nativeOutput,
	pendingOperation,
	renderCandidate,
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

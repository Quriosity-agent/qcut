import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readComparisonImage } from "@/components/editor/media-panel/views/adjustments/filter-comparison-input";
import type {
	BeautyLabAPI,
	BeautyLabCandidateRequest,
	BeautyLabCandidateResult,
	BeautyLabCandidateStatus,
	JianyingPortraitAdjustmentAPI,
	JianyingPortraitAdjustmentStatus,
} from "@/types/electron";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
} from "@/types/electron";
import { BEAUTY_LAB_CANDIDATE_STAGES } from "../../../../../../electron/beauty-lab-candidate-contract";
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

function resultFor({
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
		requestFingerprint: "f".repeat(64),
		inputSha256: "e".repeat(64),
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
const candidateReady: BeautyLabCandidateStatus = {
	protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
	backendId: BEAUTY_LAB_CANDIDATE_BACKEND,
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
const candidateLatched: BeautyLabCandidateStatus = {
	...candidateReady,
	state: "blocked",
	available: false,
	blockers: ["live-static-audit-failed-restart-required"],
};

const inspectCandidate = vi.fn<BeautyLabAPI["inspectCandidate"]>();
const renderCandidate = vi.fn<BeautyLabAPI["renderCandidate"]>();
const cancelCandidate = vi.fn<NonNullable<BeautyLabAPI["cancelCandidate"]>>();
const readImage = vi.mocked(readComparisonImage);
const file = new File(["fixture"], "input.png", { type: "image/png" });

async function mountWithInput() {
	const view = renderHook(useBeautyLab, {
		initialProps: {
			elementId: "clip-1",
			currentFrame: 7,
			initialAdjustments: { enabled: true, values: { face_adjust_eye: 40 } },
		},
	});
	await act(async () => {
		await Promise.resolve();
	});
	await act(async () => {
		await view.result.current.importImage({ file });
	});
	return view;
}

function startCandidate({
	result,
}: {
	result: { current: ReturnType<typeof useBeautyLab> };
}) {
	const job = deferred<BeautyLabCandidateResult>();
	renderCandidate.mockReturnValueOnce(job.promise);
	let pending!: Promise<void>;
	act(() => {
		pending = result.current.renderCandidate();
	});
	const request = renderCandidate.mock.calls.at(-1)![0];
	return { job, pending, request };
}

beforeEach(() => {
	inspectCandidate.mockReset().mockResolvedValue(candidateReady);
	renderCandidate
		.mockReset()
		.mockImplementation(async (request) => resultFor({ request }));
	cancelCandidate.mockReset().mockResolvedValue({ cancelled: true });
	readImage.mockReset().mockResolvedValue({
		name: "input.png",
		width: 1,
		height: 1,
		rgba: new Uint8Array([10, 20, 30, 255]),
		resized: false,
	});
	vi.stubGlobal("electronAPI", {
		jianyingPortraitAdjustment: {
			inspect: vi
				.fn<JianyingPortraitAdjustmentAPI["inspect"]>()
				.mockResolvedValue(ready),
			render: vi.fn(),
			detect: vi.fn(),
		},
		beautyLab: {
			listResearchCases: vi.fn().mockResolvedValue([]),
			loadResearchFrame: vi.fn(),
			inspectCandidate,
			renderCandidate,
			cancelCandidate,
		} satisfies BeautyLabAPI,
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("useBeautyLab candidate cancellation", () => {
	it("cancels the running request by ID without reporting an error", async () => {
		const { result } = await mountWithInput();
		const { job, pending, request } = startCandidate({ result });
		expect(result.current.candidateJob).toEqual({
			requestId: request.requestId,
			cancelling: false,
		});
		await act(async () => {
			await result.current.cancelCandidate();
		});
		expect(cancelCandidate).toHaveBeenCalledExactlyOnceWith({
			requestId: request.requestId,
		});
		expect(result.current.candidateJob).toMatchObject({ cancelling: true });
		const inspections = inspectCandidate.mock.calls.length;
		await act(async () => {
			job.reject(new Error("Live candidate job cancelled"));
			await pending;
		});
		expect(result.current.error).toBeNull();
		expect(result.current.candidate).toBeNull();
		expect(result.current.candidateJob).toBeNull();
		expect(result.current.busy).toBeNull();
		expect(inspectCandidate.mock.calls.length).toBe(inspections + 1);
		expect(result.current.candidateStatus).toBe(candidateReady);
	});
	it("never shows pixels for a cancelled request that finished first", async () => {
		cancelCandidate.mockResolvedValue({ cancelled: false });
		const { result } = await mountWithInput();
		const { job, pending, request } = startCandidate({ result });
		await act(async () => {
			await result.current.cancelCandidate();
		});
		await act(async () => {
			job.resolve(resultFor({ request }));
			await pending;
		});
		expect(result.current.candidate).toBeNull();
		expect(result.current.candidateReport).toBeNull();
		expect(result.current.candidateJob).toBeNull();
		expect(result.current.error).toBeNull();
	});
	it("blocks a new request until the stale one settles in main", async () => {
		const { result } = await mountWithInput();
		const { job, pending, request } = startCandidate({ result });
		act(() =>
			result.current.changeAdjustments({
				enabled: true,
				values: { face_adjust_eye: 20 },
			})
		);
		expect(result.current.busy).toBeNull();
		expect(result.current.candidateJob?.requestId).toBe(request.requestId);
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(renderCandidate).toHaveBeenCalledOnce();
		await act(async () => {
			job.resolve(resultFor({ request }));
			await pending;
		});
		expect(result.current.candidate).toBeNull();
		expect(result.current.candidateJob).toBeNull();
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(renderCandidate).toHaveBeenCalledTimes(2);
		expect(result.current.candidate).not.toBeNull();
	});
	it("surfaces a restart blocker latched by a stale failure", async () => {
		const { result } = await mountWithInput();
		const { job, pending } = startCandidate({ result });
		act(() =>
			result.current.changeAdjustments({
				enabled: true,
				values: { face_adjust_eye: 20 },
			})
		);
		inspectCandidate.mockResolvedValue(candidateLatched);
		await act(async () => {
			job.reject(new Error("Live candidate job timed out"));
			await pending;
		});
		expect(result.current.error).toBeNull();
		expect(result.current.candidateStatus).toBe(candidateLatched);
		await act(async () => {
			await result.current.renderCandidate();
		});
		expect(renderCandidate).toHaveBeenCalledOnce();
	});
	it("allows another cancellation attempt when the cancel call fails", async () => {
		cancelCandidate.mockRejectedValueOnce(new Error("IPC unavailable"));
		const { result } = await mountWithInput();
		const { job, pending, request } = startCandidate({ result });
		await act(async () => {
			await result.current.cancelCandidate();
		});
		expect(result.current.error).toMatch(/IPC unavailable/);
		expect(result.current.candidateJob).toEqual({
			requestId: request.requestId,
			cancelling: false,
		});
		await act(async () => {
			await result.current.cancelCandidate();
		});
		expect(cancelCandidate).toHaveBeenCalledTimes(2);
		await act(async () => {
			job.reject(new Error("Live candidate job cancelled"));
			await pending;
		});
		expect(result.current.candidateJob).toBeNull();
	});
	it("does nothing without a pending request", async () => {
		const { result } = await mountWithInput();
		await act(async () => {
			await result.current.cancelCandidate();
		});
		expect(cancelCandidate).not.toHaveBeenCalled();
		expect(result.current.candidateJob).toBeNull();
	});
});

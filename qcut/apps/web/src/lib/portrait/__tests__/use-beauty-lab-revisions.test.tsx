import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	BeautyLabAPI,
	BeautyLabCandidateStatus,
	JianyingPortraitAdjustmentStatus,
} from "@/types/electron";
import { useBeautyLab } from "../use-beauty-lab";
import {
	ASYNC_OPERATIONS,
	candidateReady,
	capture,
	deferred,
	importInput,
	inspect,
	inspectCandidate,
	list,
	makeAdjustments,
	makeCapture,
	mountLab,
	pendingOperation,
	ready,
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

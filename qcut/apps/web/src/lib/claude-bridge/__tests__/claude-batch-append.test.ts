import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineTrack } from "@/types/timeline";
import { useProjectStore } from "@/stores/project-store";
import { clearAutoSaveTimer } from "@/stores/timeline/timeline-store-autosave";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { setupBatchHandlers } from "../claude-timeline-bridge-batch";
import type {
	ClaudeTimelineBridgeAPI,
	ClaudeTimelineBridgeSharedUtils,
} from "../claude-timeline-bridge";

/**
 * The report's workflow: lay twelve 24 fps clips end to end on the main track
 * in one batch, without the caller adding up floating-point seconds.
 */

vi.mock("@/lib/project/project-folder-sync", () => ({
	syncProjectFolder: vi.fn(async () => undefined),
}));

type BatchHandler = (data: {
	requestId: string;
	projectId: string;
	elements: Array<Record<string, unknown>>;
}) => Promise<void>;

function setupHandler() {
	let batchHandler: BatchHandler | undefined;
	const sendResponse = vi.fn();
	const claudeAPI = {
		onBatchAddElements: vi.fn((handler: BatchHandler) => {
			batchHandler = handler;
		}),
		sendBatchAddElementsResponse: sendResponse,
	} as unknown as ClaudeTimelineBridgeAPI;
	const sharedUtils = {
		normalizeClaudeElementType: vi.fn(() => "media"),
		resolveMediaIdForBatchElement: vi.fn(
			({ element }: { element: { sourceId: string } }) => element.sourceId
		),
	} as unknown as ClaudeTimelineBridgeSharedUtils;
	setupBatchHandlers({ claudeAPI, sharedUtils });
	if (!batchHandler) throw new Error("Batch handler was not registered");
	return { batchHandler, sendResponse };
}

const mainTrack: TimelineTrack = {
	id: "main",
	name: "Main",
	type: "media",
	isMain: true,
	elements: [],
};

describe("batch-add laid end to end", () => {
	beforeEach(() => {
		useTimelineStore.setState({
			_tracks: [mainTrack],
			tracks: [mainTrack],
			history: [],
			redoStack: [],
			selectedElements: [],
		});
		useProjectStore.setState({
			activeProject: {
				id: "project-1",
				name: "Door plan",
				thumbnail: "",
				createdAt: new Date(),
				updatedAt: new Date(),
				fps: 24,
			} as never,
		});
	});

	afterEach(() => {
		clearAutoSaveTimer();
		useProjectStore.setState({ activeProject: null });
	});

	it('chains startTime "end" across the batch with frame-counted lengths', async () => {
		const frameCounts = [
			410, 236, 503, 289, 377, 409, 385, 168, 251, 330, 299, 441,
		];
		const { batchHandler, sendResponse } = setupHandler();

		await batchHandler({
			requestId: "append",
			projectId: "project-1",
			elements: frameCounts.map((durationFrames, index) => ({
				type: "media",
				trackId: "main",
				sourceId: `media-${index + 1}`,
				sourceName: `clip-${index + 1}.mp4`,
				startTime: "end",
				durationFrames,
			})),
		});

		const response = sendResponse.mock.calls[0]?.[1];
		expect(response.failedCount).toBe(0);
		const placed = [
			...(useTimelineStore.getState().tracks[0]?.elements ?? []),
		].sort((a, b) => a.startTime - b.startTime);
		expect(placed).toHaveLength(12);
		let expectedFrame = 0;
		for (const [index, element] of placed.entries()) {
			expect(element.startTime * 24).toBeCloseTo(expectedFrame, 6);
			expect(element.duration * 24).toBeCloseTo(frameCounts[index], 6);
			expectedFrame += frameCounts[index];
		}
	});

	it("places a clip after a named element", async () => {
		const { batchHandler, sendResponse } = setupHandler();
		await batchHandler({
			requestId: "first",
			projectId: "project-1",
			elements: [
				{
					id: "opening",
					type: "media",
					trackId: "main",
					sourceId: "media-1",
					startFrame: 0,
					durationFrames: 48,
				},
			],
		});
		await batchHandler({
			requestId: "second",
			projectId: "project-1",
			elements: [
				{
					type: "media",
					trackId: "main",
					sourceId: "media-2",
					after: "opening",
					duration: 1,
				},
			],
		});

		expect(sendResponse.mock.calls[1]?.[1].failedCount).toBe(0);
		expect(
			useTimelineStore
				.getState()
				.tracks[0]?.elements.map((element) => element.startTime)
				.sort((a, b) => a - b)
		).toEqual([0, 2]);
	});
});

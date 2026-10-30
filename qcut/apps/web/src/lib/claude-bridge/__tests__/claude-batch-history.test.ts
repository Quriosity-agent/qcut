import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N28 (2026-10-30 trailer report): a refused replace-media left an empty
 * "Edit" step on the undo stack and emptied the redo stack, so one undo no
 * longer took back the last replacement. A batch that changes nothing now
 * leaves both stacks as they were.
 */

const media = vi.hoisted(() => ({
	items: [
		{ id: "old", name: "05_拳域_01.mp4", type: "video", duration: 10 },
		{ id: "v2", name: "05_拳域_01_v2.mp4", type: "video", duration: 12 },
		{ id: "short", name: "05_short.mp4", type: "video", duration: 0.417 },
	],
}));
vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: { getState: () => ({ mediaItems: media.items }) },
	getMediaAspectRatio: vi.fn(() => 16 / 9),
}));
vi.mock("@/lib/storage/storage-service", () => ({
	storageService: {
		saveTimeline: vi.fn(() => Promise.resolve()),
		saveProjectTimeline: vi.fn(() => Promise.resolve()),
		loadTimeline: vi.fn(() => Promise.resolve(null)),
	},
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: vi.fn(() => ({ activeProject: { id: "p1", fps: 24 } })),
	},
}));
vi.mock("@/lib/project/project-folder-sync", () => ({
	syncProjectFolder: vi.fn(async () => undefined),
}));
vi.mock("@/stores/editor/editor-store", () => ({
	useEditorStore: {
		getState: vi.fn(() => ({ currentTime: 0, setCurrentTime: vi.fn() })),
	},
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { setupBatchHandlers } from "../claude-timeline-bridge-batch";
import { beginHistoryStep } from "../claude-history-step";

const shot: MediaElement = {
	id: "shot",
	type: "media",
	name: "05_拳域_01.mp4",
	mediaId: "old",
	startTime: 2,
	duration: 10,
	trimStart: 0,
	trimEnd: 8.958,
};

function setTimeline() {
	const tracks: TimelineTrack[] = [
		{
			id: "main",
			name: "主轨道",
			type: "media",
			isMain: true,
			elements: [shot],
		},
	];
	useTimelineStore.setState({
		_tracks: tracks,
		tracks,
		history: [],
		redoStack: [],
	});
}

function handlers() {
	let onAdd: ((data: unknown) => Promise<void>) | undefined;
	let onUpdate: ((data: unknown) => Promise<void>) | undefined;
	let onDelete: ((data: unknown) => void) | undefined;
	const sendBatchAddElementsResponse = vi.fn();
	const sendBatchUpdateElementsResponse = vi.fn();
	const sendBatchDeleteElementsResponse = vi.fn();
	setupBatchHandlers({
		claudeAPI: {
			onBatchAddElements: (callback: typeof onAdd) => {
				onAdd = callback;
			},
			sendBatchAddElementsResponse,
			onBatchUpdateElements: (callback: typeof onUpdate) => {
				onUpdate = callback;
			},
			sendBatchUpdateElementsResponse,
			onBatchDeleteElements: (callback: typeof onDelete) => {
				onDelete = callback;
			},
			sendBatchDeleteElementsResponse,
		} as never,
		sharedUtils: {
			normalizeClaudeElementType: () => "media",
			resolveMediaIdForBatchElement: ({
				element,
			}: {
				element: { sourceId?: string };
			}) => element.sourceId,
		} as never,
	});
	if (!onAdd || !onUpdate || !onDelete) {
		throw new Error("batch handlers not registered");
	}
	const add = onAdd;
	const update = onUpdate;
	const remove = onDelete;
	return {
		add: async (elements: Array<Record<string, unknown>>) => {
			await add({ requestId: "add", projectId: "p1", elements });
			return sendBatchAddElementsResponse.mock.lastCall?.[1];
		},
		replace: async (mediaId: string) => {
			await update({
				requestId: mediaId,
				updates: [{ elementId: "shot", mediaId }],
			});
			return sendBatchUpdateElementsResponse.mock.lastCall?.[1];
		},
		remove: (elementId: string) => {
			remove({
				requestId: elementId,
				elements: [{ trackId: "main", elementId }],
			});
			return sendBatchDeleteElementsResponse.mock.lastCall?.[1];
		},
	};
}

function clip(): MediaElement {
	return useTimelineStore.getState().tracks[0].elements[0] as MediaElement;
}

beforeEach(setTimeline);

describe("undo steps of refused editor API batches", () => {
	it("adds no step and keeps redo when a replacement is refused", async () => {
		const { replace } = handlers();
		expect(await replace("v2")).toMatchObject({ updatedCount: 1 });
		expect(useTimelineStore.getState().history).toHaveLength(1);
		useTimelineStore.getState().undo();
		const { history, redoStack } = useTimelineStore.getState();
		expect(redoStack).toHaveLength(1);

		expect(await replace("short")).toMatchObject({
			updatedCount: 0,
			failedCount: 1,
		});
		expect(useTimelineStore.getState().history).toBe(history);
		expect(useTimelineStore.getState().redoStack).toBe(redoStack);

		// The redo the refusal used to wipe still brings v2 back.
		useTimelineStore.getState().redo();
		expect(clip().mediaId).toBe("v2");
	});

	it("takes one undo per accepted replacement, refusals in between", async () => {
		const { replace } = handlers();
		await replace("v2");
		await replace("short");
		await replace("short");
		await replace("old");
		expect(useTimelineStore.getState().history).toHaveLength(2);
		useTimelineStore.getState().undo();
		expect(clip().mediaId).toBe("v2");
		useTimelineStore.getState().undo();
		expect(clip()).toEqual(shot);
	});

	it("adds no step for a delete that finds nothing", () => {
		const { remove } = handlers();
		expect(remove("gone")).toMatchObject({ deletedCount: 0, failedCount: 1 });
		expect(useTimelineStore.getState().history).toEqual([]);
		expect(remove("shot")).toMatchObject({ deletedCount: 1 });
		expect(useTimelineStore.getState().history).toHaveLength(1);
	});

	it("adds no step and keeps redo for a batch add that adds nothing", async () => {
		const { add, replace } = handlers();
		await replace("v2");
		useTimelineStore.getState().undo();
		const { history, redoStack } = useTimelineStore.getState();
		expect(redoStack).toHaveLength(1);

		expect(
			await add([
				{
					type: "media",
					trackId: "gone",
					sourceId: "v2",
					startTime: 0,
					duration: 1,
				},
			])
		).toMatchObject({ failedCount: 1 });
		expect(useTimelineStore.getState().history).toBe(history);
		expect(useTimelineStore.getState().redoStack).toBe(redoStack);
	});
});

describe("a batch's undo step", () => {
	it("is kept when another step came after it", () => {
		const step = beginHistoryStep();
		useTimelineStore.getState().pushHistory();
		step.finish();
		expect(useTimelineStore.getState().history).toHaveLength(2);
	});

	it("is kept when the timeline changed", () => {
		const step = beginHistoryStep();
		useTimelineStore
			.getState()
			.updateElementStartTime("main", "shot", 5, false);
		step.finish();
		expect(useTimelineStore.getState().history).toHaveLength(1);
		expect(clip().startTime).toBe(5);
	});
});

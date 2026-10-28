import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N6 (2026-10-28 trailer report): a batch delete that empties a track also
 * removes the track, and an add naming it is refused afterwards, so the
 * answer names the tracks that went.
 */

const store = vi.hoisted(() => {
	const state = {
		tracks: [] as Array<{ id: string; elements: Array<{ id: string }> }>,
		pushHistory: () => {},
		removeOptions: [] as unknown[],
		removeElementFromTrack: (
			trackId: string,
			elementId: string,
			_pushHistory?: boolean,
			options?: unknown
		) => {
			state.removeOptions.push(options);
			state.tracks = state.tracks
				.map((track) =>
					track.id === trackId
						? {
								...track,
								elements: track.elements.filter(
									(element) => element.id !== elementId
								),
							}
						: track
				)
				.filter((track) => track.elements.length > 0 || track.id === "main");
		},
	};
	return state;
});

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: { getState: () => store },
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: { getState: () => ({ activeProject: { id: "p1" } }) },
}));
vi.mock("@/lib/debug/debug-config", () => ({
	debugError: vi.fn(),
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
}));
vi.mock("../claude-timeline-bridge-elements", () => ({
	applyElementChanges: vi.fn(),
}));

import { setupBatchHandlers } from "../claude-timeline-bridge-batch";

function setup() {
	let onDelete: ((data: unknown) => void) | undefined;
	const sendBatchDeleteElementsResponse = vi.fn();
	setupBatchHandlers({
		claudeAPI: {
			onBatchDeleteElements: (callback: (data: unknown) => void) => {
				onDelete = callback;
			},
			sendBatchDeleteElementsResponse,
		} as never,
		sharedUtils: {} as never,
	});
	if (!onDelete) throw new Error("batch delete handler not registered");
	return { onDelete, sendBatchDeleteElementsResponse };
}

describe("batch delete and the tracks it empties", () => {
	beforeEach(() => {
		store.tracks = [
			{ id: "main", elements: [{ id: "clip" }] },
			{
				id: "score",
				elements: [{ id: "m1" }, { id: "m2" }],
			},
			{ id: "sfx", elements: [{ id: "hit" }, { id: "whoosh" }] },
		];
	});

	it("names each track removed with its last element", () => {
		const { onDelete, sendBatchDeleteElementsResponse } = setup();
		onDelete({
			requestId: "r1",
			elements: [
				{ trackId: "score", elementId: "m1" },
				{ trackId: "score", elementId: "m2" },
				{ trackId: "sfx", elementId: "hit" },
			],
		});
		expect(sendBatchDeleteElementsResponse).toHaveBeenCalledWith(
			"r1",
			expect.objectContaining({ deletedCount: 3, removedTrackIds: ["score"] })
		);
	});

	// N17 (2026-10-28 trailer report): without --ripple the later clips on
	// the main track still moved up by the deleted clip's length.
	it("leaves the gap, on the main track too, unless asked to ripple", () => {
		store.removeOptions = [];
		const { onDelete } = setup();
		onDelete({
			requestId: "r3",
			elements: [{ trackId: "main", elementId: "clip" }],
			ripple: false,
		});
		expect(store.removeOptions).toEqual([{ keepGap: true }]);
	});

	it("adds nothing when every track keeps an element", () => {
		const { onDelete, sendBatchDeleteElementsResponse } = setup();
		onDelete({
			requestId: "r2",
			elements: [{ trackId: "sfx", elementId: "hit" }],
		});
		const response = sendBatchDeleteElementsResponse.mock.calls[0][1];
		expect(response.deletedCount).toBe(1);
		expect(response).not.toHaveProperty("removedTrackIds");
	});
});

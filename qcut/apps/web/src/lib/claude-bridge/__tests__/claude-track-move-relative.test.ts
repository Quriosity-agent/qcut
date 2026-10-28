import { beforeEach, describe, expect, it, vi } from "vitest";
import { moveTrack } from "@qcut/editor-core/timeline";
import type { TimelineTrack } from "@/types/timeline";
import { setupTrackHandlers } from "../claude-timeline-bridge-tracks";
import type { ClaudeTimelineBridgeAPI } from "../claude-timeline-bridge";

/**
 * N14 (2026-10-28 trailer report): placing a new media track above the main
 * track took an index the caller had to work out (and re-check). `track move
 * --above/--below <trackId>` places it from the editor's current order.
 */

const store = vi.hoisted(() => ({
	state: {
		tracks: [] as TimelineTrack[],
		_tracks: [] as TimelineTrack[],
		moveTrack: (trackId: string, toIndex: number) => {},
	},
}));

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: { getState: () => store.state },
}));
vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: { getState: () => ({ mediaItems: [] }) },
}));
vi.mock("@/lib/debug/debug-config", () => ({ debugError: vi.fn() }));

function track(id: string, order: number, isMain = false): TimelineTrack {
	return {
		id,
		name: id,
		type: "media",
		elements: [],
		order,
		...(isMain ? { isMain: true } : {}),
	} as TimelineTrack;
}

function setup() {
	let handler:
		| ((data: { requestId: string; request: Record<string, unknown> }) => void)
		| undefined;
	const sendTrackOperationResponse = vi.fn();
	setupTrackHandlers({
		claudeAPI: {
			onTrackOperation: (callback: typeof handler) => {
				handler = callback;
			},
			sendTrackOperationResponse,
		} as unknown as ClaudeTimelineBridgeAPI,
	});
	if (!handler) throw new Error("no track handler");
	const run = (request: Record<string, unknown>) => {
		handler?.({ requestId: "r", request });
		return sendTrackOperationResponse.mock.calls.at(-1)?.[1];
	};
	return { run };
}

describe("track move relative to another track", () => {
	beforeEach(() => {
		const tracks = [
			track("title", 0),
			track("subs", 1),
			track("main", 2, true),
			track("replacement", 3),
		];
		store.state.tracks = tracks;
		store.state._tracks = tracks;
		store.state.moveTrack = (trackId, toIndex) => {
			const moved = moveTrack({
				tracks: store.state._tracks,
				trackId,
				toIndex,
			});
			store.state._tracks = moved;
			store.state.tracks = moved;
		};
	});

	it("puts a track directly above the main track from below it", () => {
		const { run } = setup();
		const answer = run({
			action: "update",
			trackId: "replacement",
			aboveTrackId: "main",
		});
		expect(answer).toMatchObject({ success: true, index: 2 });
		expect(store.state.tracks.map((t) => t.id)).toEqual([
			"title",
			"subs",
			"replacement",
			"main",
		]);
	});

	it("puts a track directly below another one from above it", () => {
		const { run } = setup();
		const answer = run({
			action: "update",
			trackId: "title",
			belowTrackId: "main",
		});
		expect(answer).toMatchObject({ success: true, index: 2 });
		expect(store.state.tracks.map((t) => t.id)).toEqual([
			"subs",
			"main",
			"title",
			"replacement",
		]);
	});

	it("refuses an unknown anchor and conflicting targets", () => {
		const { run } = setup();
		expect(
			run({ action: "update", trackId: "title", aboveTrackId: "gone" })
		).toMatchObject({ success: false, error: "Track not found: gone" });
		expect(
			run({
				action: "update",
				trackId: "title",
				aboveTrackId: "main",
				index: 1,
			})
		).toMatchObject({
			success: false,
			error: "Give index or aboveTrackId/belowTrackId, not both",
		});
	});
});

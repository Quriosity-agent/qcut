import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { clearAutoSaveTimer } from "@/stores/timeline/timeline-store-autosave";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { applyElementChanges } from "../claude-timeline-bridge-elements";

/**
 * An element update that moves a clip must report the store's verdict: the
 * batch-update route used to answer success for every item while the store
 * quietly refused a move onto an occupied span.
 */

function mediaElement({
	id,
	startTime,
	duration = 2,
	groupId,
}: {
	id: string;
	startTime: number;
	duration?: number;
	groupId?: string;
}): MediaElement {
	return {
		id,
		name: id,
		type: "media",
		mediaId: `${id}-media`,
		duration,
		startTime,
		trimStart: 0,
		trimEnd: 0,
		...(groupId ? { groupId } : {}),
	};
}

function setTracks(tracks: TimelineTrack[]) {
	useTimelineStore.setState({
		_tracks: tracks,
		tracks,
		history: [],
		redoStack: [],
		selectedElements: [],
	});
}

function mainTrack(elements: MediaElement[]): TimelineTrack {
	return { id: "main", name: "Main", type: "media", isMain: true, elements };
}

function startOf(elementId: string): number | undefined {
	return useTimelineStore
		.getState()
		.tracks.flatMap((track) => track.elements)
		.find((element) => element.id === elementId)?.startTime;
}

describe("element updates that move a clip", () => {
	beforeEach(() =>
		setTracks([
			mainTrack([
				mediaElement({ id: "a", startTime: 0 }),
				mediaElement({ id: "b", startTime: 2 }),
				mediaElement({ id: "c", startTime: 10 }),
			]),
		])
	);
	afterEach(() => clearAutoSaveTimer());

	it("fails, names the blocking clip and changes nothing", () => {
		const result = applyElementChanges({
			elementId: "c",
			changes: { startTime: 3, colorLabel: "rose" },
			pushHistory: true,
		});

		expect(result).toEqual({
			applied: false,
			error:
				'3s–5s on track "Main" overlaps "b" (2s–4s). A track plays one element at a time; the next free start for this 2s clip is 4s.',
		});
		expect(startOf("c")).toBe(10);
		const c = useTimelineStore
			.getState()
			.tracks[0].elements.find((element) => element.id === "c");
		expect(c?.colorLabel).toBeUndefined();
		expect(useTimelineStore.getState().history).toHaveLength(0);
	});

	it("applies a move into free space as one undo step", () => {
		const result = applyElementChanges({
			elementId: "c",
			changes: { startTime: 4, colorLabel: "rose" },
			pushHistory: true,
		});

		expect(result).toEqual({ applied: true });
		expect(startOf("c")).toBe(4);
		expect(useTimelineStore.getState().history).toHaveLength(1);
		useTimelineStore.getState().undo();
		expect(startOf("c")).toBe(10);
	});

	it("says the track is locked when that is the reason", () => {
		setTracks([
			{
				...mainTrack([mediaElement({ id: "c", startTime: 10 })]),
				locked: true,
			},
		]);
		expect(
			applyElementChanges({
				elementId: "c",
				changes: { startTime: 4 },
				pushHistory: false,
			})
		).toEqual({ applied: false, error: 'Track "Main" is locked' });
	});

	it("does not count a groupmate on the same track as the obstruction", () => {
		setTracks([
			mainTrack([
				mediaElement({ id: "blocker", startTime: 0 }),
				mediaElement({ id: "lead", startTime: 4, groupId: "g" }),
				mediaElement({ id: "follower", startTime: 6, groupId: "g" }),
			]),
		]);
		// Moving the lead to 1 shifts the follower to 3: the blocker is in the
		// way of the lead, the follower is not.
		const result = applyElementChanges({
			elementId: "lead",
			changes: { startTime: 1 },
			pushHistory: false,
		});
		expect(result.applied).toBe(false);
		expect(result.error).toContain('overlaps "blocker"');
	});
});

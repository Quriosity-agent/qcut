import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { clearAutoSaveTimer } from "../timeline-store-autosave";
import { useTimelineStore } from "../timeline-store";

/**
 * N6 (2026-10-28 trailer report): every removal swept away every empty
 * track, so a track created with `track:create` and not filled yet vanished
 * at the next delete anywhere — the "delay" between emptying a track and its
 * removal that swallowed a freshly made track of the same name. Only the
 * track a removal empties goes now.
 */

function clip({
	id,
	startTime,
	groupId,
}: {
	id: string;
	startTime: number;
	groupId?: string;
}): MediaElement {
	return {
		id,
		name: id,
		type: "media",
		mediaId: `${id}-media`,
		duration: 2,
		startTime,
		trimStart: 0,
		trimEnd: 0,
		...(groupId ? { groupId } : {}),
	};
}

function tracks(): TimelineTrack[] {
	return [
		{
			id: "main",
			name: "Main",
			type: "media",
			isMain: true,
			elements: [clip({ id: "a", startTime: 0 })],
		},
		{
			id: "music-old",
			name: "配乐 1",
			type: "audio",
			elements: [clip({ id: "music-1", startTime: 0 })],
		},
		// Made with track:create a moment ago, not filled yet.
		{ id: "music-new", name: "配乐 Suno", type: "audio", elements: [] },
	];
}

function trackIds(): string[] {
	return useTimelineStore.getState().tracks.map((track) => track.id);
}

describe("emptied track removal", () => {
	beforeEach(() => {
		const initial = tracks();
		useTimelineStore.setState({
			_tracks: initial,
			tracks: initial,
			history: [],
			redoStack: [],
			rippleEditingEnabled: false,
			selectedElements: [],
		});
	});

	afterEach(() => clearAutoSaveTimer());

	it("removes the track a delete empties, and only that one", () => {
		useTimelineStore.getState().removeElementFromTrack("music-old", "music-1");
		expect(trackIds()).toEqual(["main", "music-new"]);
	});

	it("keeps an empty track when a clip elsewhere is deleted", () => {
		useTimelineStore.getState().removeElementFromTrack("main", "a");
		expect(trackIds()).toEqual(["main", "music-old", "music-new"]);
	});

	it("keeps an unrelated empty track through a ripple delete", () => {
		useTimelineStore.setState({ rippleEditingEnabled: true });
		useTimelineStore.getState().removeElementFromTrack("music-old", "music-1");
		expect(trackIds()).toEqual(["main", "music-new"]);
	});

	it("keeps an unrelated empty track when a move empties the source track", () => {
		const state = useTimelineStore.getState();
		const extra: TimelineTrack = {
			id: "music-spare",
			name: "Spare",
			type: "audio",
			elements: [],
		};
		useTimelineStore.setState({
			_tracks: [...state._tracks, extra],
			tracks: [...state.tracks, extra],
		});
		useTimelineStore
			.getState()
			.moveElementToTrack("music-old", "music-new", "music-1");
		expect(trackIds()).toEqual(["main", "music-new", "music-spare"]);
	});

	it("removes only the tracks a grouped delete empties", () => {
		const grouped: TimelineTrack[] = [
			{
				id: "main",
				name: "Main",
				type: "media",
				isMain: true,
				elements: [clip({ id: "v", startTime: 0, groupId: "pair" })],
			},
			{
				id: "sep-audio",
				name: "Separated",
				type: "audio",
				elements: [clip({ id: "v-audio", startTime: 0, groupId: "pair" })],
			},
			{ id: "fresh", name: "Fresh", type: "audio", elements: [] },
		];
		useTimelineStore.setState({ _tracks: grouped, tracks: grouped });
		useTimelineStore.getState().removeElementFromTrack("main", "v");
		expect(trackIds()).toEqual(["main", "fresh"]);
	});
});

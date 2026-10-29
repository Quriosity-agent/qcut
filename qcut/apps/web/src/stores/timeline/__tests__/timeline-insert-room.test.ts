/**
 * N20 (2026-10-29 trailer report): an add with `collision: "insert"` moves
 * the clips after it only as far as it needs. Put back into the gap its
 * predecessor left, a clip 0.1 ms longer than that gap pushed the 30 clips
 * after it right by its whole length (1.29 s).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { clearAutoSaveTimer } from "../timeline-store-autosave";
import { useTimelineStore } from "../timeline-store";

vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: { getState: () => ({ mediaItems: [] }) },
}));

function clip({
	id,
	startTime,
	duration,
}: {
	id: string;
	startTime: number;
	duration: number;
}): MediaElement {
	return {
		id,
		name: `${id}.mp4`,
		type: "media",
		mediaId: `${id}-media`,
		duration,
		startTime,
		trimStart: 0,
		trimEnd: 0,
	};
}

function setMain(elements: MediaElement[]) {
	const tracks: TimelineTrack[] = [
		{ id: "main", name: "主轨道", type: "media", isMain: true, elements },
		{
			id: "sfx",
			name: "音效 1",
			type: "audio",
			elements: [clip({ id: "hit", startTime: 3, duration: 0.5 })],
		},
	];
	useTimelineStore.setState({
		_tracks: tracks,
		tracks,
		history: [],
		redoStack: [],
		selectedElements: [],
		rippleEditingEnabled: false,
	});
}

function insert({
	startTime,
	duration,
}: {
	startTime: number;
	duration: number;
}) {
	return useTimelineStore.getState().addElementToTrack(
		"main",
		{
			type: "media",
			mediaId: "new-media",
			name: "new.mp4",
			duration,
			startTime,
			trimStart: 0,
			trimEnd: 0,
		},
		{ collision: "insert" }
	);
}

function starts(trackId: string): number[] {
	return (
		useTimelineStore
			.getState()
			.tracks.find((track) => track.id === trackId)
			?.elements.map((element) => Number(element.startTime.toFixed(4)))
			.sort((left, right) => left - right) ?? []
	);
}

describe("an insert makes only the room it needs (N20)", () => {
	afterEach(() => clearAutoSaveTimer());

	describe("into a gap", () => {
		beforeEach(() =>
			setMain([
				clip({ id: "a", startTime: 0, duration: 2 }),
				clip({ id: "c", startTime: 4, duration: 2 }),
				clip({ id: "d", startTime: 6, duration: 2 }),
			])
		);

		it("moves nothing when the gap fits it", () => {
			expect(insert({ startTime: 2, duration: 2 })).not.toBeNull();

			expect(starts("main")).toEqual([0, 2, 4, 6]);
		});

		it("moves nothing when the gap fits it but for a rounding error", () => {
			expect(insert({ startTime: 2, duration: 2.0001 })).not.toBeNull();

			expect(starts("main")).toEqual([0, 2, 4, 6]);
		});

		it("moves the later clips by what does not fit", () => {
			expect(insert({ startTime: 2, duration: 3 })).not.toBeNull();

			expect(starts("main")).toEqual([0, 2, 5, 7]);
			expect(starts("sfx")).toEqual([3]);
		});
	});

	it("puts v17's clip back into its gap without moving the rest", () => {
		setMain([
			clip({ id: "104", startTime: 134.1667, duration: 1.2917 }),
			clip({ id: "106", startTime: 136.75, duration: 1.2917 }),
			clip({ id: "107", startTime: 138.0417, duration: 1.2917 }),
		]);

		expect(insert({ startTime: 135.4584, duration: 1.2917 })).not.toBeNull();

		expect(starts("main")).toEqual([134.1667, 135.4584, 136.75, 138.0417]);
	});

	it("moves the later clips by its whole length where one starts at the point", () => {
		setMain([
			clip({ id: "a", startTime: 0, duration: 2 }),
			clip({ id: "b", startTime: 2, duration: 2 }),
		]);

		expect(insert({ startTime: 2, duration: 1.5 })).not.toBeNull();

		expect(starts("main")).toEqual([0, 2, 3.5]);
	});

	it("splits the clip it lands in and moves the right part by its length", () => {
		setMain([clip({ id: "a", startTime: 0, duration: 4 })]);

		expect(insert({ startTime: 1, duration: 2 })).not.toBeNull();

		const elements =
			useTimelineStore.getState().tracks.find((track) => track.id === "main")
				?.elements ?? [];
		expect(
			elements
				.map((element) => [
					Number(element.startTime.toFixed(4)),
					element.duration - element.trimStart - element.trimEnd,
				])
				.sort((left, right) => left[0] - right[0])
		).toEqual([
			[0, 1],
			[1, 2],
			[3, 3],
		]);
	});
});

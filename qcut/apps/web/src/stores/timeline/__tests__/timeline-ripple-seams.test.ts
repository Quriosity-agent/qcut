/**
 * N20 (2026-10-29 trailer report): a ripple counts a clip starting a rounding
 * error before its edit point as after it, the rule placements use for
 * seams. v17's main track had 105 at 135.4584 for 1.2917 s (ending at
 * 136.7501) and 106 at 136.75: a ripple delete of 105 left 106 in place, the
 * clips rippled into 106 went back to their old places, and the gap stayed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { clearAutoSaveTimer } from "../timeline-store-autosave";
import { useTimelineStore } from "../timeline-store";

const CLIP = 1.2917;

function clip({
	id,
	startTime,
}: {
	id: string;
	startTime: number;
}): MediaElement {
	return {
		id,
		name: `${id}.mp4`,
		type: "media",
		mediaId: `${id}-media`,
		duration: CLIP,
		startTime,
		trimStart: 0,
		trimEnd: 0,
	};
}

/** v17's main track around 105_并肩_04, and a title on a track of its own. */
function v17Tracks(): TimelineTrack[] {
	return [
		{
			id: "main",
			name: "主轨道",
			type: "media",
			isMain: true,
			elements: [
				clip({ id: "104", startTime: 134.1667 }),
				clip({ id: "105", startTime: 135.4584 }),
				clip({ id: "106", startTime: 136.75 }),
				clip({ id: "107", startTime: 138.0417 }),
			],
		},
		{
			id: "titles",
			name: "字卡",
			type: "media",
			elements: [clip({ id: "title", startTime: 140 })],
		},
	];
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

describe("ripples count a seam within half a frame as touching (N20)", () => {
	beforeEach(() => {
		const tracks = v17Tracks();
		useTimelineStore.setState({
			_tracks: tracks,
			tracks,
			history: [],
			redoStack: [],
			rippleEditingEnabled: false,
			mainTrackMagnetEnabled: true,
			linkedRippleEnabled: true,
			selectedElements: [],
		});
	});

	afterEach(() => clearAutoSaveTimer());

	it("closes the gap of a ripple delete", () => {
		useTimelineStore
			.getState()
			.removeElementFromTrackWithRipple("main", "105", true, true);

		expect(starts("main")).toEqual([134.1667, 135.4583, 136.75]);
		expect(starts("titles")).toEqual([140]);
	});

	it("closes the gap the magnet closes on the main track", () => {
		useTimelineStore.getState().removeElementFromTrack("main", "105");

		expect(starts("main")).toEqual([134.1667, 135.4583, 136.75]);
	});

	it("keeps the gap of a delete that keeps it", () => {
		useTimelineStore
			.getState()
			.removeElementFromTrack("main", "105", true, { keepGap: true });

		expect(starts("main")).toEqual([134.1667, 136.75, 138.0417]);
	});

	it("moves the clip after a removed track's clip with the rest", () => {
		const tracks: TimelineTrack[] = [
			v17Tracks()[0],
			{
				id: "insert",
				name: "插入",
				type: "media",
				elements: [clip({ id: "cut-in", startTime: 135.4584 })],
			},
		];
		const main = tracks[0];
		tracks[0] = {
			...main,
			elements: main.elements.filter((element) => element.id !== "105"),
		};
		useTimelineStore.setState({ _tracks: tracks, tracks });

		useTimelineStore.getState().removeTrackWithRipple("insert");

		expect(starts("main")).toEqual([134.1667, 135.4583, 136.75]);
	});

	it("moves the clip after a ripple-trimmed clip with the rest", () => {
		useTimelineStore.setState({ rippleEditingEnabled: true });

		useTimelineStore.getState().rippleTrimElement({
			trackId: "main",
			elementId: "105",
			edge: "right",
			durationDelta: -0.5,
		});

		expect(starts("main")).toEqual([134.1667, 135.4584, 136.25, 137.5417]);
	});

	it("moves the clip after a ripple-moved clip with the rest", () => {
		useTimelineStore.setState({ rippleEditingEnabled: true });

		useTimelineStore
			.getState()
			.updateElementStartTimeWithRipple("main", "105", 136.4584);

		expect(starts("main")).toEqual([134.1667, 136.4584, 137.75, 139.0417]);
	});

	it("moves the clip after a ripple-moved clip with it when it moves left", () => {
		// 106 starts 15 ms before 105 ends, which a placement allows at 30 fps.
		const tracks: TimelineTrack[] = [
			{
				...v17Tracks()[0],
				elements: [
					clip({ id: "104", startTime: 134.1667 }),
					clip({ id: "105", startTime: 135.4584 }),
					clip({ id: "106", startTime: 136.7351 }),
					clip({ id: "107", startTime: 138.0268 }),
				],
			},
		];
		useTimelineStore.setState({
			_tracks: tracks,
			tracks,
			rippleEditingEnabled: true,
		});

		useTimelineStore
			.getState()
			.updateElementStartTimeWithRipple("main", "105", 135.4484);

		expect(starts("main")).toEqual([134.1667, 135.4484, 136.7251, 138.0168]);
	});
});

import { describe, expect, it } from "vitest";
import {
	excludeTimelineTracks,
	readExcludedTrackIds,
	timelineWithoutTracks,
} from "../claude/handlers/claude-export-handler/export-track-selection.js";
import type { ClaudeTimeline } from "../types/claude-api";

const timeline = {
	name: "Trailer",
	duration: 10,
	width: 1470,
	height: 630,
	fps: 24,
	tracks: [
		{
			id: "captions",
			index: 0,
			name: "Captions",
			type: "captions",
			elements: [],
		},
		{ id: "cards", index: 1, name: "Title cards", type: "media", elements: [] },
		{
			id: "main",
			index: 2,
			name: "Main track",
			type: "media",
			isMain: true,
			muted: false,
			elements: [],
		},
	],
} as unknown as ClaudeTimeline;

describe("readExcludedTrackIds", () => {
	it("takes a list or a comma-separated string, once each", () => {
		expect(
			readExcludedTrackIds({ value: ["captions", " cards ", "cards"] })
		).toEqual(["captions", "cards"]);
		expect(readExcludedTrackIds({ value: "captions, cards,," })).toEqual([
			"captions",
			"cards",
		]);
		expect(readExcludedTrackIds({ value: [] })).toEqual([]);
	});

	it("refuses anything that is not a list of ids", () => {
		for (const value of [true, 3, { id: "cards" }, ["cards", 2]]) {
			expect(() => readExcludedTrackIds({ value })).toThrow(
				"excludeTracks must be a list of track ids"
			);
		}
	});
});

describe("timelineWithoutTracks", () => {
	it("drops the named tracks, which is what the choice of engine looks at", () => {
		expect(
			timelineWithoutTracks({ timeline, trackIds: ["cards"] }).tracks.map(
				(track) => track.id
			)
		).toEqual(["captions", "main"]);
		expect(timelineWithoutTracks({ timeline, trackIds: [] })).toBe(timeline);
	});
});

describe("excludeTimelineTracks", () => {
	it("reads the named tracks as hidden and muted, and leaves the rest and the given timeline alone", () => {
		const reduced = excludeTimelineTracks({
			timeline,
			trackIds: ["captions", "cards"],
		});
		expect(
			reduced.tracks.map(({ id, hidden, muted }) => ({ id, hidden, muted }))
		).toEqual([
			{ id: "captions", hidden: true, muted: true },
			{ id: "cards", hidden: true, muted: true },
			{ id: "main", hidden: undefined, muted: false },
		]);
		expect(timeline.tracks[0].hidden).toBeUndefined();
		expect(reduced.tracks[2]).toBe(timeline.tracks[2]);
	});

	it("returns the timeline itself when nothing is excluded", () => {
		expect(excludeTimelineTracks({ timeline, trackIds: [] })).toBe(timeline);
	});

	it("refuses a track the timeline does not have, naming the ones it has", () => {
		expect(() =>
			excludeTimelineTracks({ timeline, trackIds: ["cards", "titles"] })
		).toThrow(
			"No such track to exclude: titles. The timeline has: captions (Captions), cards (Title cards), main (Main track)"
		);
	});
});

import { describe, expect, it } from "vitest";
import type { TimelineTrack } from "../../types/timeline.js";
import { trackTypeGroupInsertionIndex } from "../track-utils.js";

function track(
	id: string,
	type: TimelineTrack["type"],
	isMain = false
): TimelineTrack {
	return { id, name: id, type, elements: [], ...(isMain ? { isMain } : {}) };
}

describe("trackTypeGroupInsertionIndex", () => {
	const tracks = [
		track("text", "text"),
		track("sticker", "sticker"),
		track("main", "media", true),
		track("overlay", "media"),
		track("audio", "audio"),
	];

	it("puts a lane at the top of its existing group", () => {
		expect(trackTypeGroupInsertionIndex({ tracks, type: "media" })).toBe(2);
		expect(trackTypeGroupInsertionIndex({ tracks, type: "sticker" })).toBe(1);
		expect(trackTypeGroupInsertionIndex({ tracks, type: "audio" })).toBe(4);
	});

	it("opens a missing group above the first group that sorts after it", () => {
		// captions sort between text and sticker
		expect(trackTypeGroupInsertionIndex({ tracks, type: "captions" })).toBe(1);
		// adjustment sorts between sticker and media
		expect(trackTypeGroupInsertionIndex({ tracks, type: "adjustment" })).toBe(
			2
		);
	});

	it("keeps visual lanes above a main track that sits first", () => {
		const mainFirst = [track("main", "media", true), track("audio", "audio")];
		expect(
			trackTypeGroupInsertionIndex({ tracks: mainFirst, type: "captions" })
		).toBe(0);
		expect(
			trackTypeGroupInsertionIndex({ tracks: mainFirst, type: "media" })
		).toBe(0);
	});

	it("appends when nothing sorts after the type", () => {
		const noAudio = [track("main", "media", true)];
		expect(
			trackTypeGroupInsertionIndex({ tracks: noAudio, type: "audio" })
		).toBe(1);
		expect(trackTypeGroupInsertionIndex({ tracks: [], type: "captions" })).toBe(
			0
		);
	});
});

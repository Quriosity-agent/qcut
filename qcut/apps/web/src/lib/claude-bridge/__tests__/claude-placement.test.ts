import { describe, expect, it } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { resolveClaudePlacement } from "../claude-placement";

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
		name: id,
		type: "media",
		mediaId: `${id}-media`,
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
	};
}

const tracks: TimelineTrack[] = [
	{
		id: "main",
		name: "Main",
		type: "media",
		isMain: true,
		elements: [
			clip({ id: "one", startTime: 0, duration: 17.041667 }),
			clip({ id: "two", startTime: 17.041667, duration: 4 }),
		],
	},
	{ id: "empty", name: "Empty", type: "media", elements: [] },
	{
		id: "audio",
		name: "Audio",
		type: "audio",
		elements: [clip({ id: "song", startTime: 3, duration: 10 })],
	},
];

describe("resolveClaudePlacement", () => {
	it("returns a request without shorthands unchanged", () => {
		const element = { trackId: "main", startTime: 5, duration: 2 };
		expect(resolveClaudePlacement({ element, tracks, fps: 24 })).toBe(element);
	});

	it('starts "end" where the last element on the track ends', () => {
		expect(
			resolveClaudePlacement({
				element: { trackId: "main", startTime: "end", duration: 2 },
				tracks,
				fps: 24,
			})
		).toEqual({ trackId: "main", startTime: 21.041667, duration: 2 });
		expect(
			resolveClaudePlacement({
				element: { trackId: "empty", startTime: "end", duration: 2 },
				tracks,
				fps: 24,
			}).startTime
		).toBe(0);
	});

	it('needs a known trackId for "end"', () => {
		expect(() =>
			resolveClaudePlacement({
				element: { startTime: "end", duration: 2 },
				tracks,
				fps: 24,
			})
		).toThrow('startTime "end" needs a trackId');
		expect(() =>
			resolveClaudePlacement({
				element: { trackId: "nope", startTime: "end", duration: 2 },
				tracks,
				fps: 24,
			})
		).toThrow("Track not found: nope");
	});

	it("starts after another element, on its track by default", () => {
		expect(
			resolveClaudePlacement({
				element: { after: "song", duration: 2 },
				tracks,
				fps: 24,
			})
		).toEqual({ trackId: "audio", startTime: 13, duration: 2 });
		expect(
			resolveClaudePlacement({
				element: { trackId: "empty", after: "one", duration: 2 },
				tracks,
				fps: 24,
			})
		).toEqual({ trackId: "empty", startTime: 17.041667, duration: 2 });
		expect(() =>
			resolveClaudePlacement({
				element: { after: "ghost", duration: 2 },
				tracks,
				fps: 24,
			})
		).toThrow("Element not found for after: ghost");
		expect(() =>
			resolveClaudePlacement({
				element: { after: "", duration: 2 },
				tracks,
				fps: 24,
			})
		).toThrow("after must be an element id");
	});

	it("converts whole frames at the project frame rate", () => {
		expect(
			resolveClaudePlacement({
				element: { trackId: "main", startFrame: 2814, durationFrames: 385 },
				tracks,
				fps: 24,
			})
		).toEqual({ trackId: "main", startTime: 117.25, duration: 385 / 24 });
	});

	it("rejects frame counts that are not whole", () => {
		for (const startFrame of [1.5, -1]) {
			expect(() =>
				resolveClaudePlacement({
					element: { trackId: "main", startFrame, duration: 1 },
					tracks,
					fps: 24,
				})
			).toThrow("startFrame must be a whole number of frames, 0 or more");
		}
		expect(() =>
			resolveClaudePlacement({
				element: { trackId: "main", startTime: 0, durationFrames: 0 },
				tracks,
				fps: 24,
			})
		).toThrow("durationFrames must be a whole number of frames above 0");
	});

	it("refuses two ways of saying the same thing", () => {
		expect(() =>
			resolveClaudePlacement({
				element: { trackId: "main", startTime: 3, after: "one", duration: 1 },
				tracks,
				fps: 24,
			})
		).toThrow("Give only one of startTime, after or startFrame");
		expect(() =>
			resolveClaudePlacement({
				element: {
					trackId: "main",
					startTime: "end",
					duration: 1,
					durationFrames: 24,
				},
				tracks,
				fps: 24,
			})
		).toThrow("Give duration or durationFrames, not both");
	});
});

import { describe, expect, it } from "vitest";
import {
	findOverlayClips,
	mediaOverlayRendererReason,
} from "../types/media-overlay-export-policy.js";

function clip(trackOrder: number, startTime: number, endTime: number) {
	return { trackOrder, startTime, endTime };
}

function media(id: string, startTime: number, endTime: number) {
	return { id, type: "media", startTime, endTime };
}

describe("findOverlayClips", () => {
	it("marks a clip that plays over a clip on a lower track", () => {
		const main = clip(1, 0, 15);
		const overlay = clip(0, 1, 3.667);
		expect([...findOverlayClips({ clips: [main, overlay], fps: 24 })]).toEqual([
			overlay,
		]);
	});

	it("leaves clips on different tracks that take turns joined", () => {
		const first = clip(1, 0, 5);
		const second = clip(0, 5, 10);
		expect(findOverlayClips({ clips: [first, second], fps: 24 }).size).toBe(0);
	});

	it("treats an overlap under half a frame as a cut, not a stack", () => {
		const first = clip(1, 0, 5.01);
		const second = clip(0, 5, 10);
		expect(findOverlayClips({ clips: [first, second], fps: 24 }).size).toBe(0);
	});

	it("stacks an overlay over an overlay, and a clip over a black gap under an overlay", () => {
		const main = clip(2, 0, 4.5);
		const middle = clip(1, 4, 6);
		const top = clip(0, 5, 10);
		expect(findOverlayClips({ clips: [main, middle, top], fps: 30 })).toEqual(
			new Set([middle, top])
		);
	});
});

describe("mediaOverlayRendererReason", () => {
	const overlayTimeline = (extraTracks: unknown[] = []) => ({
		fps: 24,
		tracks: [
			...extraTracks,
			{ type: "media", elements: [media("overlay", 1, 3.667)] },
			{ type: "media", elements: [media("main", 0, 15)] },
		],
	});

	it("is null for overlays the native export can stack", () => {
		expect(
			mediaOverlayRendererReason({
				timeline: overlayTimeline([
					{
						type: "text",
						elements: [{ type: "text", startTime: 1, endTime: 2 }],
					},
				]),
			})
		).toBeNull();
	});

	it("is null without overlays, even with a text layer under an upper media track", () => {
		expect(
			mediaOverlayRendererReason({
				timeline: {
					fps: 24,
					tracks: [
						{ type: "media", elements: [media("later", 10, 12)] },
						{
							type: "text",
							elements: [{ type: "text", startTime: 10, endTime: 11 }],
						},
						{ type: "media", elements: [media("main", 0, 10)] },
					],
				},
			})
		).toBeNull();
	});

	it("names a text layer under an overlay", () => {
		const timeline = {
			fps: 24,
			tracks: [
				{ type: "media", elements: [media("overlay", 1, 3.667)] },
				{
					type: "text",
					elements: [{ type: "text", startTime: 2, endTime: 3 }],
				},
				{ type: "media", elements: [media("main", 0, 15)] },
			],
		};
		expect(mediaOverlayRendererReason({ timeline })).toBe(
			"a text layer under a media clip stacked over a lower track"
		);
	});

	it("names a transition on an overlay", () => {
		const timeline = overlayTimeline();
		timeline.tracks[0] = {
			type: "media",
			elements: [media("overlay", 1, 3), media("overlay-2", 3, 5)],
			transitions: [{ fromElementId: "overlay", toElementId: "overlay-2" }],
		} as (typeof timeline.tracks)[number];
		expect(mediaOverlayRendererReason({ timeline })).toBe(
			"a transition on a media clip stacked over a lower track"
		);
	});

	it("names neural frame interpolation on an overlay", () => {
		const timeline = overlayTimeline();
		timeline.tracks[0] = {
			type: "media",
			elements: [{ ...media("overlay", 1, 3), frameInterpolation: "neural" }],
		} as (typeof timeline.tracks)[number];
		expect(mediaOverlayRendererReason({ timeline })).toBe(
			"neural frame interpolation on a media clip stacked over a lower track"
		);
	});

	it("ignores hidden clips and hidden tracks", () => {
		const timeline = overlayTimeline();
		timeline.tracks[0] = {
			type: "media",
			hidden: true,
			elements: [{ ...media("overlay", 1, 3), frameInterpolation: "neural" }],
		} as (typeof timeline.tracks)[number];
		expect(mediaOverlayRendererReason({ timeline })).toBeNull();
	});
});

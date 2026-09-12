import { describe, expect, it } from "vitest";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import { isAudioClipSelection } from "../audio-clip-selection";

const element: TimelineElement = {
	id: "clip",
	name: "clip",
	type: "media",
	mediaId: "m",
	duration: 2,
	startTime: 0,
	trimStart: 0,
	trimEnd: 0,
};
const track = (type: TimelineTrack["type"]): TimelineTrack => ({
	id: `${type}-track`,
	name: type,
	type,
	elements: [element],
});
const media = (type: MediaItem["type"]): MediaItem => ({
	id: "m",
	name: "m",
	type,
	file: new File(["x"], "m"),
});

describe("isAudioClipSelection", () => {
	it("treats audio media as audio wherever it sits", () => {
		expect(
			isAudioClipSelection({
				element,
				track: track("media"),
				mediaItem: media("audio"),
			})
		).toBe(true);
	});

	it("treats detached audio on an audio lane as audio even though its media is a video", () => {
		expect(
			isAudioClipSelection({
				element,
				track: track("audio"),
				mediaItem: media("video"),
			})
		).toBe(true);
	});

	it("keeps a video clip on a media lane on the video panel", () => {
		expect(
			isAudioClipSelection({
				element,
				track: track("media"),
				mediaItem: media("video"),
			})
		).toBe(false);
		expect(
			isAudioClipSelection({ element, track: undefined, mediaItem: undefined })
		).toBe(false);
	});

	it("never claims non-media elements", () => {
		expect(
			isAudioClipSelection({
				element: {
					...element,
					type: "text",
					content: "hi",
				} as unknown as TimelineElement,
				track: track("audio"),
				mediaItem: undefined,
			})
		).toBe(false);
	});
});

import { describe, expect, it } from "vitest";
import {
	createDefaultProjectAudioMixSettings,
	normalizeTrackAudioSettings,
} from "@/lib/audio/audio-mix-settings";
import type { TimelineTrack } from "@/types/timeline";
import { shouldExportVideoClipAudio } from "../export-video-clip-audio";

const clip = {
	id: "clip",
	name: "clip",
	type: "media" as const,
	mediaId: "m",
	startTime: 0,
	duration: 2,
	trimStart: 0,
	trimEnd: 0,
};

const picture: TimelineTrack = {
	id: "main",
	name: "Main",
	type: "media",
	isMain: true,
	elements: [clip],
};
const sfx: TimelineTrack = {
	id: "sfx",
	name: "SFX",
	type: "audio",
	elements: [clip],
};

describe("video clip audio in FFmpeg exports", () => {
	it("is always an input outside direct copy", () => {
		expect(
			shouldExportVideoClipAudio({
				optimizationStrategy: "image-video-composite",
				tracks: [picture],
			})
		).toBe(true);
	});

	it("rides along with the copied stream when nothing else plays", () => {
		expect(
			shouldExportVideoClipAudio({
				optimizationStrategy: "direct-copy",
				tracks: [picture, { ...sfx, muted: true }],
				audioMix: createDefaultProjectAudioMixSettings(),
			})
		).toBe(false);
	});

	it("becomes an input once audio tracks play, or it would be dropped", () => {
		expect(
			shouldExportVideoClipAudio({
				optimizationStrategy: "direct-copy",
				tracks: [picture, sfx],
			})
		).toBe(true);
	});

	it("becomes an input when the mix changes the picture's track", () => {
		expect(
			shouldExportVideoClipAudio({
				optimizationStrategy: "direct-copy",
				tracks: [
					{
						...picture,
						audio: normalizeTrackAudioSettings({ audio: { gainDb: -10 } }),
					},
				],
				audioMix: createDefaultProjectAudioMixSettings(),
			})
		).toBe(true);
	});
});

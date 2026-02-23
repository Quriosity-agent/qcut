import { describe, it, expect } from "vitest";
import { detectAudioSources } from "../audio-detection";
import type { TimelineTrack } from "@/types/timeline";
import type { MediaItem } from "@/stores/media/media-store-types";

// ---------------------------------------------------------------------------
// Minimal factories
// ---------------------------------------------------------------------------

const makeMediaElement = (id: string, mediaId: string) => ({
	id,
	type: "media" as const,
	mediaId,
	name: `Element ${id}`,
	startTime: 0,
	duration: 5,
	trimStart: 0,
	trimEnd: 0,
});

const makeTextElement = (id: string) => ({
	id,
	type: "text" as const,
	name: `Text ${id}`,
	content: "hello",
	fontSize: 24,
	fontFamily: "Arial",
	color: "#fff",
	backgroundColor: "transparent",
	textAlign: "left" as const,
	fontWeight: "normal" as const,
	fontStyle: "normal" as const,
	textDecoration: "none" as const,
	startTime: 0,
	duration: 3,
	trimStart: 0,
	trimEnd: 0,
	x: 0,
	y: 0,
	rotation: 0,
	opacity: 1,
});

const makeTrack = (
	overrides: Partial<TimelineTrack> & Pick<TimelineTrack, "id" | "type">
): TimelineTrack => ({
	name: `Track ${overrides.id}`,
	elements: [],
	...overrides,
});

const makeMediaItem = (id: string, type: "image" | "video" | "audio") =>
	({
		id,
		type,
		name: `${type}-${id}`,
	}) as unknown as MediaItem;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detectAudioSources", () => {
	it("returns zeroes for empty tracks", () => {
		const result = detectAudioSources([], []);

		expect(result).toEqual({
			overlayAudioCount: 0,
			embeddedVideoAudioCount: 0,
			hasAudio: false,
		});
	});

	it("counts a media element on an audio track as overlay audio", () => {
		const tracks: TimelineTrack[] = [
			makeTrack({
				id: "audio-1",
				type: "audio",
				elements: [makeMediaElement("el-1", "media-1")],
			}),
		];
		const mediaItems = [makeMediaItem("media-1", "audio")];

		const result = detectAudioSources(tracks, mediaItems);

		expect(result.overlayAudioCount).toBe(1);
		expect(result.embeddedVideoAudioCount).toBe(0);
		expect(result.hasAudio).toBe(true);
	});

	it("counts a video item on a media track as embedded video audio", () => {
		const tracks: TimelineTrack[] = [
			makeTrack({
				id: "media-track-1",
				type: "media",
				elements: [makeMediaElement("el-1", "vid-1")],
			}),
		];
		const mediaItems = [makeMediaItem("vid-1", "video")];

		const result = detectAudioSources(tracks, mediaItems);

		expect(result.overlayAudioCount).toBe(0);
		expect(result.embeddedVideoAudioCount).toBe(1);
		expect(result.hasAudio).toBe(true);
	});

	it("does not count an image item on a media track", () => {
		const tracks: TimelineTrack[] = [
			makeTrack({
				id: "media-track-1",
				type: "media",
				elements: [makeMediaElement("el-1", "img-1")],
			}),
		];
		const mediaItems = [makeMediaItem("img-1", "image")];

		const result = detectAudioSources(tracks, mediaItems);

		expect(result.overlayAudioCount).toBe(0);
		expect(result.embeddedVideoAudioCount).toBe(0);
		expect(result.hasAudio).toBe(false);
	});

	it("counts both overlay audio and embedded video audio together", () => {
		const tracks: TimelineTrack[] = [
			makeTrack({
				id: "media-track-1",
				type: "media",
				elements: [
					makeMediaElement("el-1", "vid-1"),
					makeMediaElement("el-2", "vid-2"),
				],
			}),
			makeTrack({
				id: "audio-track-1",
				type: "audio",
				elements: [makeMediaElement("el-3", "aud-1")],
			}),
		];
		const mediaItems = [
			makeMediaItem("vid-1", "video"),
			makeMediaItem("vid-2", "video"),
			makeMediaItem("aud-1", "audio"),
		];

		const result = detectAudioSources(tracks, mediaItems);

		expect(result.overlayAudioCount).toBe(1);
		expect(result.embeddedVideoAudioCount).toBe(2);
		expect(result.hasAudio).toBe(true);
	});

	it("ignores text elements on tracks", () => {
		const tracks: TimelineTrack[] = [
			makeTrack({
				id: "text-track-1",
				type: "text",
				elements: [makeTextElement("txt-1")],
			}),
		];

		const result = detectAudioSources(tracks, []);

		expect(result.overlayAudioCount).toBe(0);
		expect(result.embeddedVideoAudioCount).toBe(0);
		expect(result.hasAudio).toBe(false);
	});
});

import { describe, expect, it, vi } from "vitest";
import { planMediaOverlays } from "../claude/handlers/claude-export-handler/media-overlay-plan.js";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types.js";
import type { ClaudeTimeline } from "../types/claude-api.js";

function segment(
	elementId: string,
	trackOrder: number,
	startTime: number,
	duration: number,
	extra: Partial<ExportSegment> = {}
): ExportSegment {
	return {
		elementId,
		trackId: `track-${trackOrder}`,
		trackOrder,
		elementOrder: 0,
		sourcePath: `/media/${elementId}.mov`,
		startTime,
		duration,
		trimStart: 0,
		sourceId: elementId,
		fitMode: "cover",
		...extra,
	};
}

function element(id: string, startTime: number, endTime: number, extra = {}) {
	return {
		id,
		trackIndex: 0,
		type: "media" as const,
		startTime,
		endTime,
		duration: endTime - startTime,
		...extra,
	};
}

function timeline(tracks: ClaudeTimeline["tracks"]): ClaudeTimeline {
	return { name: "t", duration: 15, width: 1280, height: 720, fps: 24, tracks };
}

describe("planMediaOverlays", () => {
	it("joins the main lane and draws the stacked clip over it, with its sound on its own track", async () => {
		const main = segment("main", 1, 0, 15);
		const card = segment("card", 0, 1, 2.5);
		const hasAudioStream = vi.fn(async () => true);
		const plan = await planMediaOverlays({
			timeline: timeline([
				{
					id: "track-0",
					index: 0,
					name: "Overlay",
					type: "media",
					elements: [element("card", 1, 3.5, { volume: 0.5, trimStart: 0.25 })],
				},
				{
					id: "track-1",
					index: 1,
					name: "Main",
					type: "media",
					elements: [element("main", 0, 15)],
				},
			]),
			segments: [main, card],
			hasAudioStream,
		});
		expect(plan.base).toEqual([main]);
		expect(plan.overlays).toEqual([card]);
		expect(plan.overlayAudioFiles).toEqual([
			expect.objectContaining({
				elementId: "card",
				trackId: "track-0",
				path: "/media/card.mov",
				startTime: 1,
				volume: 0.5,
				trimStart: 0.25,
				duration: 2.75,
			}),
		]);
		expect(hasAudioStream).toHaveBeenCalledWith({
			mediaPath: "/media/card.mov",
		});
	});

	it("adds no sound for an overlay without an audio stream, a still or a muted track", async () => {
		const plan = await planMediaOverlays({
			timeline: timeline([
				{
					id: "track-0",
					index: 0,
					name: "Overlay",
					type: "media",
					elements: [element("card", 1, 3.5), element("logo", 4, 6)],
				},
				{
					id: "track-1",
					index: 1,
					name: "Muted",
					type: "media",
					muted: true,
					elements: [element("pip", 7, 9)],
				},
				{
					id: "track-2",
					index: 2,
					name: "Main",
					type: "media",
					elements: [element("main", 0, 15)],
				},
			]),
			segments: [
				segment("main", 2, 0, 15),
				segment("card", 0, 1, 2.5),
				segment("logo", 0, 4, 2, { isImage: true }),
				segment("pip", 1, 7, 2),
			],
			hasAudioStream: async ({ mediaPath }) => mediaPath !== "/media/card.mov",
		});
		expect(plan.overlays.map((overlay) => overlay.elementId)).toEqual([
			"card",
			"logo",
			"pip",
		]);
		expect(plan.overlayAudioFiles).toEqual([]);
	});

	it("keeps a timeline whose clips take turns exactly as before", async () => {
		const segments = [segment("a", 1, 0, 5), segment("b", 0, 5, 5)];
		const plan = await planMediaOverlays({
			timeline: timeline([]),
			segments,
			hasAudioStream: async () => true,
		});
		expect(plan).toEqual({
			base: segments,
			overlays: [],
			overlayAudioFiles: [],
		});
	});

	it("refuses a stack the native export cannot draw, naming why", async () => {
		await expect(
			planMediaOverlays({
				timeline: timeline([
					{
						index: 0,
						name: "Overlay",
						type: "media",
						elements: [element("card", 1, 3.5)],
					},
					{
						index: 1,
						name: "Text",
						type: "text",
						elements: [{ ...element("title", 2, 3), type: "text" }],
					},
					{
						index: 2,
						name: "Main",
						type: "media",
						elements: [element("main", 0, 15)],
					},
				]),
				segments: [segment("main", 2, 0, 15), segment("card", 0, 1, 2.5)],
				hasAudioStream: async () => false,
			})
		).rejects.toThrow(
			"cannot stack this timeline's media overlays (a text layer under a media clip stacked over a lower track)"
		);
	});
});

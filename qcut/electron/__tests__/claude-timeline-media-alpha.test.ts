import { describe, expect, it, vi } from "vitest";
import { withMediaElementAlpha } from "../claude/handlers/claude-timeline-media-alpha.js";
import type { ClaudeTimeline, MediaFile } from "../types/claude-api.js";

function media(
	id: string,
	name: string,
	type: MediaFile["type"] = "video"
): MediaFile {
	return {
		id,
		name,
		type,
		path: `/p/${name}`,
		size: 1,
		createdAt: 0,
		modifiedAt: 0,
	};
}

function clip(id: string, extra: Record<string, unknown>) {
	return {
		id,
		trackIndex: 0,
		type: "media" as const,
		startTime: 0,
		endTime: 2,
		duration: 2,
		...extra,
	};
}

const timeline: ClaudeTimeline = {
	name: "t",
	duration: 15,
	width: 1280,
	height: 720,
	fps: 24,
	tracks: [
		{
			index: 0,
			name: "Overlay",
			type: "media",
			elements: [
				clip("card", { sourceId: "m-card" }),
				clip("plain", { sourceName: "plain.mp4" }),
			],
		},
		{
			index: 1,
			name: "Text",
			type: "text",
			elements: [{ ...clip("title", {}), type: "text" as const }],
		},
	],
};

describe("withMediaElementAlpha", () => {
	it("marks each media clip with its source's alpha, probing only the media in use", async () => {
		const probe = vi.fn(async (files: MediaFile[]) =>
			files.map((file) => ({ ...file, hasAlpha: file.id === "m-card" }))
		);
		const result = await withMediaElementAlpha({
			timeline,
			mediaFiles: [
				media("m-card", "card.mov"),
				media("m-plain", "plain.mp4"),
				media("m-unused", "unused.mp4"),
				media("m-song", "song.wav", "audio"),
			],
			probe,
		});
		expect(probe).toHaveBeenCalledWith([
			media("m-card", "card.mov"),
			media("m-plain", "plain.mp4"),
		]);
		const [card, plain] = result.tracks[0].elements;
		expect(card.hasAlpha).toBe(true);
		expect(plain.hasAlpha).toBe(false);
		expect(result.tracks[1].elements[0]).not.toHaveProperty("hasAlpha");
	});

	it("leaves a clip unmarked when its media could not be probed", async () => {
		const result = await withMediaElementAlpha({
			timeline,
			mediaFiles: [media("m-card", "card.mov")],
			probe: async (files) => files,
		});
		expect(result.tracks[0].elements[0]).not.toHaveProperty("hasAlpha");
	});
});

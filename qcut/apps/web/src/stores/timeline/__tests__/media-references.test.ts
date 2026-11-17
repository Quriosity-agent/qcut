import { describe, expect, it } from "vitest";
import type { TimelineTrack } from "@/types/timeline";
import { repointMediaReferences } from "../media-references";

function track({
	id,
	elements,
	locked = false,
}: {
	id: string;
	elements: Array<Record<string, unknown>>;
	locked?: boolean;
}): TimelineTrack {
	return {
		id,
		name: id,
		type: "media",
		muted: false,
		locked,
		elements,
	} as unknown as TimelineTrack;
}

const OLD = "media_b2xkLm1wNA";
const NEW = "media_bmV3Lm1wNA";

describe("pointing clips at a renamed media item", () => {
	it("repoints every clip of the old id and nothing else", () => {
		const untouched = track({
			id: "titles",
			elements: [
				{ id: "t1", type: "text", content: "Title" },
				{ id: "m9", type: "media", mediaId: "media_other" },
			],
		});
		const tracks = [
			track({
				id: "main",
				elements: [
					{ id: "a", type: "media", mediaId: OLD, startTime: 0 },
					{ id: "b", type: "media", mediaId: "media_other", startTime: 4 },
					{ id: "c", type: "media", mediaId: OLD, startTime: 8 },
				],
			}),
			untouched,
		];
		const result = repointMediaReferences({ tracks, fromId: OLD, toId: NEW });
		expect(result.changed).toBe(2);
		expect(
			result.tracks[0].elements.map((element) =>
				element.type === "media" ? element.mediaId : null
			)
		).toEqual([NEW, "media_other", NEW]);
		// What did not change keeps its object, so nothing reads it as edited.
		expect(result.tracks[1]).toBe(untouched);
		expect(result.tracks[0].elements[1]).toBe(tracks[0].elements[1]);
		// The input is left alone.
		expect(
			tracks[0].elements.map((element) =>
				element.type === "media" ? element.mediaId : null
			)
		).toEqual([OLD, "media_other", OLD]);
	});

	it("repoints a clip on a locked track: the reference is kept whole, the clip is not edited", () => {
		const tracks = [
			track({
				id: "locked",
				locked: true,
				elements: [{ id: "a", type: "media", mediaId: OLD }],
			}),
		];
		const result = repointMediaReferences({ tracks, fromId: OLD, toId: NEW });
		expect(result.changed).toBe(1);
		expect(result.tracks[0].locked).toBe(true);
	});

	it("repoints a sticker on the timeline, which names its picture by media id", () => {
		const tracks = [
			{
				...track({ id: "stickers", elements: [] }),
				type: "sticker",
				elements: [
					{ id: "s1", type: "sticker", stickerId: "badge", mediaId: OLD },
					{ id: "s2", type: "sticker", stickerId: "other", mediaId: "media_x" },
				],
			} as unknown as TimelineTrack,
		];
		const result = repointMediaReferences({ tracks, fromId: OLD, toId: NEW });
		expect(result.changed).toBe(1);
		expect(result.tracks[0].elements[0]).toMatchObject({
			type: "sticker",
			stickerId: "badge",
			mediaId: NEW,
		});
		expect(result.tracks[0].elements[1]).toBe(tracks[0].elements[1]);
	});

	it("hands back the same tracks when no clip plays the old id", () => {
		const tracks = [
			track({
				id: "main",
				elements: [{ id: "a", type: "media", mediaId: "media_other" }],
			}),
		];
		expect(repointMediaReferences({ tracks, fromId: OLD, toId: NEW })).toEqual({
			tracks,
			changed: 0,
		});
		expect(
			repointMediaReferences({ tracks, fromId: OLD, toId: NEW }).tracks
		).toBe(tracks);
		expect(
			repointMediaReferences({ tracks, fromId: OLD, toId: OLD }).changed
		).toBe(0);
	});
});

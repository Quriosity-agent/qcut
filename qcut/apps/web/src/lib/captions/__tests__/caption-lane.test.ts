import { describe, expect, it } from "vitest";
import type { CreateCaptionElement, TimelineTrack } from "@/types/timeline";
import { partitionCaptionBatch, pickCaptionLane } from "../caption-lane";

function caption({
	start,
	duration,
	id,
}: {
	start: number;
	duration: number;
	id?: string;
}): CreateCaptionElement & { id?: string } {
	return {
		...(id ? { id } : {}),
		type: "captions",
		name: `caption ${start}`,
		text: `caption ${start}`,
		language: "zh",
		source: "transcription",
		startTime: start,
		duration,
		trimStart: 0,
		trimEnd: 0,
	};
}

function lane(id: string, elements: TimelineTrack["elements"]): TimelineTrack {
	return { id, name: id, type: "captions", elements };
}

describe("pickCaptionLane", () => {
	const batch = [
		caption({ start: 0.3, duration: 2.5 }),
		caption({ start: 3, duration: 2 }),
	];

	it("reuses an empty captions lane", () => {
		expect(
			pickCaptionLane({
				tracks: [lane("captions-1", [])],
				elements: batch,
				fps: 30,
			})
		).toBe("captions-1");
	});

	it("skips a lane whose captions collide with the batch", () => {
		const busy = lane("busy", [
			caption({ start: 0.5, duration: 4, id: "manual" }) as never,
		]);
		const free = lane("free", [
			caption({ start: 8, duration: 2, id: "later" }) as never,
		]);
		expect(
			pickCaptionLane({ tracks: [busy, free], elements: batch, fps: 30 })
		).toBe("free");
	});

	it("returns null when every lane collides or none exists", () => {
		const busy = lane("busy", [
			caption({ start: 4, duration: 2, id: "manual" }) as never,
		]);
		expect(pickCaptionLane({ tracks: [busy], elements: batch, fps: 30 })).toBe(
			null
		);
		expect(pickCaptionLane({ tracks: [], elements: batch, fps: 30 })).toBe(
			null
		);
	});

	it("skips locked lanes, which would reject every caption", () => {
		const locked = { ...lane("locked", []), locked: true };
		expect(
			pickCaptionLane({
				tracks: [locked, lane("open", [])],
				elements: batch,
				fps: 30,
			})
		).toBe("open");
	});

	it("ignores non-caption lanes", () => {
		const media: TimelineTrack = {
			id: "main",
			name: "main",
			type: "media",
			isMain: true,
			elements: [],
		};
		expect(pickCaptionLane({ tracks: [media], elements: batch, fps: 30 })).toBe(
			null
		);
	});
});

describe("partitionCaptionBatch", () => {
	const names = (groups: CreateCaptionElement[][]) =>
		groups.map((group) => group.map((element) => element.name));

	it("keeps a batch without overlaps as one group", () => {
		const groups = partitionCaptionBatch({
			elements: [
				caption({ start: 3, duration: 2 }),
				caption({ start: 0, duration: 3 }),
			],
		});
		expect(names(groups)).toEqual([["caption 0", "caption 3"]]);
	});

	it("moves overlapping cues to further groups so no lane rejects them", () => {
		const groups = partitionCaptionBatch({
			elements: [
				caption({ start: 0, duration: 4 }),
				caption({ start: 1, duration: 1 }),
				caption({ start: 1.5, duration: 1 }),
				caption({ start: 4, duration: 1 }),
			],
		});
		expect(names(groups)).toEqual([
			["caption 0", "caption 4"],
			["caption 1"],
			["caption 1.5"],
		]);
	});

	it("measures captions by their trimmed length", () => {
		const trimmed = { ...caption({ start: 0, duration: 4 }), trimEnd: 3 };
		const groups = partitionCaptionBatch({
			elements: [trimmed, caption({ start: 1, duration: 1 })],
		});
		expect(groups).toHaveLength(1);
	});
});

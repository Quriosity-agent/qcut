import { describe, expect, it } from "vitest";
import type { CreateCaptionElement, TimelineTrack } from "@/types/timeline";
import { pickCaptionLane } from "../caption-lane";

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

import { describe, expect, it } from "vitest";
import { TRANSITION_SEAM_TOLERANCE_SECONDS } from "@qcut/editor-core/timeline";
import {
	findOccupyingElement,
	findOverlappingPair,
	firstFreeStartTime,
	getSeamToleranceSeconds,
} from "@/lib/timeline-occupancy";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";

function mediaElement({
	id,
	startTime,
	duration,
}: {
	id: string;
	startTime: number;
	duration: number;
}): TimelineElement {
	return {
		id,
		type: "media",
		name: id,
		mediaId: `media-${id}`,
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
	} as TimelineElement;
}

function trackWith({
	elements,
	type = "media",
}: {
	elements: TimelineElement[];
	type?: TimelineTrack["type"];
}): TimelineTrack {
	return { id: "track-1", name: "track", type, elements } as TimelineTrack;
}

describe("findOccupyingElement", () => {
	it("finds the element already sitting at the requested span", () => {
		const track = trackWith({
			elements: [mediaElement({ id: "a", startTime: 0, duration: 10 })],
		});
		const hit = findOccupyingElement({ track, startTime: 0, duration: 10 });
		expect(hit?.id).toBe("a");
	});

	it("treats a back-to-back seam as free, not as a collision", () => {
		// The split of one clip into two produces exactly this arrangement, so
		// rejecting it would make splitting impossible.
		const track = trackWith({
			elements: [mediaElement({ id: "a", startTime: 0, duration: 10 })],
		});
		expect(
			findOccupyingElement({ track, startTime: 10, duration: 5 })
		).toBeNull();
	});

	it("catches a partial overlap from either side", () => {
		const track = trackWith({
			elements: [mediaElement({ id: "a", startTime: 10, duration: 10 })],
		});
		expect(
			findOccupyingElement({ track, startTime: 5, duration: 10 })?.id
		).toBe("a");
		expect(
			findOccupyingElement({ track, startTime: 15, duration: 10 })?.id
		).toBe("a");
	});

	it("catches an element wholly containing another", () => {
		const track = trackWith({
			elements: [mediaElement({ id: "a", startTime: 5, duration: 2 })],
		});
		expect(
			findOccupyingElement({ track, startTime: 0, duration: 20 })?.id
		).toBe("a");
	});

	it("ignores the element being moved", () => {
		const track = trackWith({
			elements: [mediaElement({ id: "a", startTime: 0, duration: 10 })],
		});
		expect(
			findOccupyingElement({
				track,
				startTime: 2,
				duration: 5,
				excludeElementId: "a",
			})
		).toBeNull();
	});

	it("applies to sticker tracks too — many stickers, one at a time", () => {
		const track = trackWith({
			elements: [mediaElement({ id: "a", startTime: 0, duration: 3 })],
			type: "sticker",
		});
		// A second sticker later on the same track is fine...
		expect(
			findOccupyingElement({ track, startTime: 3, duration: 3 })
		).toBeNull();
		// ...but not one on top of the first.
		expect(findOccupyingElement({ track, startTime: 1, duration: 3 })?.id).toBe(
			"a"
		);
	});

	it("reproduces the stack the CLI created at t=0", () => {
		const track = trackWith({
			elements: [
				mediaElement({ id: "clip-a", startTime: 0, duration: 10 }),
				mediaElement({ id: "clip-b", startTime: 0, duration: 6 }),
			],
		});
		expect(
			findOccupyingElement({ track, startTime: 0, duration: 10 })?.id
		).toBe("clip-a");
	});
});

describe("firstFreeStartTime", () => {
	it("returns the requested time when the span is already free", () => {
		const track = trackWith({
			elements: [mediaElement({ id: "a", startTime: 0, duration: 5 })],
		});
		expect(firstFreeStartTime({ track, duration: 2, notBefore: 5 })).toBe(5);
	});

	it("skips past the blocking element", () => {
		const track = trackWith({
			elements: [mediaElement({ id: "a", startTime: 0, duration: 10 })],
		});
		expect(firstFreeStartTime({ track, duration: 4, notBefore: 0 })).toBe(10);
	});

	it("finds a gap between two elements when the clip fits", () => {
		const track = trackWith({
			elements: [
				mediaElement({ id: "a", startTime: 0, duration: 5 }),
				mediaElement({ id: "b", startTime: 12, duration: 5 }),
			],
		});
		expect(firstFreeStartTime({ track, duration: 4, notBefore: 0 })).toBe(5);
	});

	it("skips a gap that is too small and lands after the last element", () => {
		const track = trackWith({
			elements: [
				mediaElement({ id: "a", startTime: 0, duration: 5 }),
				mediaElement({ id: "b", startTime: 6, duration: 5 }),
			],
		});
		expect(firstFreeStartTime({ track, duration: 4, notBefore: 0 })).toBe(11);
	});

	it("ignores the element being moved", () => {
		const track = trackWith({
			elements: [mediaElement({ id: "a", startTime: 0, duration: 10 })],
		});
		expect(
			firstFreeStartTime({
				track,
				duration: 4,
				notBefore: 0,
				excludeElementId: "a",
			})
		).toBe(0);
	});
});

describe("getSeamToleranceSeconds", () => {
	it("is half a frame at the project frame rate", () => {
		expect(getSeamToleranceSeconds(24)).toBeCloseTo(1 / 48, 12);
		expect(getSeamToleranceSeconds(60)).toBeCloseTo(1 / 120, 12);
	});

	it("never exceeds the seam tolerance transitions use", () => {
		expect(getSeamToleranceSeconds(10)).toBe(TRANSITION_SEAM_TOLERANCE_SECONDS);
	});

	it("falls back to 30 fps for a missing or invalid frame rate", () => {
		expect(getSeamToleranceSeconds(0)).toBe(getSeamToleranceSeconds(30));
		expect(getSeamToleranceSeconds(Number.NaN)).toBe(
			getSeamToleranceSeconds(30)
		);
	});
});

describe("seams computed in floating point", () => {
	it("treats a seam that misses by float residue as touching", () => {
		// 100.20833 + 17.041667 is 117.24999700000001 in binary floating point,
		// a hair past the 117.249997 the caller sent for the next clip.
		const track = trackWith({
			elements: [
				mediaElement({ id: "six", startTime: 100.20833, duration: 17.041667 }),
				mediaElement({ id: "eight", startTime: 133.291664, duration: 4 }),
			],
		});
		expect(
			findOccupyingElement({
				track,
				startTime: 117.249997,
				duration: 16.041667,
				fps: 24,
			})
		).toBeNull();
		expect(
			findOccupyingElement({
				track: trackWith({
					elements: [mediaElement({ id: "a", startTime: 0.1, duration: 0.2 })],
				}),
				startTime: 0.3,
				duration: 1,
			})
		).toBeNull();
	});

	it("still rejects an overlap of one whole frame", () => {
		const track = trackWith({
			elements: [mediaElement({ id: "a", startTime: 0, duration: 1 })],
		});
		for (const fps of [24, 30, 60]) {
			expect(
				findOccupyingElement({
					track,
					startTime: 1 - 1 / fps,
					duration: 1,
					fps,
				})?.id
			).toBe("a");
		}
	});

	it("accepts any chain of clips laid end to end with 6-decimal seconds", () => {
		// Each start is the previous start plus its duration, rounded to six
		// decimals the way a CLI caller writes them.
		const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
		let seed = 7;
		const nextFrameCount = () => {
			seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
			return 24 + (seed % 900);
		};
		for (let run = 0; run < 200; run++) {
			const placed: TimelineElement[] = [];
			let startTime = 0;
			for (let index = 0; index < 12; index++) {
				const duration = round6(nextFrameCount() / 24);
				const track = trackWith({ elements: placed });
				expect(
					findOccupyingElement({ track, startTime, duration, fps: 24 })
				).toBeNull();
				placed.push(mediaElement({ id: `clip-${index}`, startTime, duration }));
				startTime = round6(startTime + duration);
			}
			expect(findOverlappingPair({ elements: placed, fps: 24 })).toBeNull();
		}
	});
});

import { describe, expect, it } from "vitest";
import type { MediaElement } from "@/types/timeline";
import { overwriteRangeInElements } from "../timeline-collision-utils";

function clip({
	id,
	startTime,
	duration,
}: {
	id: string;
	startTime: number;
	duration: number;
}): MediaElement {
	return {
		id,
		name: id,
		type: "media",
		mediaId: `${id}-media`,
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
	};
}

/**
 * The ripple-delete drill left 0 s and 0.000367 s clips behind: a clip whose
 * end sat a hair past the range end was "split" into a remnant. Anything
 * shorter than half a frame outside the range is rounding, not a clip.
 */
describe("range deletion remnants", () => {
	it("drops a sub-frame remnant past the range end instead of keeping it", () => {
		const result = overwriteRangeInElements({
			elements: [clip({ id: "a", startTime: 0, duration: 10.000367 })],
			range: { startTime: 5, endTime: 10 },
			fps: 24,
		});
		expect(result.elements.map((element) => element.id)).toEqual(["a"]);
		// Only the left part survives, trimmed to the range start.
		expect(result.elements[0].startTime).toBe(0);
		expect(
			result.elements[0].duration -
				result.elements[0].trimStart -
				result.elements[0].trimEnd
		).toBeCloseTo(5, 6);
		expect(result.splitElements).toBe(1);
	});

	it("still keeps a real overhang", () => {
		const result = overwriteRangeInElements({
			elements: [clip({ id: "a", startTime: 0, duration: 12 })],
			range: { startTime: 5, endTime: 10 },
			fps: 24,
		});
		expect(result.elements).toHaveLength(2);
		expect(result.elements[1].startTime).toBe(10);
		expect(
			result.elements[1].duration -
				result.elements[1].trimStart -
				result.elements[1].trimEnd
		).toBeCloseTo(2, 6);
	});

	it("deletes a clip that starts a hair before the range outright", () => {
		const result = overwriteRangeInElements({
			elements: [clip({ id: "a", startTime: 4.9999, duration: 5.0001 })],
			range: { startTime: 5, endTime: 10 },
			fps: 24,
		});
		expect(result.elements).toEqual([]);
		expect(result.deletedElements).toBe(1);
	});
});

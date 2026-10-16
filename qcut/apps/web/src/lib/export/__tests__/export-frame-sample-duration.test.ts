import { describe, expect, it } from "vitest";
import {
	calculateFrameSampleDuration,
	calculateTotalFrames,
} from "../export-engine-utils";

/**
 * The muxer rounds a timeline up to whole frames; the last frame then has to
 * stop where the timeline stops, or the file (and the picture's last frame)
 * runs up to a frame past the native export.
 */
describe("calculateFrameSampleDuration", () => {
	it("gives every frame but the last a full frame", () => {
		const totalFrames = calculateTotalFrames(214.7167, 24);
		expect(totalFrames).toBe(5154);
		for (const frameIndex of [0, 1, 2600, totalFrames - 2]) {
			expect(
				calculateFrameSampleDuration({
					frameIndex,
					totalFrames,
					fps: 24,
					totalDuration: 214.7167,
				})
			).toBe(1 / 24);
		}
	});

	it("cuts the last frame to the timeline's remainder", () => {
		// 214.7167 s at 24 fps is 5153.2 frames: the last one lasts 0.2 frame.
		const last = calculateFrameSampleDuration({
			frameIndex: 5153,
			totalFrames: 5154,
			fps: 24,
			totalDuration: 214.7167,
		});
		expect(last).toBeCloseTo(214.7167 - 5153 / 24, 9);
		expect(5153 / 24 + last).toBeCloseTo(214.7167, 9);
	});

	it("keeps a full last frame when the timeline is frame-aligned or the remainder is noise", () => {
		expect(
			calculateFrameSampleDuration({
				frameIndex: 119,
				totalFrames: 120,
				fps: 30,
				totalDuration: 4,
			})
		).toBe(1 / 30);
		// 4.0000001 s rounds up to a 121st frame that would last 0.1 µs.
		expect(
			calculateFrameSampleDuration({
				frameIndex: 120,
				totalFrames: 121,
				fps: 30,
				totalDuration: 4.0000001,
			})
		).toBe(1 / 30);
	});
});

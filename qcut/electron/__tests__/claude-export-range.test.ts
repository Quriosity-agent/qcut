import { describe, expect, it } from "vitest";
import { resolveTimelineRange } from "../claude/handlers/claude-export-handler/export-range";

/**
 * Part of the timeline for `export start` and `mix loudness`
 * (2026-11-09: checking 30 s of a 218 s trailer took two full exports).
 */
/** The trailer's length: 5248 frames at 24 fps. */
const TRAILER = 5248 / 24;

describe("resolveTimelineRange", () => {
	it("snaps both ends to the nearest frame", () => {
		expect(
			resolveTimelineRange({
				range: { startTime: 155.583, endTime: 185.75 },
				duration: TRAILER,
				fps: 24,
			})
		).toEqual({ start: 3734 / 24, end: 4458 / 24 });
	});

	it("runs from 0 without a start and to the end without an end", () => {
		expect(
			resolveTimelineRange({ range: { endTime: 10 }, duration: 60, fps: 30 })
		).toEqual({ start: 0, end: 10 });
		expect(
			resolveTimelineRange({ range: { startTime: 50 }, duration: 60 })
		).toEqual({ start: 50, end: 60 });
	});

	it("takes an end that rounds to the timeline's end", () => {
		expect(
			resolveTimelineRange({
				range: { startTime: 200, endTime: 218.68 },
				duration: TRAILER,
				fps: 24,
			}).end
		).toBe(TRAILER);
	});

	it.each([
		{
			range: { startTime: 218.667 },
			error: "at or after the end of the timeline",
		},
		{ range: { endTime: 230 }, error: "after the end of the timeline" },
		{ range: { startTime: -1 }, error: "0 or more" },
		{ range: { startTime: Number.NaN }, error: "0 or more" },
		{ range: { startTime: 10, endTime: 10.01 }, error: "is empty" },
		{ range: { startTime: 12, endTime: 10 }, error: "is empty" },
	])("refuses $range", ({ range, error }) => {
		expect(() =>
			resolveTimelineRange({ range, duration: TRAILER, fps: 24 })
		).toThrow(error);
	});
});

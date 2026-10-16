import { describe, expect, it } from "vitest";
import {
	buildGapSegmentEncodeArgs,
	findTimelineGaps,
	orderConcatInputs,
} from "../claude/handlers/claude-export-handler/gap-segments.js";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types.js";

function segment({
	id,
	startTime,
	duration,
}: {
	id: string;
	startTime: number;
	duration: number;
}): ExportSegment {
	return {
		elementId: id,
		trackId: "main",
		trackOrder: 0,
		elementOrder: 0,
		sourcePath: `/media/${id}.mp4`,
		startTime,
		duration,
		trimStart: 0,
		sourceId: id,
		fitMode: "cover",
	};
}

describe("findTimelineGaps", () => {
	it("finds the gap before the first clip and between clips, never inside overlaps", () => {
		const gaps = findTimelineGaps({
			fps: 30,
			segments: [
				segment({ id: "a", startTime: 1, duration: 2 }),
				segment({ id: "b", startTime: 3, duration: 2 }),
				// A lane that overlaps "b" ends later than "b" does.
				segment({ id: "c", startTime: 4, duration: 3 }),
				segment({ id: "d", startTime: 8.5, duration: 1 }),
			],
		});
		expect(gaps).toEqual([
			{ beforeSegment: 0, startTime: 0, duration: 1 },
			{ beforeSegment: 3, startTime: 7, duration: 1.5 },
		]);
	});

	it("ignores seams shorter than half a frame", () => {
		expect(
			findTimelineGaps({
				fps: 30,
				segments: [
					segment({ id: "a", startTime: 0, duration: 2 }),
					segment({ id: "b", startTime: 2.01, duration: 2 }),
				],
			})
		).toEqual([]);
	});
});

describe("buildGapSegmentEncodeArgs", () => {
	it("encodes black and silence with the segments' codec, size, rate and sound shape", () => {
		const args = buildGapSegmentEncodeArgs({
			gap: { beforeSegment: 1, startTime: 2, duration: 1.5 },
			settings: {
				width: 1280,
				height: 720,
				fps: 25,
				codec: "libx264",
				bitrate: "6M",
			},
			audio: { sampleRate: 44_100, channels: 1 },
			outputPath: "/tmp/gap-0000.mp4",
		});
		expect(args).toContain("color=c=black:s=1280x720:r=25");
		expect(args).toContain("anullsrc=r=44100:cl=mono");
		expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual([
			"-t",
			"1.5",
		]);
		expect(args).toContain("libx264");
		expect(args).toContain("yuv420p");
		expect(args.at(-1)).toBe("/tmp/gap-0000.mp4");
	});
});

describe("orderConcatInputs", () => {
	it("puts each gap clip before the segment it precedes", () => {
		expect(
			orderConcatInputs({
				segmentOutputs: ["s0.mp4", "s1.mp4", "s2.mp4"],
				gaps: [
					{ beforeSegment: 0, startTime: 0, duration: 1 },
					{ beforeSegment: 2, startTime: 5, duration: 0.5 },
				],
				gapOutputs: ["g0.mp4", "g1.mp4"],
			})
		).toEqual(["g0.mp4", "s0.mp4", "s1.mp4", "g1.mp4", "s2.mp4"]);
	});
});

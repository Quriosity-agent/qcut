import { describe, expect, it } from "vitest";
import type { TimelineTrack } from "@/types/timeline";
import { exportAssStyled } from "../caption-export";

/**
 * N25 (2026-10-30 trailer report): a styled ASS export keeps a caption's
 * fade frames when it is given the project's frame rate.
 */

const tracks = [
	{
		id: "captions",
		name: "字幕 电影",
		type: "captions",
		elements: [
			{
				id: "cue",
				type: "captions",
				name: "三年前",
				text: "三年前",
				language: "zh",
				source: "manual",
				startTime: 1,
				duration: 1,
				trimStart: 0,
				trimEnd: 0,
				style: { fadeInFrames: 4, fadeOutFrames: 3 },
			},
		],
	},
] as unknown as TimelineTrack[];

describe("styled ASS caption export", () => {
	it("writes the fade frames at the rate it is given, and none without one", () => {
		const resolution = { width: 1470, height: 630 };
		expect(exportAssStyled({ tracks, resolution, fps: 24 })).toContain(
			"\\fade(255,0,255,0,167,875,1000)"
		);
		expect(exportAssStyled({ tracks, resolution })).not.toContain("\\fade(");
	});
});

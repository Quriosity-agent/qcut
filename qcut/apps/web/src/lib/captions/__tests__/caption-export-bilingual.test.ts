import { describe, expect, it } from "vitest";
import type { TimelineTrack } from "@/types/timeline";
import {
	exportAss,
	exportSrt,
	exportTtml,
	exportVtt,
	extractCaptionSegments,
} from "../caption-export";

/**
 * A bilingual caption (N11 follow-up) exports as one cue whose second line
 * is the second-language line, in every subtitle format.
 */

const tracks = [
	{
		id: "captions",
		name: "字幕",
		type: "captions",
		elements: [
			{
				id: "duo",
				type: "captions",
				name: "三年前",
				text: "三年前",
				secondaryText: " Three years ago ",
				language: "zh",
				source: "manual",
				startTime: 1,
				duration: 2,
				trimStart: 0,
				trimEnd: 0,
			},
		],
	},
] as unknown as TimelineTrack[];

describe("bilingual caption export", () => {
	const segments = extractCaptionSegments(tracks);

	it("writes the second line as the cue's second line in SRT and VTT", () => {
		expect(exportSrt(segments)).toBe(
			"1\n00:00:01,000 --> 00:00:03,000\n三年前\nThree years ago"
		);
		expect(exportVtt(segments)).toContain(
			"00:00:01.000 --> 00:00:03.000\n三年前\nThree years ago"
		);
	});

	it("keeps an ASS cue on one Dialogue line and breaks it with \\N", () => {
		const dialogue = exportAss(segments)
			.split("\n")
			.filter((line) => line.startsWith("Dialogue:"));
		expect(dialogue).toHaveLength(1);
		expect(dialogue[0]).toMatch(/,三年前\\NThree years ago$/);
	});

	it("breaks a TTML cue with <br/>", () => {
		expect(exportTtml(segments)).toContain("三年前<br/>Three years ago</p>");
	});
});

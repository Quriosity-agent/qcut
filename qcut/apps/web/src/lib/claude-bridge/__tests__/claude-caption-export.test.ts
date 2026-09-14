import { describe, expect, it } from "vitest";
import type { TimelineTrack } from "@/types/timeline";
import { formatTracksForExport } from "../claude-timeline-bridge-helpers";

describe("Claude caption export", () => {
	it("preserves caption text and language for Compose read-back", () => {
		const tracks: TimelineTrack[] = [
			{
				id: "captions",
				name: "Compose Captions",
				type: "captions",
				elements: [
					{
						id: "caption-1",
						type: "captions",
						name: "Grace in motion",
						text: "Grace in motion",
						language: "en",
						source: "manual",
						startTime: 1,
						duration: 2,
						trimStart: 0,
						trimEnd: 0,
					},
				],
			},
		];

		const [caption] = formatTracksForExport({ tracks, fps: 30 })[0].elements;

		expect(caption).toMatchObject({
			type: "captions",
			content: "Grace in motion",
			language: "en",
		});
		expect(caption.style).toBeUndefined();
	});

	it("keeps the caption style so native export burns in the styled look", () => {
		const style = { fontSize: 56, fontColor: "#ffe066", bold: true };
		const tracks: TimelineTrack[] = [
			{
				id: "captions",
				name: "Styled Captions",
				type: "captions",
				elements: [
					{
						id: "caption-1",
						type: "captions",
						name: "Styled",
						text: "Styled",
						language: "zh",
						source: "manual",
						startTime: 0.5,
						duration: 4,
						trimStart: 0,
						trimEnd: 0,
						style: style as never,
						emphasis: true,
					},
				],
			},
		];

		const [caption] = formatTracksForExport({ tracks, fps: 30 })[0].elements;

		expect(caption.style).toEqual(style);
		expect(caption.emphasis).toBe(true);
	});
});

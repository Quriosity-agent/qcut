import { describe, expect, it } from "vitest";
import type { CaptionElement, TimelineTrack } from "@/types/timeline";
import {
	captionBlockHeight,
	captionStackOffset,
	captionsSharingEdge,
} from "../caption-stacking";

function caption({
	id,
	startTime,
	duration,
	style,
}: {
	id: string;
	startTime: number;
	duration: number;
	style?: Record<string, unknown>;
}): CaptionElement {
	return {
		id,
		type: "captions",
		name: id,
		text: id,
		language: "zh",
		source: "manual",
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
		style,
	} as unknown as CaptionElement;
}

const first = caption({ id: "first", startTime: 0.5, duration: 2.1 });
const second = caption({ id: "second", startTime: 1, duration: 1.4 });
const later = caption({ id: "later", startTime: 3, duration: 1 });
const top = caption({
	id: "top",
	startTime: 1,
	duration: 1,
	style: { position: { align: "top", x: 50, y: 10 } },
});
const tracks = [
	{ id: "lane-2", name: "字幕 2", type: "captions", elements: [second, top] },
	{ id: "lane-1", name: "字幕 1", type: "captions", elements: [first, later] },
] as unknown as TimelineTrack[];

describe("caption stacking", () => {
	it("keeps the earliest caption at the edge and stacks the later one above it", () => {
		expect(
			captionsSharingEdge({ tracks, element: second }).map((c) => c.id)
		).toEqual(["first", "second"]);
		expect(captionStackOffset({ tracks, element: first })).toBe(0);
		// 48 px × 1.4 line spacing + 2 × 8 px box padding.
		expect(captionStackOffset({ tracks, element: second })).toBeCloseTo(
			83.2,
			5
		);
		expect(captionBlockHeight({ element: first })).toBeCloseTo(83.2, 5);
	});

	it("stacks only captions that share the edge and overlap in time", () => {
		// The top-aligned caption shares no edge with the bottom ones.
		expect(captionStackOffset({ tracks, element: top })).toBe(0);
		// A caption that starts after the others have ended stands alone.
		expect(captionStackOffset({ tracks, element: later })).toBe(0);
		expect(
			captionsSharingEdge({ tracks, element: later }).map((c) => c.id)
		).toEqual(["later"]);
	});

	it("leaves hidden tracks and centre-aligned captions out of the stack", () => {
		const hidden = [
			{ ...tracks[1], hidden: true },
			tracks[0],
		] as unknown as TimelineTrack[];
		expect(captionStackOffset({ tracks: hidden, element: second })).toBe(0);
		const centred = caption({
			id: "centred",
			startTime: 0,
			duration: 5,
			style: { position: { align: "center", x: 50, y: 50 } },
		});
		expect(
			captionStackOffset({
				tracks: [
					{ ...tracks[1], elements: [first, centred] },
				] as unknown as TimelineTrack[],
				element: centred,
			})
		).toBe(0);
	});

	it("counts a bilingual caption's second line at its own size", () => {
		const duo = {
			...caption({ id: "duo", startTime: 0, duration: 2 }),
			text: "三年前",
			secondaryText: "Three years ago",
			style: { fontSize: 34, secondary: { fontSize: 24 } },
		} as unknown as CaptionElement;
		// (34 + 24) × 1.4 for the two line boxes, plus 2 × 8 px of padding.
		expect(captionBlockHeight({ element: duo })).toBeCloseTo(
			(34 + 24) * 1.4 + 16,
			5
		);
		// Without its own size, the second line is the caption's size.
		expect(
			captionBlockHeight({
				element: { ...duo, style: { fontSize: 34 } } as CaptionElement,
			})
		).toBeCloseTo(2 * 34 * 1.4 + 16, 5);
	});

	it("lifts a caption by every line of a two-line caption under it (N11)", () => {
		// Bilingual: the English line underneath breaks into two lines.
		const english = {
			...caption({ id: "english", startTime: 22.75, duration: 1.45 }),
			text: "Don't fight anymore?\nYour fists are more honest than you.",
		} as CaptionElement;
		const chinese = caption({
			id: "chinese",
			startTime: 22.75,
			duration: 1.45,
		});
		const bilingual = [
			{ id: "zh", name: "字幕 中文", type: "captions", elements: [chinese] },
			{ id: "en", name: "字幕 英文", type: "captions", elements: [english] },
		] as unknown as TimelineTrack[];
		// Same start: the upper track's caption sits above the lower track's.
		expect(
			captionsSharingEdge({ tracks: bilingual, element: chinese }).map(
				(c) => c.id
			)
		).toEqual(["english", "chinese"]);
		// Two 48 px lines at 1.4 spacing plus the box's 2 × 8 px padding.
		expect(
			captionStackOffset({ tracks: bilingual, element: chinese })
		).toBeCloseTo(2 * 48 * 1.4 + 16, 5);
	});
});

import { describe, expect, it } from "vitest";
import { resolveSubtitleStyle } from "@qcut/editor-core";
import type { CaptionElement, SubtitleStyle } from "@/types/timeline";
import {
	measurePreviewCaptionBlockHeight,
	selectPreviewCaptionWords,
} from "../caption-preview-measurement";
import { captionStackOffset } from "../caption-stacking";

function fixture({
	mode = "karaoke",
}: {
	mode?: SubtitleStyle["karaokeMode"];
} = {}): CaptionElement {
	return {
		id: "timed",
		type: "captions",
		name: "Timed",
		text: "stale",
		secondaryText: "This secondary text is hidden by the timed-word preview.",
		language: "en",
		source: "manual",
		startTime: 1,
		duration: 4,
		trimStart: 0,
		trimEnd: 0,
		style: resolveSubtitleStyle({
			fontSize: 20,
			lineSpacing: 1.2,
			karaokeMode: mode,
		}),
		words: ["AAAAA", "BBBBB", "CCCCC", "DDDDD", "EEEEE"].map((text, index) => ({
			id: String(index),
			text,
			type: "word",
			start: 1 + index * 0.5,
			end: 1.4 + index * 0.5,
		})),
	};
}

const measureText = ({ text }: { text: string }) => text.length * 10;

describe("preview caption block measurement", () => {
	it.each([
		{ text: "中文字幕".repeat(9), expected: 88 },
		{ text: "A".repeat(36), expected: 40 },
		{ text: "AAAAAA BBBBBB CCCCCC", expected: 88 },
		{ text: "AAAAAAAAAAAA-BBBBBBBBBBBB", expected: 64 },
	])("matches internal timed-word span wrapping for $text", ({
		text,
		expected,
	}) => {
		const element = fixture();
		element.words = [{ ...element.words![0], text }];
		expect(
			measurePreviewCaptionBlockHeight({ element, width: 240, measureText })
		).toBe(expected);
	});

	it("reserves the largest internally wrapped single word for its whole lifetime", () => {
		const element = fixture({ mode: "word-by-word" });
		element.words![2].text = "中文字幕".repeat(9);
		expect(
			measurePreviewCaptionBlockHeight({ element, width: 240, measureText })
		).toBe(88);
	});

	it("packs actual timed words with the DOM's horizontal and vertical gaps", () => {
		const element = fixture();
		// At 240px the content area is128px: two50px words +4px fit per row.
		expect(
			measurePreviewCaptionBlockHeight({ element, width: 240, measureText })
		).toBe(3 * 24 + 2 * 4 + 16);
		expect(
			measurePreviewCaptionBlockHeight({ element, width: 400, measureText })
		).toBe(2 * 24 + 4 + 16);
	});

	it.each([
		"word-by-word",
		"typewriter",
	] as const)("keeps a stable maximum block for %s", (mode) => {
		expect(
			measurePreviewCaptionBlockHeight({
				element: fixture({ mode }),
				width: 240,
				measureText,
			})
		).toBe(mode === "word-by-word" ? 40 : 96);
	});

	it("uses the same inclusive segment tolerance and word ordering as the preview", () => {
		const words = [
			{ id: "inside", type: "word", start: 1, end: 2 },
			{ id: "start-edge", type: "word", start: 0.95, end: 1 },
			{ id: "end-edge", type: "word", start: 4, end: 5.05 },
			{ id: "early", type: "word", start: 0.94, end: 1 },
			{ id: "late", type: "word", start: 4, end: 5.06 },
			{ id: "space", type: "spacing", start: 2, end: 3 },
		] as const;
		expect(
			selectPreviewCaptionWords({
				words,
				startTime: 1,
				endTime: 5,
				mode: "karaoke",
			}).map(({ id }) => id)
		).toEqual(["inside", "start-edge", "end-edge"]);
		expect(
			selectPreviewCaptionWords({
				words,
				startTime: 1,
				endTime: 5,
				mode: "none",
			})
		).toEqual([]);
	});

	it("resolves each predecessor's own font properties in the stack callback", () => {
		const first = fixture();
		first.style = resolveSubtitleStyle({
			...first.style,
			fontWeight: 800,
			italic: true,
			letterSpacing: 3,
		});
		const second = { ...fixture(), id: "second", startTime: 1.5 };
		const requests: {
			fontSize: number;
			fontWeight: number;
			italic: boolean;
			letterSpacing: number;
		}[] = [];
		const offset = captionStackOffset({
			tracks: [
				{
					id: "track",
					type: "captions",
					name: "Captions",
					elements: [first, second],
				},
			],
			element: second,
			measureHeight: ({ element }) =>
				measurePreviewCaptionBlockHeight({
					element,
					width: 240,
					measureText: (request) => {
						requests.push(request);
						return measureText(request);
					},
				}),
		});
		expect(offset).toBe(96);
		expect(requests).toHaveLength(5);
		for (const request of requests)
			expect(request).toMatchObject({
				fontSize: 20,
				fontWeight: 800,
				italic: true,
				letterSpacing: 3,
			});
	});

	it("keeps plain bilingual captions and unavailable-measurement fallbacks intact", () => {
		const element = fixture({ mode: "none" });
		element.text = "One\nTwo";
		element.secondaryText = "Three";
		element.style = resolveSubtitleStyle({
			...element.style,
			secondary: { fontSize: 10 },
		});
		expect(
			measurePreviewCaptionBlockHeight({ element, width: 400, measureText })
		).toBe((2 * 20 + 10) * 1.2 + 16);
		expect(measurePreviewCaptionBlockHeight({ element, width: 400 })).toBe(
			(2 * 20 + 10) * 1.2 + 16
		);
	});
});

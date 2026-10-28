/**
 * Bilingual captions (N11 follow-up, 2026-10-28 trailer report): one caption
 * carries a second-language line in its own font. The native export lays a
 * caption's lines out as the preview's box does; libass stacks font heights
 * with no leading, so spacer lines make up the CSS gap.
 */
import { describe, expect, it, vi } from "vitest";
import {
	type AssCaptionRun,
	assCaptionText,
	assInlineColor,
	captionEventText,
	captionHalfLeading,
} from "../claude/handlers/claude-export-handler/caption-ass-lines.js";
import type { TextOverlay } from "../claude/handlers/claude-export-handler/types.js";

vi.mock("../claude/handlers/claude-export-handler/ass-font-metrics.js", () => ({
	assFontMetrics: ({ family }: { family: string }) =>
		family === "Futura"
			? { sizeFactor: 1.25, lineHeightEm: 1.25 }
			: { sizeFactor: 1.15, lineHeightEm: 1.15 },
}));

function run(overrides: Partial<AssCaptionRun>): AssCaptionRun {
	return {
		lines: ["Line"],
		fontSize: 40,
		assFontSize: 46,
		fontTags: "",
		...overrides,
	};
}

describe("caption lines in ASS", () => {
	it("leaves a one-line caption as its text", () => {
		expect(
			assCaptionText({
				runs: [run({ lines: ["Round one"] })],
				lineSpacing: 1.4,
			})
		).toBe("Round one");
	});

	it("adds the CSS leading libass leaves out between two lines", () => {
		// Each line box is 40 × 1.4 = 56 px; libass's line is its ASS size, 46.
		// The gap between the glyph blocks is the two half-leadings: 10 px.
		const primary = run({ lines: ["Round", "one"] });
		expect(captionHalfLeading({ run: primary, lineSpacing: 1.4 })).toBeCloseTo(
			5
		);
		expect(assCaptionText({ runs: [primary], lineSpacing: 1.4 })).toBe(
			"Round\\N{\\fs10.00}\\h\\N{\\fs46.00}one"
		);
	});

	it("switches to the second line's font where it starts", () => {
		const text = assCaptionText({
			runs: [
				run({ lines: ["第一回合"] }),
				run({
					lines: ["Round one"],
					fontSize: 24,
					assFontSize: 30,
					fontTags: "\\fnFutura\\b0\\i0\\c&H00FFFF&",
				}),
			],
			lineSpacing: 1.4,
		});
		// 40 × 0.25 / 2 + 24 × 0.15 / 2 = 5 + 1.8.
		expect(text).toBe(
			"第一回合\\N{\\fs6.80}\\h\\N{\\fnFutura\\b0\\i0\\c&H00FFFF&\\fs30.00}Round one"
		);
	});

	it("keeps libass's spacing when the line spacing is tighter than the font's", () => {
		expect(
			assCaptionText({
				runs: [run({ lines: ["Round", "one"] })],
				lineSpacing: 1,
			})
		).toBe("Round\\None");
	});

	it("writes an inline colour without its alpha", () => {
		expect(assInlineColor("#ffcc00")).toBe("&H00CCFF&");
		expect(assInlineColor("not a colour")).toBe("&HFFFFFF&");
	});

	it("pins a bilingual caption by its second line's own leading", () => {
		const fontFamilyFor = vi.fn((overlay: TextOverlay) => overlay.fontFamily);
		const overlay = {
			content: "第一回合",
			fontSize: 40,
			fontFamily: "PingFang SC",
			lineHeight: 1.4,
			secondary: {
				content: "Round one",
				fontFamily: "Futura",
				fontSize: 24,
				color: "#ffcc00",
				fontWeight: "bold",
				fontStyle: "normal",
			},
		} as TextOverlay;

		const event = captionEventText({
			overlay,
			fontSize: 46,
			fontFamilyFor,
		});

		expect(fontFamilyFor).toHaveBeenCalledWith(
			expect.objectContaining({ fontFamily: "Futura", content: "Round one" })
		);
		expect(event.text).toBe(
			"第一回合\\N{\\fs6.80}\\h\\N{\\fnFutura\\b1\\i0\\c&H00CCFF&\\fs30.00}Round one"
		);
		// 24 × (1.4 − 1.25) / 2.
		expect(event.lastLineLeading).toBeCloseTo(1.8);
		expect(
			captionEventText({
				overlay: { ...overlay, secondary: undefined },
				fontSize: 46,
				fontFamilyFor,
			})
		).toEqual({ text: "第一回合" });
	});
});

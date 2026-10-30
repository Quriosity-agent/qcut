import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ClaudeTimeline } from "../types/claude-api.js";
import { assFamilyCoversCjk } from "../claude/handlers/claude-export-handler/ass-font-metrics.js";
import {
	assFontFamily,
	buildTextAss,
	collectTextOverlays,
} from "../claude/handlers/claude-export-handler/text-overlay.js";
import type { TextOverlay } from "../claude/handlers/claude-export-handler/types.js";

/**
 * N25 (2026-10-30 trailer report): the trailer's film subtitles (style D)
 * in the native export — SemiBold, its own spacing per line, two soft
 * shadows under the text, a 4-frame fade-in and a 3-frame fade-out at 24 fps.
 */

function timelineWith(style: Record<string, unknown>): ClaudeTimeline {
	return {
		name: "Film subtitles",
		duration: 4,
		width: 1470,
		height: 630,
		fps: 24,
		tracks: [
			{
				id: "subs",
				index: 0,
				name: "字幕 电影",
				type: "captions",
				elements: [
					{
						id: "cue",
						trackIndex: 0,
						type: "captions",
						startTime: 2,
						endTime: 3,
						duration: 1,
						content: "三年前",
						secondaryContent: "Three years ago",
						style,
					},
				],
			},
		],
	} as ClaudeTimeline;
}

const STYLE_D = {
	fontFamily: "Songti SC",
	fontSize: 28,
	fontWeight: 600,
	bold: true,
	letterSpacing: 2.8,
	fontColor: "#F4EFE6",
	outlineWidth: 0,
	bgOpacity: 0,
	shadows: [
		{ color: "#000000", opacity: 0.75, blur: 3.2, x: 0, y: 2 },
		{ color: "#000000", opacity: 0.38, blur: 18, x: 0, y: 0 },
	],
	fadeInFrames: 4,
	fadeOutFrames: 3,
	secondary: {
		fontFamily: "Gill Sans",
		fontSize: 22,
		bold: false,
		letterSpacing: 0.66,
		fontColor: "#DED6C6",
	},
};

describe("film subtitles in the native export", () => {
	it("reads weight, shadows, fade frames and the second line's spacing", () => {
		const [overlay] = collectTextOverlays(timelineWith(STYLE_D));
		expect(overlay).toMatchObject({
			weight: 600,
			fontWeight: "bold",
			letterSpacing: 2.8,
			shadows: STYLE_D.shadows,
			fadeIn: 4 / 24,
			fadeOut: 3 / 24,
			secondary: {
				fontFamily: "Gill Sans",
				fontWeight: "normal",
				letterSpacing: 0.66,
			},
		});
		expect(overlay.secondary?.weight).toBeUndefined();
	});

	it("draws each shadow as a blurred layer under the text, faded with it", () => {
		const overlays = collectTextOverlays(timelineWith(STYLE_D));
		const ass = buildTextAss({ overlays, width: 1470, height: 630 });
		const events = ass
			.split("\n")
			.filter((line) => line.startsWith("Dialogue:"));
		expect(events).toHaveLength(3);
		const layer = (line: string) => line.split(",")[0];
		expect(events.map(layer)).toEqual([
			"Dialogue: 0",
			"Dialogue: 1",
			"Dialogue: 2",
		]);
		const fade = "\\fade(255,0,255,0,167,875,1000)";
		for (const event of events) {
			expect(event).toContain(fade);
			expect(event).toContain("\\b600");
		}
		const position = (line: string) =>
			/\\pos\(([\d.]+),([\d.]+)\)/.exec(line)?.slice(1).map(Number);
		const [x, y] = position(events[2]) ?? [];
		// The near shadow 2 px down; the wide one on the letters.
		expect(position(events[0])).toEqual([x, y + 2]);
		expect(position(events[1])).toEqual([x, y]);
		// σ = blur ÷ 2, in libass's \blur units (σ = 0.849 × \blur).
		expect(events[0]).toContain(
			"\\1c&H000000&\\1a&H40&\\3a&HFF&\\4a&HFF&\\bord0\\shad0\\blur1.88}"
		);
		expect(events[1]).toContain("\\1a&H9E&");
		expect(events[1]).toContain("\\blur10.60}");
		// The second line keeps its spacing; only the text layer has its colour.
		for (const event of events) expect(event).toContain("\\b0\\i0\\fsp0.66");
		expect(events[0]).not.toContain("\\c&H");
		expect(events[2]).toMatch(
			/\\fsp0\.66\\c&HC6D6DE&\\fs[\d.]+\}Three years ago$/
		);
		// The style has no hard shadow of its own.
		const style = ass.split("\n").find((line) => line.startsWith("Style:"));
		expect(style?.split(",")[17]).toBe("0");
	});

	it("keeps the old single shadow and fade when the style has none of this", () => {
		const overlays = collectTextOverlays(
			timelineWith({ fontFamily: "Songti SC", animationType: "fade" })
		);
		const ass = buildTextAss({ overlays, width: 1470, height: 630 });
		const events = ass
			.split("\n")
			.filter((line) => line.startsWith("Dialogue:"));
		expect(events).toHaveLength(1);
		expect(events[0]).toContain("\\fad(600,0)");
		expect(events[0]).not.toContain("\\b600");
		const style = ass.split("\n").find((line) => line.startsWith("Style:"));
		expect(style?.split(",")[17]).toBe("1");
	});
});

const hasMacFonts =
	process.platform === "darwin" &&
	existsSync("/System/Library/Fonts/Supplemental/GillSans.ttc");

describe.skipIf(!hasMacFonts)("installed CJK fonts (macOS)", () => {
	it("draws Chinese in an installed font that covers it, off the old list too", () => {
		expect(assFamilyCoversCjk({ family: "Hiragino Mincho ProN" })).toBe(true);
		expect(assFamilyCoversCjk({ family: "Gill Sans" })).toBe(false);
		const overlay = (fontFamily: string) =>
			({ fontFamily, content: "三年前" }) as TextOverlay;
		expect(assFontFamily(overlay("Hiragino Mincho ProN"))).toBe(
			"Hiragino Mincho ProN"
		);
		// A family without CJK glyphs still gets the platform's CJK font.
		expect(assFontFamily(overlay("Gill Sans"))).toBe("Hiragino Sans GB");
	});
});

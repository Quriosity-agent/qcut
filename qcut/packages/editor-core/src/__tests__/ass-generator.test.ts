import { describe, expect, it } from "vitest";
import { generateASS } from "../captions/ass-generator";
import type { CaptionElement } from "../types/timeline";

function caption({
	karaoke = false,
}: {
	karaoke?: boolean;
} = {}): CaptionElement {
	return {
		id: "caption",
		type: "captions",
		name: "Lyrics",
		startTime: 1,
		duration: 2,
		trimStart: 0,
		trimEnd: 0,
		text: "Hello world",
		language: "en",
		source: "transcription",
		style: karaoke
			? {
					fontFamily: "Arial",
					fontSize: 24,
					letterSpacing: 2,
					textAlign: "center",
					fontColor: "#ffffff",
					fontOpacity: 1,
					bold: false,
					italic: false,
					underline: false,
					outlineColor: "#000000",
					outlineWidth: 2,
					shadowColor: "#000000",
					shadowOffset: { x: 0, y: 0 },
					backgroundColor: "#000000",
					bgOpacity: 0,
					position: { align: "bottom", x: 0, y: 30 },
					lineSpacing: 1.2,
					animationType: "none",
					animationDuration: 0.6,
					animationDelay: 0,
					karaokeMode: "karaoke",
					highlightColor: "#22d3ee",
					upcomingColor: "#d4d4d8",
				}
			: undefined,
		words: karaoke
			? [
					{
						id: "hello",
						text: "Hello",
						start: 1,
						end: 1.5,
						type: "word",
					},
					{
						id: "world",
						text: "world",
						start: 1.6,
						end: 2.4,
						type: "word",
					},
				]
			: undefined,
	};
}

describe("generateASS", () => {
	it("writes progressive karaoke tags from caption word timing", () => {
		const ass = generateASS([caption({ karaoke: true })], {
			resolution: { width: 1920, height: 1080 },
		});

		expect(ass).toContain("{\\kf60}Hello");
		expect(ass).toContain("{\\kf140}world");
		expect(ass).toContain("Dialogue:");
	});

	it("keeps ordinary captions as plain text", () => {
		const ass = generateASS([caption()], {
			resolution: { width: 1920, height: 1080 },
		});

		expect(ass).toContain("Hello world");
		expect(ass).not.toContain("\\kf");
	});

	it("writes a bilingual caption's second line after a break, in its own font", () => {
		const ass = generateASS(
			[
				{
					...caption(),
					text: "三年前",
					secondaryText: "Three years ago\nyou were the best",
					style: {
						...caption({ karaoke: true }).style,
						karaokeMode: "none",
						secondary: {
							fontFamily: "Futura",
							fontSize: 24,
							fontColor: "#ffcc00",
						},
					} as CaptionElement["style"],
				},
			],
			{ resolution: { width: 1920, height: 1080 } }
		);

		expect(ass).toContain(
			"三年前\\N{\\fnFutura\\fs24\\b0\\i0\\c&H00CCFF&}Three years ago\\Nyou were the best"
		);
	});

	it("keeps the second line's font name inside its override block", () => {
		const ass = generateASS(
			[
				{
					...caption(),
					text: "三年前",
					secondaryText: "Three years ago",
					style: {
						...caption({ karaoke: true }).style,
						karaokeMode: "none",
						secondary: { fontFamily: "Fu}tu\\ra{", fontSize: 24 },
					} as CaptionElement["style"],
				},
			],
			{ resolution: { width: 1920, height: 1080 } }
		);

		expect(ass).toContain("三年前\\N{\\fnFutura\\fs24\\b0\\i0");
		expect(ass).toMatch(/\}Three years ago$/m);
	});

	it("uses the configured CJK export font without changing Latin captions", () => {
		const chinese = caption();
		chinese.text = "真实视频字幕";
		const cjkAss = generateASS([chinese], {
			resolution: { width: 1080, height: 1920 },
			cjkFontFamily: "Hiragino Sans GB",
		});
		const latinAss = generateASS([caption()], {
			resolution: { width: 1080, height: 1920 },
			cjkFontFamily: "Hiragino Sans GB",
		});

		expect(cjkAss).toContain("Style: Default,Hiragino Sans GB,");
		expect(latinAss).toContain("Style: Default,Arial,");
	});

	it("scales the ASS font size the way libass sizes a face", () => {
		// libass sizes a face so its Windows ascent + descent equals the ASS
		// Fontsize, while the editor sizes by the em square, so an uncorrected
		// Fontsize renders about 15 % small (N31). Measured against the real
		// Helvetica and the bundled libass: 48 nominal must become 48 x 1.2.
		const ass = generateASS([caption()], {
			resolution: { width: 1920, height: 1080 },
			fontMetrics: () => ({ sizeFactor: 1.2, lineHeightEm: 1 }),
		});

		const style = ass.split("\n").find((line) => line.startsWith("Style:"));
		expect(style).toContain("Style: Default,Arial,57.6,");
	});

	it("carries the half-leading into the caption's edge inset", () => {
		// The inset is to the preview's line box: libass stacks the font's own
		// line height with the em at its bottom while CSS centres the em in its
		// line box, so without this the glyphs do not land where the preview
		// draws them.
		const metrics = { sizeFactor: 1.2, lineHeightEm: 1 };
		const ass = generateASS([caption()], {
			resolution: { width: 1920, height: 1080 },
			fontMetrics: () => metrics,
		});

		// A caption's line is as tall as its ASS Fontsize, so the leading comes
		// from sizeFactor, not lineHeightEm. The fixture keeps them unequal so
		// the two cannot be confused: 48 px at line spacing 1.4 against 1.2.
		const leading = (48 * 1.4 - 48 * metrics.sizeFactor) / 2;
		const style = ass
			.split("\n")
			.find((line) => line.startsWith("Style:")) as string;
		expect(style.split(",").at(-2)).toBe(String(Math.round(28 + leading)));
	});

	it("leaves the nominal size alone when no metrics are given", () => {
		const ass = generateASS([caption()], {
			resolution: { width: 1920, height: 1080 },
		});

		const style = ass
			.split("\n")
			.find((line) => line.startsWith("Style:")) as string;
		expect(style).toContain("Style: Default,Arial,48,");
		expect(style.split(",").at(-2)).toBe("28");
	});

	it("keeps a CJK-capable family the caption actually asked for", () => {
		// N31: the substitution was unconditional, so a caption asking for
		// Songti SC — a serif, and a family libass can open — exported in
		// Hiragino Sans GB, a sans-serif.
		const serif = caption();
		serif.text = "\u771f\u5b9e\u89c6\u9891\u5b57\u5e55";
		serif.style = { ...serif.style, fontFamily: "Songti SC" };

		const ass = generateASS([serif], {
			resolution: { width: 1080, height: 1920 },
			cjkFontFamily: "Hiragino Sans GB",
		});

		expect(ass).toContain("Style: Default,Songti SC,");
		expect(ass).not.toContain("Hiragino Sans GB");
	});

	it("writes text alignment, spacing, and animation tags", () => {
		const animated = caption({ karaoke: true });
		if (!animated.style) throw new Error("Expected caption style");
		animated.style = {
			...animated.style,
			textAlign: "right",
			letterSpacing: 4,
			animationType: "slide-up",
			animationDuration: 0.5,
			animationDelay: 0.25,
		};
		const ass = generateASS([animated], {
			resolution: { width: 1920, height: 1080 },
		});

		expect(ass).toContain(",4,0,1,2,0,3,");
		expect(ass).toContain("\\fade(255,0,0,250,750,2000,2000)");
		expect(ass).toContain("\\move(1896,1136,1896,1056,250,750)");
	});

	// PR #529 follow-up: this path put captions position.y (90 by default)
	// from the edge while the preview and the native export use 28 px.
	it("keeps captions 28 px from the edge, like the preview", () => {
		// The default style says position.y 90.
		const ass = generateASS([caption()], {
			resolution: { width: 1280, height: 720 },
		});
		const styleLine = ass
			.split("\n")
			.find((line) => line.startsWith("Style: Default,"));
		expect(styleLine?.split(",").slice(-4)).toEqual(["10", "10", "28", "1"]);
	});
});

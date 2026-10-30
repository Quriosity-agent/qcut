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

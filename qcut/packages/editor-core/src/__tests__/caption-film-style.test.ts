import { describe, expect, it } from "vitest";
import { generateASS } from "../captions/ass-generator";
import {
	captionAssFade,
	getCaptionAnimationState,
} from "../captions/caption-animation";
import {
	resolveCaptionShadows,
	resolveSecondaryLineStyle,
	resolveSubtitleStyle,
} from "../captions/subtitle-style";
import type { CaptionElement, SubtitleStyle } from "../types/timeline";

/**
 * N25 (2026-10-30 trailer report): style D of the trailer's film subtitles
 * — SemiBold, its own spacing per line, two soft shadows, a 4-frame fade-in
 * and a 3-frame fade-out — in the helpers every renderer shares.
 */

const STYLE_D: SubtitleStyle = resolveSubtitleStyle({
	fontFamily: "Source Han Serif CN",
	fontSize: 28,
	fontWeight: 600,
	bold: true,
	letterSpacing: 2.8,
	fontColor: "#f4efe6",
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
		fontColor: "#ded6c6",
	},
});

describe("frame fades", () => {
	it("ramps as FFmpeg's fade filter did on the drawn subtitle files", () => {
		// make_subs_cinema_v13.py: fade=t=in:st=0:d=4/24 and fade=t=out over
		// the last 3 frames, frame k at k/24 s.
		const start = 10;
		const frames = 24;
		const end = start + frames / 24;
		const opacity = (k: number) =>
			getCaptionAnimationState({
				style: STYLE_D,
				startTime: start,
				currentTime: start + k / 24,
				endTime: end,
				fps: 24,
			}).opacity;
		expect([0, 1, 2, 3, 4, 5].map((k) => opacity(k).toFixed(4))).toEqual([
			"0.0000",
			"0.2500",
			"0.5000",
			"0.7500",
			"1.0000",
			"1.0000",
		]);
		expect([20, 21, 22, 23].map((k) => opacity(k).toFixed(4))).toEqual([
			"1.0000",
			"1.0000",
			"0.6667",
			"0.3333",
		]);
	});

	it("leaves a caption without fade frames to its animation", () => {
		const style = resolveSubtitleStyle({ animationType: "fade" });
		const state = getCaptionAnimationState({
			style,
			startTime: 0,
			currentTime: 0.3,
			endTime: 2,
			fps: 24,
		});
		expect(state.opacity).toBeCloseTo(0.5, 6);
		expect(captionAssFade({ style, fps: 24, duration: 2 })).toBeUndefined();
	});

	it("writes one ASS \\fade with the same ramps, in ms from the event start", () => {
		expect(captionAssFade({ style: STYLE_D, fps: 24, duration: 1 })).toBe(
			"\\fade(255,0,255,0,167,875,1000)"
		);
		// Without a rate there are no frames to count.
		expect(captionAssFade({ style: STYLE_D, duration: 1 })).toBeUndefined();
	});
});

describe("weights, spacing and shadows", () => {
	it("gives the second line its own weight and spacing", () => {
		expect(resolveSecondaryLineStyle(STYLE_D)).toMatchObject({
			fontFamily: "Gill Sans",
			fontWeight: 400,
			bold: false,
			letterSpacing: 0.66,
		});
		// Nothing of its own: the caption's SemiBold and spacing.
		expect(
			resolveSecondaryLineStyle({ ...STYLE_D, secondary: {} })
		).toMatchObject({ fontWeight: 600, bold: true, letterSpacing: 2.8 });
	});

	it("keeps only shadows it can draw, and none means the single shadow", () => {
		expect(
			resolveCaptionShadows({
				shadows: [
					{ color: "red", opacity: 1, blur: 1, x: 0, y: 0 },
					{ color: "#000000", opacity: 3, blur: -2, x: 1, y: 2 },
				],
			})
		).toEqual([{ color: "#000000", opacity: 1, blur: 0, x: 1, y: 2 }]);
		expect(resolveCaptionShadows({})).toBeUndefined();
	});
});

describe("ASS for the Export dialog's FFmpeg path", () => {
	const caption: CaptionElement = {
		id: "zh",
		type: "captions",
		name: "zh",
		startTime: 2,
		duration: 1,
		trimStart: 0,
		trimEnd: 0,
		text: "三年前",
		secondaryText: "Three years ago",
		language: "zh",
		source: "manual",
		style: STYLE_D,
	};

	it("draws each soft shadow on a layer of its own under the text", () => {
		const ass = generateASS([caption], {
			resolution: { width: 1470, height: 630 },
			fps: 24,
		});
		const events = ass
			.split("\n")
			.filter((line) => line.startsWith("Dialogue:"));
		expect(events).toHaveLength(3);
		const fade = "\\fade(255,0,255,0,167,875,1000)";
		// σ = blur ÷ 2, in libass's \blur units (σ = 0.849 × \blur).
		expect(events[0]).toBe(
			`Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,{${fade}\\pos(735,542)\\b600\\1c&H000000&\\1a&H40&\\2c&H000000&\\2a&H40&\\3a&HFF&\\4a&HFF&\\bord0\\shad0\\blur1.88}三年前\\N{\\fnGill Sans\\fs22\\b0\\i0\\fsp0.66}Three years ago`
		);
		expect(events[1]).toContain(
			`{${fade}\\pos(735,540)\\b600\\1c&H000000&\\1a&H9E&`
		);
		expect(events[1]).toContain("\\blur10.60}");
		expect(events[2]).toBe(
			`Dialogue: 2,0:00:02.00,0:00:03.00,Default,,0,0,0,,{${fade}\\pos(735,540)\\b600}三年前\\N{\\fnGill Sans\\fs22\\b0\\i0\\fsp0.66\\c&HC6D6DE&}Three years ago`
		);
		// The style keeps no hard shadow and spaces the caption's own line.
		const style = ass.split("\n").find((line) => line.startsWith("Style:"));
		expect(style?.split(",")[7]).toBe("-1");
		expect(style?.split(",")[13]).toBe("2.8");
		expect(style?.split(",")[17]).toBe("0");
	});
});

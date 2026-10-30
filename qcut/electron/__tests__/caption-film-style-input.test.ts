import { describe, expect, it } from "vitest";
import {
	captionStyleFromPatch,
	captionStyleWarnings,
	normalizeCaptionStyleInput,
} from "../types/caption-style-input.js";

/**
 * N25 (2026-10-30 trailer report): the film subtitles (style D in
 * make_subs_cinema_v13.py) were drawn outside QCut, because a caption had no
 * SemiBold, no spacing of its own on the second line, no soft shadows and no
 * fade-out. The style takes them now.
 */

/** Style D: 思源宋体 SemiBold 28 over Gill Sans 22, two soft shadows, 4/3 fade frames. */
const STYLE_D = {
	fontFamily: "Source Han Serif CN",
	fontSize: 28,
	fontWeight: 600,
	letterSpacing: 2.8,
	fontColor: "#F4EFE6",
	outlineWidth: 0,
	bgOpacity: 0,
	shadows: [
		{ color: "#000000", opacity: 0.75, blur: 3.2, y: 2 },
		{ color: "#000", opacity: 0.38, blur: 18 },
	],
	fadeInFrames: 4,
	fadeOutFrames: 3,
	secondary: {
		fontFamily: "Gill Sans",
		fontSize: 22,
		fontWeight: 400,
		letterSpacing: 0.66,
		fontColor: "#DED6C6",
	},
};

describe("film subtitle style input", () => {
	it("stores style D whole, with nothing ignored", () => {
		const result = normalizeCaptionStyleInput({
			element: { type: "captions", content: "三年前", style: STYLE_D },
		});
		expect(result.ignored).toEqual([]);
		expect(result.style).toEqual({
			fontFamily: "Source Han Serif CN",
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
		});
	});

	it("keeps a weight between regular and bold; bold and regular stay `bold`", () => {
		const weight = (fontWeight: unknown) =>
			normalizeCaptionStyleInput({ element: { style: { fontWeight } } });
		expect(weight(600).style).toEqual({ bold: true, fontWeight: 600 });
		expect(weight(300).style).toEqual({ bold: false, fontWeight: 300 });
		expect(weight("bold").style).toEqual({ bold: true });
		expect(weight(700).style).toEqual({ bold: true });
		expect(weight("normal").style).toEqual({ bold: false });
		for (const bad of ["semibold", 950, 50]) {
			expect(captionStyleWarnings(weight(bad))).toEqual([
				'Caption field "style.fontWeight" ignored: expected bold, normal or a weight 100–900 (SemiBold is 600)',
			]);
		}
	});

	it("lets `bold` set the weight, keeping a weight it agrees with", () => {
		const read = (style: Record<string, unknown>) =>
			normalizeCaptionStyleInput({ element: { style } }).style;
		expect(read({ fontWeight: 600, bold: true })).toEqual({
			bold: true,
			fontWeight: 600,
		});
		expect(read({ fontWeight: 600, bold: false })).toEqual({ bold: false });
		// A patch to `bold` alone clears a stored SemiBold: it is now Bold.
		const patch = captionStyleFromPatch({
			changes: { style: { bold: true } },
			current: { fontWeight: 600, bold: true },
		}).style;
		expect(patch).toEqual({ bold: true });
		expect(patch && Object.hasOwn(patch, "fontWeight")).toBe(true);
	});

	it("names shadows it cannot use, and `null` goes back to the single shadow", () => {
		const shadows = (value: unknown) =>
			normalizeCaptionStyleInput({ element: { style: { shadows: value } } });
		expect(captionStyleWarnings(shadows([{ color: "black" }]))).toEqual([
			'Caption field "style.shadows" ignored: [0].color expected a colour (#rrggbb)',
		]);
		expect(
			captionStyleWarnings(shadows([{ color: "#000000", spread: 2 }]))
		).toEqual([
			'Caption field "style.shadows" ignored: [0].spread is not a shadow field (color, opacity, blur, x, y)',
		]);
		expect(
			captionStyleWarnings(shadows([{ color: "#000000", opacity: 2 }]))
		).toEqual([
			'Caption field "style.shadows" ignored: [0].opacity expected 0–1',
		]);
		expect(
			captionStyleWarnings(shadows(Array(5).fill({ color: "#000000" })))
		).toEqual([
			'Caption field "style.shadows" ignored: expected up to 4 of {color, opacity?, blur?, x?, y?}',
		]);
		expect(shadows([]).style).toEqual({ shadows: [] });
		const cleared = shadows(null).style;
		expect(cleared && Object.hasOwn(cleared, "shadows")).toBe(true);
		expect(cleared?.shadows).toBeUndefined();
	});

	it("takes fades in whole frames and points blur at the shadow list", () => {
		const result = normalizeCaptionStyleInput({
			element: {
				style: { fadeInFrames: 4.5, fadeOutFrames: -1, shadowBlur: 4 },
			},
		});
		expect(captionStyleWarnings(result)).toEqual([
			'Caption field "style.shadowBlur" ignored: no effect on captions: the single shadow is not blurred; soft shadows are shadows: [{color, opacity, blur, x, y}]',
			'Caption field "style.fadeInFrames" ignored: expected whole frames at the project rate, 0–600',
			'Caption field "style.fadeOutFrames" ignored: expected whole frames at the project rate, 0–600',
		]);
	});

	it("replaces the stored shadows whole and merges the second line", () => {
		const patch = captionStyleFromPatch({
			changes: {
				style: {
					shadows: [{ color: "#101010", blur: 6 }],
					secondary: { letterSpacing: 1 },
				},
			},
			current: STYLE_D,
		}).style;
		expect(patch?.shadows).toEqual([
			{ color: "#101010", opacity: 1, blur: 6, x: 0, y: 0 },
		]);
		expect(patch?.secondary).toEqual({
			...STYLE_D.secondary,
			letterSpacing: 1,
		});
	});
});

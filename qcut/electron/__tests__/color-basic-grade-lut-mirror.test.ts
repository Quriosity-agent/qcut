import { describe, expect, it } from "vitest";
import { DEFAULT_MEDIA_COLOR_SETTINGS } from "../../apps/web/src/lib/color/color-properties";
import { transformColorPixel } from "../../apps/web/src/lib/color/color-pixel-processor";
import {
	applyBasicGrade,
	basicGradeIsNeutral,
	basicGradeIsStatic,
	buildBasicGradeCube,
} from "../ffmpeg/color-basic-grade-lut";
import { DEFAULT_VIDEO_COLOR_SETTINGS } from "../ffmpeg/color-settings";
import { DEFAULT_VISUAL } from "../ffmpeg-video-transform";

/**
 * The main process carries a copy of the preview's basic grade maths (it
 * cannot import renderer code). The same pixel through both must give the
 * same colour, so a tweak to one side cannot drift the native export away
 * from the preview again.
 */
const GRADES = [
	{ shadows: 80, blacks: 40 },
	{ highlights: -60, whites: -30 },
	{ exposure: 2, brightness: -30 },
	{ exposure: -1.5, contrast: 60 },
	{ temperature: 45, tint: -25 },
	{ saturation: 40, vibrance: 70 },
	{ saturation: -100 },
	{ fade: 60, contrast: 30, vibrance: -40 },
];

const PIXELS = [
	{ r: 0, g: 0, b: 0 },
	{ r: 1, g: 1, b: 1 },
	{ r: 0.125, g: 0.125, b: 0.125 },
	{ r: 0.8, g: 0.2, b: 0.1 },
	{ r: 0.2, g: 0.6, b: 0.9 },
	{ r: 0.5, g: 0.5, b: 0.05 },
	{ r: 0.3, g: 0.9, b: 0.4 },
];

describe("basic grade LUT mirror", () => {
	it("matches the preview's pixel maths on every grade and pixel", () => {
		for (const grade of GRADES) {
			const basic = { ...DEFAULT_VIDEO_COLOR_SETTINGS.basic, ...grade };
			const settings = {
				...DEFAULT_MEDIA_COLOR_SETTINGS,
				basic: { ...DEFAULT_MEDIA_COLOR_SETTINGS.basic, ...grade },
			};
			for (const pixel of PIXELS) {
				const expected = transformColorPixel({ color: pixel, settings });
				const mirrored = applyBasicGrade({ color: pixel, basic });
				const clamp = (value: number) => Math.min(1, Math.max(0, value));
				expect(clamp(mirrored.r)).toBeCloseTo(expected.r, 9);
				expect(clamp(mirrored.g)).toBeCloseTo(expected.g, 9);
				expect(clamp(mirrored.b)).toBeCloseTo(expected.b, 9);
			}
		}
	});

	it("lifts black with shadows and keeps a 4× exposure gain, which eq could not", () => {
		const basic = DEFAULT_VIDEO_COLOR_SETTINGS.basic;
		const lifted = applyBasicGrade({
			color: { r: 0, g: 0, b: 0 },
			basic: { ...basic, shadows: 100 },
		});
		expect(lifted.r).toBeCloseTo(0.35, 6);
		const gained = applyBasicGrade({
			color: { r: 0.125, g: 0.125, b: 0.125 },
			basic: { ...basic, exposure: 2 },
		});
		expect(gained.g).toBeCloseTo(0.5, 6);
	});

	it("samples the grade on a red-fastest grid", () => {
		const cube = buildBasicGradeCube({
			basic: { ...DEFAULT_VIDEO_COLOR_SETTINGS.basic, saturation: -100 },
			size: 3,
		});
		expect(cube.values).toHaveLength(3 ** 3 * 3);
		// Entry 1 is red = 1/2, green = blue = 0: a grey of its luminance.
		const grey = 0.5 * 0.2126;
		expect(cube.values.slice(3, 6)).toEqual([
			Math.round(grey * 1e6) / 1e6,
			Math.round(grey * 1e6) / 1e6,
			Math.round(grey * 1e6) / 1e6,
		]);
	});

	it("calls a grade neutral only when every baked property is zero", () => {
		const basic = DEFAULT_VIDEO_COLOR_SETTINGS.basic;
		expect(basicGradeIsNeutral({ basic })).toBe(true);
		// Spatial properties are not baked, so they do not make a grade tonal.
		expect(basicGradeIsNeutral({ basic: { ...basic, sharpness: 40 } })).toBe(
			true
		);
		expect(basicGradeIsNeutral({ basic: { ...basic, fade: 1 } })).toBe(false);
		expect(basicGradeIsNeutral({ basic: { ...basic, exposure: -0.1 } })).toBe(
			false
		);
	});

	it("is static unless a baked property or the smart intensity animates", () => {
		const color = structuredClone(DEFAULT_VIDEO_COLOR_SETTINGS);
		const visual = { ...DEFAULT_VISUAL, color };
		expect(basicGradeIsStatic({ visual })).toBe(true);
		const keyframe = { id: "k", frame: 0, value: 0, easing: "linear" as const };
		expect(
			basicGradeIsStatic({
				visual: {
					...visual,
					color: { ...color, keyframes: { "basic.shadows": [keyframe] } },
				},
			})
		).toBe(false);
		expect(
			basicGradeIsStatic({
				visual: {
					...visual,
					color: { ...color, keyframes: { "smart.intensity": [keyframe] } },
				},
			})
		).toBe(false);
		// Spatial properties are separate filters and do not pin the grade.
		expect(
			basicGradeIsStatic({
				visual: {
					...visual,
					color: { ...color, keyframes: { "basic.vignette": [keyframe] } },
				},
			})
		).toBe(true);
	});
});

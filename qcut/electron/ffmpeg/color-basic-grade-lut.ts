/**
 * The preview's basic grade, baked into a 3D LUT for the native export.
 *
 * FFmpeg's `eq` is one affine map per frame. It cannot lift shadows by luma,
 * fade toward grey or scale saturation the way the preview's pixel maths does,
 * and its brightness clips at ±1, so an exposure above about +1.5 lost its
 * gain on dark pixels. A static grade (no basic keyframes, no animated smart
 * intensity) is instead sampled through the same per-pixel maths the preview
 * and the renderer export use into a 33³ cube that `lut3d` applies with
 * tetrahedral interpolation. Keyframed grades keep the per-frame `eq` path.
 *
 * `applyBasicGrade` mirrors `applyBasic` in
 * apps/web/src/lib/color/color-pixel-processor.ts; the main process cannot
 * import renderer code, and color-basic-grade-lut-mirror.test.ts keeps the
 * two in step.
 *
 * @module electron/ffmpeg/color-basic-grade-lut
 */

import {
	escapeFfmpegFilterPath,
	materializeVideoCubeLut,
	type VideoCubeLut,
} from "./color-lut-file";
import type { VideoColorBasicSettings } from "./color-settings";
import type { VideoVisual } from "./types";
import { hasColorKeyframes } from "./color-keyframe-filter";

interface Rgb {
	r: number;
	g: number;
	b: number;
}

export const BASIC_GRADE_LUT_SIZE = 33;

/**
 * The basic properties the cube bakes. Sharpness, vignette and grain are
 * spatial and stay separate filters.
 */
export const BASIC_GRADE_LUT_PROPERTIES = [
	"exposure",
	"brightness",
	"contrast",
	"highlights",
	"shadows",
	"whites",
	"blacks",
	"temperature",
	"tint",
	"saturation",
	"vibrance",
	"fade",
] as const;

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function mix(left: number, right: number, amount: number): number {
	return left + (right - left) * amount;
}

function luminance({ r, g, b }: Rgb): number {
	return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
	const maximum = Math.max(r, g, b);
	const minimum = Math.min(r, g, b);
	const delta = maximum - minimum;
	const lightness = (maximum + minimum) / 2;
	if (delta === 0) return { h: 0, s: 0, l: lightness };
	const saturation = delta / (1 - Math.abs(2 * lightness - 1));
	let hue = 0;
	if (maximum === r) hue = ((g - b) / delta) % 6;
	if (maximum === g) hue = (b - r) / delta + 2;
	if (maximum === b) hue = (r - g) / delta + 4;
	return {
		h: ((hue * 60 + 360) % 360) / 360,
		s: saturation,
		l: lightness,
	};
}

function hueChannel({ p, q, t }: { p: number; q: number; t: number }): number {
	let hue = t;
	if (hue < 0) hue += 1;
	if (hue > 1) hue -= 1;
	if (hue < 1 / 6) return p + (q - p) * 6 * hue;
	if (hue < 1 / 2) return q;
	if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
	return p;
}

function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): Rgb {
	if (s === 0) return { r: l, g: l, b: l };
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	return {
		r: hueChannel({ p, q, t: h + 1 / 3 }),
		g: hueChannel({ p, q, t: h }),
		b: hueChannel({ p, q, t: h - 1 / 3 }),
	};
}

/** One pixel (0..1 per channel) through the preview's basic grade. */
export function applyBasicGrade({
	color,
	basic,
}: {
	color: Rgb;
	basic: VideoColorBasicSettings;
}): Rgb {
	if (!basic.enabled) return color;
	const exposure = 2 ** basic.exposure;
	let result = {
		r: color.r * exposure,
		g: color.g * exposure,
		b: color.b * exposure,
	};
	const initialLuma = luminance(result);
	const shadowWeight = (1 - initialLuma) ** 2;
	const highlightWeight = initialLuma ** 2;
	const blackWeight = (1 - initialLuma) ** 4;
	const whiteWeight = initialLuma ** 4;
	// Brightness scales like CSS `brightness()`; the tonal controls are
	// luma-weighted offsets.
	const brightnessFactor = Math.max(0, 1 + basic.brightness / 100);
	const tonalOffset =
		(basic.shadows / 100) * shadowWeight * 0.35 +
		(basic.highlights / 100) * highlightWeight * 0.35 +
		(basic.blacks / 100) * blackWeight * 0.25 +
		(basic.whites / 100) * whiteWeight * 0.25;
	result = {
		r: result.r * brightnessFactor + tonalOffset,
		g: result.g * brightnessFactor + tonalOffset,
		b: result.b * brightnessFactor + tonalOffset,
	};
	const temperature = basic.temperature / 100;
	const tint = basic.tint / 100;
	result.r *= 1 + temperature * 0.18 + tint * 0.04;
	result.g *= 1 - tint * 0.12;
	result.b *= 1 - temperature * 0.18 + tint * 0.04;
	const contrast = 1 + basic.contrast / 100;
	result = {
		r: (result.r - 0.5) * contrast + 0.5,
		g: (result.g - 0.5) * contrast + 0.5,
		b: (result.b - 0.5) * contrast + 0.5,
	};
	const luma = luminance(result);
	const saturation = Math.max(0, 1 + basic.saturation / 100);
	result = {
		r: mix(luma, result.r, saturation),
		g: mix(luma, result.g, saturation),
		b: mix(luma, result.b, saturation),
	};
	const currentHsl = rgbToHsl(result);
	const vibrance = basic.vibrance / 100;
	const vibranceFactor = Math.max(0, 1 + vibrance * (1 - currentHsl.s) * 1.5);
	result = hslToRgb({
		...currentHsl,
		s: clamp01(currentHsl.s * vibranceFactor),
	});
	const fade = Math.max(0, basic.fade / 100) * 0.35;
	return {
		r: mix(result.r, 0.5, fade),
		g: mix(result.g, 0.5, fade),
		b: mix(result.b, 0.5, fade),
	};
}

/**
 * Whether the basic grade can be one cube: none of the baked properties is
 * keyframed, and the smart correction's intensity (which the eq path folds
 * into exposure, contrast and white balance) does not animate either.
 */
export function basicGradeIsStatic({
	visual,
}: {
	visual: VideoVisual;
}): boolean {
	return (
		!hasColorKeyframes({ visual, property: "smart.intensity" }) &&
		BASIC_GRADE_LUT_PROPERTIES.every(
			(property) =>
				!hasColorKeyframes({ visual, property: `basic.${property}` })
		)
	);
}

/**
 * Whether every baked property sits at its neutral value, so the cube would be
 * an identity: applying one would only round the picture through RGB for
 * nothing, so a neutral grade gets no tonal filter at all.
 */
export function basicGradeIsNeutral({
	basic,
}: {
	basic: VideoColorBasicSettings;
}): boolean {
	return BASIC_GRADE_LUT_PROPERTIES.every((property) => basic[property] === 0);
}

/** The grade sampled on a `size`³ grid, red fastest, as a .cube holds it. */
export function buildBasicGradeCube({
	basic,
	size = BASIC_GRADE_LUT_SIZE,
}: {
	basic: VideoColorBasicSettings;
	size?: number;
}): VideoCubeLut {
	const values: number[] = [];
	const last = size - 1;
	for (let blue = 0; blue < size; blue += 1) {
		for (let green = 0; green < size; green += 1) {
			for (let red = 0; red < size; red += 1) {
				const graded = applyBasicGrade({
					color: { r: red / last, g: green / last, b: blue / last },
					basic,
				});
				values.push(
					Math.round(clamp01(graded.r) * 1e6) / 1e6,
					Math.round(clamp01(graded.g) * 1e6) / 1e6,
					Math.round(clamp01(graded.b) * 1e6) / 1e6
				);
			}
		}
	}
	return { size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], values };
}

/** The lut3d filter for a static basic grade; the cube file is content-hashed and reused. */
export function buildBasicGradeLutFilter({
	basic,
}: {
	basic: VideoColorBasicSettings;
}): string {
	const filePath = materializeVideoCubeLut({
		name: "QCut basic grade",
		cube: buildBasicGradeCube({ basic }),
		intensity: 100,
		skinProtection: 0,
	});
	return `lut3d=file='${escapeFfmpegFilterPath(filePath)}':interp=tetrahedral`;
}

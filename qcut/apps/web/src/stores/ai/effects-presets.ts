/**
 * Effect Presets — static preset data and FFmpeg parameter merging.
 * Extracted from effects-store.ts to keep files under 800 lines.
 */

import type { EffectPreset, EffectParameters } from "@/types/effects";
import { type EffectParameters as FFmpegEffectParameters } from "@/lib/ffmpeg/ffmpeg-filter-chain";

/** Merge effect parameters for FFmpeg filter chains */
export function mergeFFmpegEffectParameters(
	...paramArrays: EffectParameters[]
): FFmpegEffectParameters {
	const merged: FFmpegEffectParameters = {};

	for (const params of paramArrays) {
		// Brightness - additive parameter
		if (params.brightness !== undefined) {
			merged.brightness = (merged.brightness || 0) + params.brightness;
		}

		// Contrast - additive parameter
		if (params.contrast !== undefined) {
			merged.contrast = (merged.contrast || 0) + params.contrast;
		}

		// Saturation - additive parameter
		if (params.saturation !== undefined) {
			merged.saturation = (merged.saturation || 0) + params.saturation;
		}

		// Hue - additive parameter
		if (params.hue !== undefined) {
			merged.hue = (merged.hue || 0) + params.hue;
		}

		// Blur - override parameter (last value wins)
		if (params.blur !== undefined) {
			merged.blur = params.blur;
		}

		// Grayscale - override parameter (last value wins)
		if (params.grayscale !== undefined) {
			merged.grayscale = params.grayscale;
		}

		// Invert - override parameter (last value wins)
		if (params.invert !== undefined) {
			merged.invert = params.invert;
		}
	}

	// Clamp additive values to valid ranges after merging
	if (merged.brightness !== undefined) {
		merged.brightness = Math.max(-100, Math.min(100, merged.brightness));
	}
	if (merged.contrast !== undefined) {
		merged.contrast = Math.max(-100, Math.min(100, merged.contrast));
	}
	if (merged.saturation !== undefined) {
		merged.saturation = Math.max(-100, Math.min(200, merged.saturation));
	}
	if (merged.hue !== undefined) {
		merged.hue = merged.hue % 360; // Keep hue within 0-360 degree range
	}

	return merged;
}

/** Predefined effect presets */
export const EFFECT_PRESETS: Array<EffectPreset & { isImplemented?: boolean }> =
	[
		{
			id: "brightness-increase",
			name: "Brighten",
			description: "Increase brightness",
			category: "basic",
			icon: "☀️",
			parameters: { brightness: 20 },
			isImplemented: true,
		},
		{
			id: "brightness-decrease",
			name: "Darken",
			description: "Decrease brightness",
			category: "basic",
			icon: "🌙",
			parameters: { brightness: -20 },
			isImplemented: true,
		},
		{
			id: "contrast-high",
			name: "High Contrast",
			description: "Increase contrast",
			category: "basic",
			icon: "◐",
			parameters: { contrast: 30 },
			isImplemented: true,
		},
		{
			id: "saturation-boost",
			name: "Vibrant",
			description: "Boost color saturation",
			category: "color",
			icon: "🎨",
			parameters: { saturation: 40 },
			isImplemented: true,
		},
		{
			id: "desaturate",
			name: "Muted",
			description: "Reduce color saturation",
			category: "color",
			icon: "🔇",
			parameters: { saturation: -30 },
			isImplemented: true,
		},
		{
			id: "sepia",
			name: "Sepia",
			description: "Classic sepia tone",
			category: "vintage",
			icon: "📜",
			parameters: { sepia: 80 },
			isImplemented: true,
		},
		{
			id: "grayscale",
			name: "Black & White",
			description: "Convert to grayscale",
			category: "artistic",
			icon: "⚫",
			parameters: { grayscale: 100 },
			isImplemented: true,
		},
		{
			id: "vintage-film",
			name: "Vintage Film",
			description: "Old film look",
			category: "vintage",
			icon: "🎞️",
			parameters: { vintage: 70, grain: 20, vignette: 30 },
			isImplemented: false,
		},
		{
			id: "dramatic",
			name: "Dramatic",
			description: "High drama effect",
			category: "cinematic",
			icon: "🎭",
			parameters: { dramatic: 60, contrast: 20 },
			isImplemented: false,
		},
		{
			id: "warm-filter",
			name: "Warm",
			description: "Warm color tone",
			category: "color",
			icon: "🔥",
			parameters: { warm: 50 },
			isImplemented: false,
		},
		{
			id: "cool-filter",
			name: "Cool",
			description: "Cool color tone",
			category: "color",
			icon: "❄️",
			parameters: { cool: 50 },
			isImplemented: false,
		},
		{
			id: "chromatic",
			name: "Chromatic",
			description: "Chromatic aberration effect",
			category: "distortion",
			icon: "🌈",
			parameters: { chromatic: 50 },
			isImplemented: false,
		},
		{
			id: "radiance",
			name: "Radiance",
			description: "Soft glow and radiance effect",
			category: "artistic",
			icon: "✨",
			parameters: { radiance: 60 },
			isImplemented: false,
		},
		{
			id: "cinematic",
			name: "Cinematic",
			description: "Movie-like look",
			category: "cinematic",
			icon: "🎬",
			parameters: { cinematic: 70, vignette: 20 },
			isImplemented: false,
		},
		{
			id: "blur-soft",
			name: "Soft Blur",
			description: "Gentle blur effect",
			category: "distortion",
			icon: "🌫️",
			parameters: { blur: 2 },
			isImplemented: true,
		},
		{
			id: "sharpen",
			name: "Sharpen",
			description: "Enhance edges",
			category: "basic",
			icon: "🔪",
			parameters: { sharpen: 50 },
			isImplemented: false,
		},
		{
			id: "emboss",
			name: "Emboss",
			description: "3D emboss effect",
			category: "artistic",
			icon: "🏔️",
			parameters: { emboss: 70 },
			isImplemented: false,
		},
		{
			id: "edge-detect",
			name: "Edge Detection",
			description: "Highlight edges",
			category: "artistic",
			icon: "📐",
			parameters: { edge: 80 },
			isImplemented: false,
		},
		{
			id: "pixelate",
			name: "Pixelate",
			description: "Pixelation effect",
			category: "distortion",
			icon: "🧩",
			parameters: { pixelate: 10 },
			isImplemented: false,
		},
		{
			id: "vignette",
			name: "Vignette",
			description: "Darken edges",
			category: "cinematic",
			icon: "⭕",
			parameters: { vignette: 50 },
			isImplemented: false,
		},
		{
			id: "grain",
			name: "Film Grain",
			description: "Add film grain",
			category: "vintage",
			icon: "🌾",
			parameters: { grain: 30 },
			isImplemented: false,
		},
		{
			id: "invert",
			name: "Invert",
			description: "Invert colors",
			category: "artistic",
			icon: "🔄",
			parameters: { invert: 100 },
			isImplemented: true,
		},
		// Distortion effects
		{
			id: "wave",
			name: "Wave",
			description: "Wave distortion",
			category: "distortion",
			icon: "🌊",
			parameters: { wave: 50, waveFrequency: 3, waveAmplitude: 20 },
			isImplemented: false,
		},
		{
			id: "twist",
			name: "Twist",
			description: "Twirl distortion",
			category: "distortion",
			icon: "🌀",
			parameters: { twist: 60, twistAngle: 180 },
			isImplemented: false,
		},
		{
			id: "bulge",
			name: "Bulge",
			description: "Bulge distortion",
			category: "distortion",
			icon: "🔵",
			parameters: { bulge: 50, bulgeRadius: 200 },
			isImplemented: false,
		},
		{
			id: "fisheye",
			name: "Fisheye",
			description: "Fisheye lens effect",
			category: "distortion",
			icon: "👁️",
			parameters: { fisheye: 70, fisheyeStrength: 2 },
			isImplemented: false,
		},
		// Artistic effects
		{
			id: "oil-painting",
			name: "Oil Painting",
			description: "Oil painting effect",
			category: "artistic",
			icon: "🎨",
			parameters: { oilPainting: 60, brushSize: 5 },
			isImplemented: false,
		},
		{
			id: "watercolor",
			name: "Watercolor",
			description: "Watercolor painting",
			category: "artistic",
			icon: "💧",
			parameters: { watercolor: 70, wetness: 50 },
			isImplemented: false,
		},
		{
			id: "pencil-sketch",
			name: "Pencil Sketch",
			description: "Pencil drawing effect",
			category: "artistic",
			icon: "✏️",
			parameters: { pencilSketch: 80, strokeWidth: 2 },
			isImplemented: false,
		},
		{
			id: "halftone",
			name: "Halftone",
			description: "Comic book dots",
			category: "artistic",
			icon: "⚫",
			parameters: { halftone: 50, dotSize: 4 },
			isImplemented: false,
		},
		// Transition effects
		{
			id: "fade-in",
			name: "Fade In",
			description: "Fade in transition",
			category: "transition",
			icon: "⬆️",
			parameters: { fadeIn: 100 },
		},
		{
			id: "fade-out",
			name: "Fade Out",
			description: "Fade out transition",
			category: "transition",
			icon: "⬇️",
			parameters: { fadeOut: 100 },
		},
		{
			id: "dissolve",
			name: "Dissolve",
			description: "Dissolve transition",
			category: "transition",
			icon: "💫",
			parameters: { dissolve: 50, dissolveProgress: 50 },
			isImplemented: false,
		},
		{
			id: "wipe",
			name: "Wipe",
			description: "Wipe transition",
			category: "transition",
			icon: "➡️",
			parameters: { wipe: 100, wipeDirection: "right", wipeProgress: 50 },
			isImplemented: false,
		},
		// Composite effects
		{
			id: "overlay",
			name: "Overlay",
			description: "Overlay blend",
			category: "composite",
			icon: "🔲",
			parameters: { overlay: 50, overlayOpacity: 75, blendMode: "overlay" },
			isImplemented: false,
		},
		{
			id: "multiply",
			name: "Multiply",
			description: "Multiply blend",
			category: "composite",
			icon: "✖️",
			parameters: { multiply: 100, blendMode: "multiply" },
			isImplemented: false,
		},
		{
			id: "screen",
			name: "Screen",
			description: "Screen blend",
			category: "composite",
			icon: "📺",
			parameters: { screen: 100, blendMode: "screen" },
			isImplemented: false,
		},
		{
			id: "color-dodge",
			name: "Color Dodge",
			description: "Color dodge blend",
			category: "composite",
			icon: "💡",
			parameters: { colorDodge: 80, blendMode: "color-dodge" },
			isImplemented: false,
		},
	];

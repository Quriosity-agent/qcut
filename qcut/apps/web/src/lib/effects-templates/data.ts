/**
 * Effect template data arrays
 * @module lib/effects-templates/data
 */

import type { EffectTemplate } from "./types";

// Professional Templates
const PROFESSIONAL_TEMPLATES: EffectTemplate[] = [
	{
		id: "broadcast-quality",
		name: "Broadcast Quality",
		description: "Professional broadcast-ready color correction",
		category: "professional",
		effects: [
			{
				name: "Color Correction",
				effectType: "color",
				parameters: {
					brightness: 5,
					contrast: 10,
					saturation: -5,
					gamma: 1.1,
				},
				order: 1,
			},
			{
				name: "Sharpening",
				effectType: "enhancement",
				parameters: {
					sharpen: 30,
				},
				order: 2,
			},
			{
				name: "Vignette",
				effectType: "enhancement",
				parameters: {
					vignette: 20,
				},
				order: 3,
			},
		],
	},
	{
		id: "documentary-style",
		name: "Documentary Style",
		description: "Clean, neutral look for documentaries",
		category: "professional",
		effects: [
			{
				name: "Neutral Grade",
				effectType: "color",
				parameters: {
					contrast: 15,
					saturation: -10,
				},
				order: 1,
			},
			{
				name: "Slight Grain",
				effectType: "enhancement",
				parameters: {
					grain: 10,
				},
				order: 2,
			},
		],
	},
	{
		id: "interview-enhance",
		name: "Interview Enhancement",
		description: "Optimized for talking head interviews",
		category: "professional",
		effects: [
			{
				name: "Skin Tone Correction",
				effectType: "color",
				parameters: {
					warm: 15,
					saturation: 10,
				},
				order: 1,
			},
			{
				name: "Soft Focus",
				effectType: "enhancement",
				parameters: {
					blur: 0.5,
					sharpen: 20,
				},
				order: 2,
			},
		],
	},
];

// Creative Templates
const CREATIVE_TEMPLATES: EffectTemplate[] = [
	{
		id: "dreamscape",
		name: "Dreamscape",
		description: "Ethereal, dreamy atmosphere",
		category: "creative",
		effects: [
			{
				name: "Soft Glow",
				effectType: "enhancement",
				parameters: {
					blur: 2,
					brightness: 15,
				},
				order: 1,
				blendMode: "screen",
			},
			{
				name: "Color Shift",
				effectType: "color",
				parameters: {
					hue: 20,
					saturation: 30,
				},
				order: 2,
			},
			{
				name: "Vignette",
				effectType: "enhancement",
				parameters: {
					vignette: 40,
				},
				order: 3,
			},
		],
	},
	{
		id: "cyberpunk",
		name: "Cyberpunk",
		description: "Neon-lit futuristic look",
		category: "creative",
		effects: [
			{
				name: "Neon Colors",
				effectType: "color",
				parameters: {
					saturation: 80,
					contrast: 40,
				},
				order: 1,
			},
			{
				name: "Blue Shift",
				effectType: "color",
				parameters: {
					cool: 60,
				},
				order: 2,
			},
			{
				name: "Edge Glow",
				effectType: "enhancement",
				parameters: {
					edge: 30,
				},
				order: 3,
			},
			{
				name: "Grain",
				effectType: "enhancement",
				parameters: {
					grain: 25,
				},
				order: 4,
			},
		],
	},
	{
		id: "comic-book",
		name: "Comic Book",
		description: "Bold, graphic novel style",
		category: "creative",
		effects: [
			{
				name: "High Contrast",
				effectType: "color",
				parameters: {
					contrast: 70,
					saturation: 60,
				},
				order: 1,
			},
			{
				name: "Halftone",
				effectType: "artistic",
				parameters: {
					halftone: 50,
					dotSize: 3,
				},
				order: 2,
			},
			{
				name: "Edge Detection",
				effectType: "enhancement",
				parameters: {
					edge: 50,
				},
				order: 3,
			},
		],
	},
];

// Vintage Templates
const VINTAGE_TEMPLATES: EffectTemplate[] = [
	{
		id: "super8",
		name: "Super 8",
		description: "Authentic Super 8 film look",
		category: "vintage",
		effects: [
			{
				name: "Film Color",
				effectType: "color",
				parameters: {
					vintage: 70,
					warm: 30,
				},
				order: 1,
			},
			{
				name: "Film Grain",
				effectType: "enhancement",
				parameters: {
					grain: 40,
				},
				order: 2,
			},
			{
				name: "Vignette",
				effectType: "enhancement",
				parameters: {
					vignette: 50,
				},
				order: 3,
			},
			{
				name: "Slight Blur",
				effectType: "enhancement",
				parameters: {
					blur: 0.8,
				},
				order: 4,
			},
		],
	},
	{
		id: "noir",
		name: "Film Noir",
		description: "Classic black and white film noir",
		category: "vintage",
		effects: [
			{
				name: "Black & White",
				effectType: "color",
				parameters: {
					grayscale: 100,
				},
				order: 1,
			},
			{
				name: "High Contrast",
				effectType: "color",
				parameters: {
					contrast: 50,
					brightness: -10,
				},
				order: 2,
			},
			{
				name: "Film Grain",
				effectType: "enhancement",
				parameters: {
					grain: 30,
				},
				order: 3,
			},
			{
				name: "Vignette",
				effectType: "enhancement",
				parameters: {
					vignette: 60,
				},
				order: 4,
			},
		],
	},
	{
		id: "vhs",
		name: "VHS Tape",
		description: "Retro VHS tape aesthetic",
		category: "vintage",
		effects: [
			{
				name: "Color Bleed",
				effectType: "color",
				parameters: {
					saturation: -20,
					contrast: -15,
				},
				order: 1,
			},
			{
				name: "Scan Lines",
				effectType: "distortion",
				parameters: {
					wave: 5,
					waveFrequency: 50,
					waveAmplitude: 2,
				},
				order: 2,
			},
			{
				name: "Static Noise",
				effectType: "enhancement",
				parameters: {
					grain: 35,
				},
				order: 3,
			},
			{
				name: "Color Shift",
				effectType: "color",
				parameters: {
					hue: 5,
				},
				order: 4,
			},
		],
	},
];

// Modern Templates
const MODERN_TEMPLATES: EffectTemplate[] = [
	{
		id: "instagram-ready",
		name: "Instagram Ready",
		description: "Optimized for social media",
		category: "modern",
		effects: [
			{
				name: "Pop Colors",
				effectType: "color",
				parameters: {
					saturation: 25,
					contrast: 20,
					brightness: 10,
				},
				order: 1,
			},
			{
				name: "Subtle Warmth",
				effectType: "color",
				parameters: {
					warm: 10,
				},
				order: 2,
			},
			{
				name: "Slight Vignette",
				effectType: "enhancement",
				parameters: {
					vignette: 15,
				},
				order: 3,
			},
		],
	},
	{
		id: "minimal-clean",
		name: "Minimal Clean",
		description: "Clean, minimal aesthetic",
		category: "modern",
		effects: [
			{
				name: "Desaturate",
				effectType: "color",
				parameters: {
					saturation: -30,
				},
				order: 1,
			},
			{
				name: "Lift Shadows",
				effectType: "color",
				parameters: {
					brightness: 15,
					contrast: -10,
				},
				order: 2,
			},
			{
				name: "Cool Tone",
				effectType: "color",
				parameters: {
					cool: 20,
				},
				order: 3,
			},
		],
	},
	{
		id: "youtube-optimized",
		name: "YouTube Optimized",
		description: "Optimized for YouTube compression",
		category: "modern",
		effects: [
			{
				name: "Compression Ready",
				effectType: "color",
				parameters: {
					contrast: 15,
					saturation: 15,
				},
				order: 1,
			},
			{
				name: "Sharpening",
				effectType: "enhancement",
				parameters: {
					sharpen: 25,
				},
				order: 2,
			},
			{
				name: "Slight Grain",
				effectType: "enhancement",
				parameters: {
					grain: 5,
				},
				order: 3,
			},
		],
	},
];

// All templates combined
export const EFFECT_TEMPLATES: EffectTemplate[] = [
	...PROFESSIONAL_TEMPLATES,
	...CREATIVE_TEMPLATES,
	...VINTAGE_TEMPLATES,
	...MODERN_TEMPLATES,
];

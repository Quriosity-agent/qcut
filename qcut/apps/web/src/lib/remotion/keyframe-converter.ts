/**
 * Keyframe Converter
 *
 * Converts QCut keyframes to Remotion interpolate() calls for animation.
 * Supports multiple easing functions and value types.
 *
 * @module lib/remotion/keyframe-converter
 */

import { interpolate, Easing } from "remotion";

// ============================================================================
// Types
// ============================================================================

/**
 * Supported easing types for keyframe animations
 */
export type EasingType =
	| "linear"
	| "easeIn"
	| "easeOut"
	| "easeInOut"
	| "spring";

/**
 * A single keyframe in the animation timeline
 */
export interface Keyframe {
	/** Unique identifier for the keyframe */
	id: string;
	/** Frame number where the keyframe occurs */
	frame: number;
	/** Value at this keyframe (number, color string, etc.) */
	value: unknown;
	/** Easing function to use when interpolating TO this keyframe */
	easing: EasingType;
}

/**
 * Configuration for generating animated props
 */
export interface KeyframeAnimationConfig {
	/** The keyframes defining the animation */
	keyframes: Keyframe[];
	/** FPS of the composition (for time calculations) */
	fps?: number;
	/** Whether to extrapolate values beyond keyframe range */
	extrapolate?: "clamp" | "extend" | "identity";
}

// ============================================================================
// Easing Functions
// ============================================================================

/**
 * Map of easing type names to Remotion easing functions
 */
export const EASING_FUNCTIONS: Record<
	EasingType,
	((t: number) => number) | undefined
> = {
	linear: undefined, // Default linear interpolation
	easeIn: Easing.ease,
	easeOut: Easing.out(Easing.ease),
	easeInOut: Easing.inOut(Easing.ease),
	spring: Easing.bezier(0.25, 1.5, 0.5, 1), // Custom spring-like bezier
};

/**
 * Get the Remotion easing function for a given easing type
 */
export function getEasingFunction(
	easing: EasingType
): ((t: number) => number) | undefined {
	return EASING_FUNCTIONS[easing];
}

// ============================================================================
// Keyframe Utilities
// ============================================================================

/**
 * Sort keyframes by frame number (ascending)
 */
export function sortKeyframes<T extends { frame: number }>(
	keyframes: T[]
): T[] {
	return [...keyframes].sort((a, b) => a.frame - b.frame);
}

/**
 * Validate keyframes array
 * @returns Error message if invalid, undefined if valid
 */
export function validateKeyframes(keyframes: Keyframe[]): string | undefined {
	if (keyframes.length === 0) {
		return "At least one keyframe is required";
	}

	// Check for duplicate frames
	const frames = new Set<number>();
	for (const kf of keyframes) {
		if (frames.has(kf.frame)) {
			return `Duplicate keyframe at frame ${kf.frame}`;
		}
		frames.add(kf.frame);
	}

	// Check for negative frames
	if (keyframes.some((kf) => kf.frame < 0)) {
		return "Keyframe frames cannot be negative";
	}

	return;
}

/**
 * Find the keyframe pair surrounding a given frame
 * @returns [previousKeyframe, nextKeyframe] or [keyframe, keyframe] if exact match
 */
export function findSurroundingKeyframes(
	keyframes: Keyframe[],
	frame: number
): [Keyframe, Keyframe] | null {
	if (keyframes.length === 0) return null;

	const sorted = sortKeyframes(keyframes);

	// Before first keyframe
	if (frame <= sorted[0].frame) {
		return [sorted[0], sorted[0]];
	}

	// After last keyframe
	if (frame >= sorted[sorted.length - 1].frame) {
		return [sorted[sorted.length - 1], sorted[sorted.length - 1]];
	}

	// Find surrounding keyframes
	for (let i = 0; i < sorted.length - 1; i++) {
		if (frame >= sorted[i].frame && frame <= sorted[i + 1].frame) {
			return [sorted[i], sorted[i + 1]];
		}
	}

	return null;
}

// ============================================================================
// Interpolation Functions
// ============================================================================

/**
 * Interpolate a numeric value at the given frame
 */
export function interpolateNumber(
	keyframes: Keyframe[],
	frame: number,
	extrapolate: "clamp" | "extend" | "identity" = "clamp"
): number {
	if (keyframes.length === 0) return 0;
	if (keyframes.length === 1) return keyframes[0].value as number;

	const sorted = sortKeyframes(keyframes);
	const inputRange = sorted.map((kf) => kf.frame);
	const outputRange = sorted.map((kf) => kf.value as number);

	// For multi-segment animations, we need to find which segment we're in
	// and use the appropriate easing for that segment
	const surrounding = findSurroundingKeyframes(keyframes, frame);
	if (!surrounding) return keyframes[0].value as number;

	const [prev, next] = surrounding;
	if (prev === next) {
		return prev.value as number;
	}

	// Use the "next" keyframe's easing (easing TO this keyframe)
	const easing = getEasingFunction(next.easing);

	return interpolate(frame, inputRange, outputRange, {
		extrapolateLeft: extrapolate,
		extrapolateRight: extrapolate,
		easing,
	});
}

/**
 * Interpolate a color value at the given frame
 * Supports hex colors (#RRGGBB, #RGB) and rgb() format
 */
export function interpolateColor(
	keyframes: Keyframe[],
	frame: number,
	extrapolate: "clamp" | "extend" | "identity" = "clamp"
): string {
	if (keyframes.length === 0) return "#000000";
	if (keyframes.length === 1) return keyframes[0].value as string;

	const sorted = sortKeyframes(keyframes);

	// Parse colors to RGB components
	const parsedColors = sorted.map((kf) => parseColor(kf.value as string));

	// Interpolate each channel separately
	const r = interpolateNumber(
		sorted.map((kf, i) => ({ ...kf, value: parsedColors[i].r })),
		frame,
		extrapolate
	);
	const g = interpolateNumber(
		sorted.map((kf, i) => ({ ...kf, value: parsedColors[i].g })),
		frame,
		extrapolate
	);
	const b = interpolateNumber(
		sorted.map((kf, i) => ({ ...kf, value: parsedColors[i].b })),
		frame,
		extrapolate
	);

	// Return as hex color
	return rgbToHex(Math.round(r), Math.round(g), Math.round(b));
}

/**
 * Parse a color string to RGB components
 */
export function parseColor(color: string): { r: number; g: number; b: number } {
	// Handle hex colors
	if (color.startsWith("#")) {
		const hex = color.slice(1);
		if (hex.length === 3) {
			// #RGB format
			return {
				r: parseInt(hex[0] + hex[0], 16),
				g: parseInt(hex[1] + hex[1], 16),
				b: parseInt(hex[2] + hex[2], 16),
			};
		}
		if (hex.length === 6) {
			// #RRGGBB format
			return {
				r: parseInt(hex.slice(0, 2), 16),
				g: parseInt(hex.slice(2, 4), 16),
				b: parseInt(hex.slice(4, 6), 16),
			};
		}
	}

	// Handle rgb() format
	const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (rgbMatch) {
		return {
			r: parseInt(rgbMatch[1], 10),
			g: parseInt(rgbMatch[2], 10),
			b: parseInt(rgbMatch[3], 10),
		};
	}

	// Default to black
	return { r: 0, g: 0, b: 0 };
}

/**
 * Convert RGB values to hex color string
 */
export function rgbToHex(r: number, g: number, b: number): string {
	const toHex = (n: number) => {
		const clamped = Math.max(0, Math.min(255, n));
		return clamped.toString(16).padStart(2, "0");
	};
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ============================================================================
// Animated Prop Generators
// ============================================================================

/**
 * Generate an animated prop function from keyframes
 * Returns a function that takes a frame number and returns the interpolated value
 */
export function generateAnimatedProp(
	keyframes: Keyframe[],
	propType: "number" | "color" = "number"
): (frame: number) => unknown {
	if (keyframes.length === 0) {
		return () => (propType === "color" ? "#000000" : 0);
	}

	if (keyframes.length === 1) {
		const value = keyframes[0].value;
		return () => value;
	}

	if (propType === "color") {
		return (frame: number) => interpolateColor(keyframes, frame);
	}

	return (frame: number) => interpolateNumber(keyframes, frame);
}

/**
 * Convert keyframes to a Remotion interpolate() code string
 * Useful for code generation and export
 */
export function convertToRemotionInterpolate(
	keyframes: Keyframe[],
	propName: string,
	propType: "number" | "color" = "number"
): string {
	if (keyframes.length === 0) {
		return propType === "color" ? `"#000000"` : "0";
	}

	if (keyframes.length === 1) {
		const value = keyframes[0].value;
		return typeof value === "string" ? `"${value}"` : String(value);
	}

	const sorted = sortKeyframes(keyframes);
	const inputRange = `[${sorted.map((kf) => kf.frame).join(", ")}]`;
	const outputRange =
		propType === "color"
			? `[${sorted.map((kf) => `"${kf.value}"`).join(", ")}]`
			: `[${sorted.map((kf) => kf.value).join(", ")}]`;

	// Get easing for first segment (simplified - real implementation would need
	// multi-segment handling)
	const easing = sorted[1]?.easing || "linear";
	const easingCode = getEasingCode(easing);

	if (propType === "color") {
		return `interpolateColors(frame, ${inputRange}, ${outputRange}${easingCode ? `, { easing: ${easingCode} }` : ""})`;
	}

	return `interpolate(frame, ${inputRange}, ${outputRange}${easingCode ? `, { easing: ${easingCode} }` : ""})`;
}

/**
 * Get the Remotion easing code for an easing type
 */
function getEasingCode(easing: EasingType): string {
	switch (easing) {
		case "easeIn":
			return "Easing.ease";
		case "easeOut":
			return "Easing.out(Easing.ease)";
		case "easeInOut":
			return "Easing.inOut(Easing.ease)";
		case "spring":
			return "Easing.bezier(0.25, 1.5, 0.5, 1)";
		default:
			return "";
	}
}

// ============================================================================
// Keyframe Management Helpers
// ============================================================================

/**
 * Add a keyframe to an existing keyframes array
 * Returns a new sorted array with the keyframe added
 */
export function addKeyframe(
	keyframes: Keyframe[],
	newKeyframe: Keyframe
): Keyframe[] {
	// Remove any existing keyframe at the same frame
	const filtered = keyframes.filter((kf) => kf.frame !== newKeyframe.frame);
	return sortKeyframes([...filtered, newKeyframe]);
}

/**
 * Update a keyframe in the array
 */
export function updateKeyframe(
	keyframes: Keyframe[],
	id: string,
	updates: Partial<Omit<Keyframe, "id">>
): Keyframe[] {
	return sortKeyframes(
		keyframes.map((kf) => (kf.id === id ? { ...kf, ...updates } : kf))
	);
}

/**
 * Delete a keyframe from the array
 */
export function deleteKeyframe(keyframes: Keyframe[], id: string): Keyframe[] {
	return keyframes.filter((kf) => kf.id !== id);
}

/**
 * Create a new keyframe with a unique ID
 */
export function createKeyframe(
	frame: number,
	value: unknown,
	easing: EasingType = "linear"
): Keyframe {
	return {
		id: `kf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
		frame,
		value,
		easing,
	};
}

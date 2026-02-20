/**
 * Keyframe Converter Tests
 *
 * Tests for keyframe interpolation and animation generation.
 *
 * @module lib/remotion/__tests__/keyframe-converter.test
 */

import { describe, it, expect } from "vitest";
import {
	sortKeyframes,
	validateKeyframes,
	findSurroundingKeyframes,
	interpolateNumber,
	interpolateColor,
	parseColor,
	rgbToHex,
	generateAnimatedProp,
	convertToRemotionInterpolate,
	addKeyframe,
	updateKeyframe,
	deleteKeyframe,
	createKeyframe,
	type Keyframe,
} from "../keyframe-converter";

// ============================================================================
// Test Helpers
// ============================================================================

function createTestKeyframe(
	frame: number,
	value: unknown,
	easing: Keyframe["easing"] = "linear"
): Keyframe {
	return {
		id: `test-${frame}`,
		frame,
		value,
		easing,
	};
}

// ============================================================================
// sortKeyframes Tests
// ============================================================================

describe("sortKeyframes", () => {
	it("should sort keyframes by frame number ascending", () => {
		const keyframes = [
			createTestKeyframe(30, 100),
			createTestKeyframe(0, 0),
			createTestKeyframe(15, 50),
		];

		const sorted = sortKeyframes(keyframes);

		expect(sorted[0].frame).toBe(0);
		expect(sorted[1].frame).toBe(15);
		expect(sorted[2].frame).toBe(30);
	});

	it("should not mutate original array", () => {
		const keyframes = [createTestKeyframe(30, 100), createTestKeyframe(0, 0)];

		sortKeyframes(keyframes);

		expect(keyframes[0].frame).toBe(30);
	});

	it("should handle empty array", () => {
		expect(sortKeyframes([])).toEqual([]);
	});

	it("should handle single keyframe", () => {
		const keyframes = [createTestKeyframe(10, 50)];
		const sorted = sortKeyframes(keyframes);
		expect(sorted.length).toBe(1);
		expect(sorted[0].frame).toBe(10);
	});
});

// ============================================================================
// validateKeyframes Tests
// ============================================================================

describe("validateKeyframes", () => {
	it("should return error for empty array", () => {
		expect(validateKeyframes([])).toBe("At least one keyframe is required");
	});

	it("should return undefined for valid keyframes", () => {
		const keyframes = [createTestKeyframe(0, 0), createTestKeyframe(30, 100)];
		expect(validateKeyframes(keyframes)).toBeUndefined();
	});

	it("should detect duplicate frames", () => {
		const keyframes = [createTestKeyframe(10, 0), createTestKeyframe(10, 100)];
		expect(validateKeyframes(keyframes)).toBe("Duplicate keyframe at frame 10");
	});

	it("should detect negative frames", () => {
		const keyframes = [createTestKeyframe(-5, 0)];
		expect(validateKeyframes(keyframes)).toBe(
			"Keyframe frames cannot be negative"
		);
	});
});

// ============================================================================
// findSurroundingKeyframes Tests
// ============================================================================

describe("findSurroundingKeyframes", () => {
	it("should return null for empty keyframes", () => {
		expect(findSurroundingKeyframes([], 10)).toBeNull();
	});

	it("should return last keyframe repeated for exact match on last", () => {
		const keyframes = [createTestKeyframe(0, 0), createTestKeyframe(30, 100)];

		const result = findSurroundingKeyframes(keyframes, 30);

		// Frame 30 is at or after last keyframe, so returns [30, 30]
		expect(result?.[0].frame).toBe(30);
		expect(result?.[1].frame).toBe(30);
	});

	it("should return same keyframe for exact match on first", () => {
		const keyframes = [createTestKeyframe(0, 0), createTestKeyframe(30, 100)];

		const result = findSurroundingKeyframes(keyframes, 0);

		// Frame 0 is at or before first keyframe
		expect(result?.[0].frame).toBe(0);
		expect(result?.[1].frame).toBe(0);
	});

	it("should return first keyframe repeated when before range", () => {
		const keyframes = [createTestKeyframe(10, 50), createTestKeyframe(30, 100)];

		const result = findSurroundingKeyframes(keyframes, 5);

		expect(result?.[0].frame).toBe(10);
		expect(result?.[1].frame).toBe(10);
	});

	it("should return last keyframe repeated when after range", () => {
		const keyframes = [createTestKeyframe(0, 0), createTestKeyframe(30, 100)];

		const result = findSurroundingKeyframes(keyframes, 50);

		expect(result?.[0].frame).toBe(30);
		expect(result?.[1].frame).toBe(30);
	});

	it("should find surrounding keyframes in middle", () => {
		const keyframes = [
			createTestKeyframe(0, 0),
			createTestKeyframe(30, 100),
			createTestKeyframe(60, 200),
		];

		const result = findSurroundingKeyframes(keyframes, 45);

		expect(result?.[0].frame).toBe(30);
		expect(result?.[1].frame).toBe(60);
	});
});

// ============================================================================
// interpolateNumber Tests
// ============================================================================

describe("interpolateNumber", () => {
	it("should return 0 for empty keyframes", () => {
		expect(interpolateNumber([], 10)).toBe(0);
	});

	it("should return single keyframe value", () => {
		const keyframes = [createTestKeyframe(0, 50)];
		expect(interpolateNumber(keyframes, 10)).toBe(50);
	});

	it("should interpolate between two keyframes linearly", () => {
		const keyframes = [createTestKeyframe(0, 0), createTestKeyframe(30, 100)];

		// Exact start
		expect(interpolateNumber(keyframes, 0)).toBe(0);

		// Exact end
		expect(interpolateNumber(keyframes, 30)).toBe(100);

		// Middle
		expect(interpolateNumber(keyframes, 15)).toBe(50);
	});

	it("should clamp values before first keyframe", () => {
		const keyframes = [createTestKeyframe(10, 50), createTestKeyframe(30, 100)];

		expect(interpolateNumber(keyframes, 5)).toBe(50);
	});

	it("should clamp values after last keyframe", () => {
		const keyframes = [createTestKeyframe(0, 0), createTestKeyframe(30, 100)];

		expect(interpolateNumber(keyframes, 50)).toBe(100);
	});

	it("should handle multiple segments", () => {
		const keyframes = [
			createTestKeyframe(0, 0),
			createTestKeyframe(30, 100),
			createTestKeyframe(60, 50),
		];

		expect(interpolateNumber(keyframes, 0)).toBe(0);
		expect(interpolateNumber(keyframes, 30)).toBe(100);
		expect(interpolateNumber(keyframes, 60)).toBe(50);
		expect(interpolateNumber(keyframes, 45)).toBeCloseTo(75, 0);
	});
});

// ============================================================================
// Color Parsing Tests
// ============================================================================

describe("parseColor", () => {
	it("should parse 6-digit hex color", () => {
		const result = parseColor("#ff0000");
		expect(result).toEqual({ r: 255, g: 0, b: 0 });
	});

	it("should parse 3-digit hex color", () => {
		const result = parseColor("#f00");
		expect(result).toEqual({ r: 255, g: 0, b: 0 });
	});

	it("should parse rgb() format", () => {
		const result = parseColor("rgb(255, 128, 0)");
		expect(result).toEqual({ r: 255, g: 128, b: 0 });
	});

	it("should return black for invalid color", () => {
		const result = parseColor("invalid");
		expect(result).toEqual({ r: 0, g: 0, b: 0 });
	});
});

describe("rgbToHex", () => {
	it("should convert RGB to hex", () => {
		expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
		expect(rgbToHex(0, 255, 0)).toBe("#00ff00");
		expect(rgbToHex(0, 0, 255)).toBe("#0000ff");
		expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
		expect(rgbToHex(0, 0, 0)).toBe("#000000");
	});

	it("should clamp values to 0-255", () => {
		expect(rgbToHex(300, -10, 128)).toBe("#ff0080");
	});
});

// ============================================================================
// interpolateColor Tests
// ============================================================================

describe("interpolateColor", () => {
	it("should return black for empty keyframes", () => {
		expect(interpolateColor([], 10)).toBe("#000000");
	});

	it("should return single keyframe color", () => {
		const keyframes = [createTestKeyframe(0, "#ff0000")];
		expect(interpolateColor(keyframes, 10)).toBe("#ff0000");
	});

	it("should interpolate between two colors", () => {
		const keyframes = [
			createTestKeyframe(0, "#ff0000"),
			createTestKeyframe(30, "#0000ff"),
		];

		// Red at start
		expect(interpolateColor(keyframes, 0)).toBe("#ff0000");

		// Blue at end
		expect(interpolateColor(keyframes, 30)).toBe("#0000ff");

		// Purple-ish in middle (128, 0, 128)
		const middle = interpolateColor(keyframes, 15);
		expect(middle).toBe("#800080");
	});
});

// ============================================================================
// generateAnimatedProp Tests
// ============================================================================

describe("generateAnimatedProp", () => {
	it("should return constant for empty keyframes (number)", () => {
		const fn = generateAnimatedProp([], "number");
		expect(fn(0)).toBe(0);
		expect(fn(100)).toBe(0);
	});

	it("should return constant for empty keyframes (color)", () => {
		const fn = generateAnimatedProp([], "color");
		expect(fn(0)).toBe("#000000");
	});

	it("should return constant for single keyframe", () => {
		const keyframes = [createTestKeyframe(0, 50)];
		const fn = generateAnimatedProp(keyframes, "number");

		expect(fn(0)).toBe(50);
		expect(fn(100)).toBe(50);
	});

	it("should return animated function for number keyframes", () => {
		const keyframes = [createTestKeyframe(0, 0), createTestKeyframe(30, 100)];
		const fn = generateAnimatedProp(keyframes, "number");

		expect(fn(0)).toBe(0);
		expect(fn(15)).toBe(50);
		expect(fn(30)).toBe(100);
	});

	it("should return animated function for color keyframes", () => {
		const keyframes = [
			createTestKeyframe(0, "#ff0000"),
			createTestKeyframe(30, "#0000ff"),
		];
		const fn = generateAnimatedProp(keyframes, "color");

		expect(fn(0)).toBe("#ff0000");
		expect(fn(30)).toBe("#0000ff");
	});
});

// ============================================================================
// convertToRemotionInterpolate Tests
// ============================================================================

describe("convertToRemotionInterpolate", () => {
	it("should return constant for empty keyframes", () => {
		expect(convertToRemotionInterpolate([], "opacity", "number")).toBe("0");
		expect(convertToRemotionInterpolate([], "color", "color")).toBe(
			'"#000000"'
		);
	});

	it("should return single value for one keyframe", () => {
		const keyframes = [createTestKeyframe(0, 50)];
		expect(convertToRemotionInterpolate(keyframes, "opacity", "number")).toBe(
			"50"
		);
	});

	it("should generate interpolate call for number keyframes", () => {
		const keyframes = [createTestKeyframe(0, 0), createTestKeyframe(30, 100)];
		const result = convertToRemotionInterpolate(keyframes, "opacity", "number");

		expect(result).toContain("interpolate(frame");
		expect(result).toContain("[0, 30]");
		expect(result).toContain("[0, 100]");
	});

	it("should generate interpolateColors call for color keyframes", () => {
		const keyframes = [
			createTestKeyframe(0, "#ff0000"),
			createTestKeyframe(30, "#0000ff"),
		];
		const result = convertToRemotionInterpolate(
			keyframes,
			"backgroundColor",
			"color"
		);

		expect(result).toContain("interpolateColors(frame");
		expect(result).toContain("[0, 30]");
		expect(result).toContain('"#ff0000"');
		expect(result).toContain('"#0000ff"');
	});

	it("should include easing when not linear", () => {
		const keyframes = [
			createTestKeyframe(0, 0),
			{ ...createTestKeyframe(30, 100), easing: "easeInOut" as const },
		];
		const result = convertToRemotionInterpolate(keyframes, "opacity", "number");

		expect(result).toContain("easing:");
		expect(result).toContain("Easing.inOut");
	});
});

// ============================================================================
// Keyframe Management Tests
// ============================================================================

describe("addKeyframe", () => {
	it("should add keyframe to empty array", () => {
		const newKf = createTestKeyframe(10, 50);
		const result = addKeyframe([], newKf);

		expect(result.length).toBe(1);
		expect(result[0]).toBe(newKf);
	});

	it("should add and sort keyframes", () => {
		const existing = [createTestKeyframe(0, 0), createTestKeyframe(30, 100)];
		const newKf = createTestKeyframe(15, 50);
		const result = addKeyframe(existing, newKf);

		expect(result.length).toBe(3);
		expect(result[0].frame).toBe(0);
		expect(result[1].frame).toBe(15);
		expect(result[2].frame).toBe(30);
	});

	it("should replace keyframe at same frame", () => {
		const existing = [createTestKeyframe(10, 50)];
		const newKf = { ...createTestKeyframe(10, 100), id: "new" };
		const result = addKeyframe(existing, newKf);

		expect(result.length).toBe(1);
		expect(result[0].value).toBe(100);
		expect(result[0].id).toBe("new");
	});
});

describe("updateKeyframe", () => {
	it("should update keyframe by id", () => {
		const keyframes = [createTestKeyframe(0, 0), createTestKeyframe(30, 100)];
		const result = updateKeyframe(keyframes, "test-0", { value: 50 });

		expect(result[0].value).toBe(50);
		expect(result[1].value).toBe(100);
	});

	it("should re-sort when frame changes", () => {
		const keyframes = [createTestKeyframe(0, 0), createTestKeyframe(30, 100)];
		const result = updateKeyframe(keyframes, "test-0", { frame: 50 });

		expect(result[0].frame).toBe(30);
		expect(result[1].frame).toBe(50);
	});

	it("should not mutate original array", () => {
		const keyframes = [createTestKeyframe(0, 0)];
		updateKeyframe(keyframes, "test-0", { value: 100 });

		expect(keyframes[0].value).toBe(0);
	});
});

describe("deleteKeyframe", () => {
	it("should remove keyframe by id", () => {
		const keyframes = [createTestKeyframe(0, 0), createTestKeyframe(30, 100)];
		const result = deleteKeyframe(keyframes, "test-0");

		expect(result.length).toBe(1);
		expect(result[0].id).toBe("test-30");
	});

	it("should return empty array when deleting last keyframe", () => {
		const keyframes = [createTestKeyframe(0, 0)];
		const result = deleteKeyframe(keyframes, "test-0");

		expect(result.length).toBe(0);
	});
});

describe("createKeyframe", () => {
	it("should create keyframe with unique id", () => {
		const kf1 = createKeyframe(0, 100);
		const kf2 = createKeyframe(0, 100);

		expect(kf1.id).not.toBe(kf2.id);
		expect(kf1.id).toMatch(/^kf-\d+-[a-z0-9]+$/);
	});

	it("should use default linear easing", () => {
		const kf = createKeyframe(0, 100);
		expect(kf.easing).toBe("linear");
	});

	it("should use provided easing", () => {
		const kf = createKeyframe(0, 100, "easeInOut");
		expect(kf.easing).toBe("easeInOut");
	});
});

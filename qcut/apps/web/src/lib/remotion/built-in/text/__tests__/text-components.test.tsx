/**
 * Text Components Combined Tests
 *
 * Tests for BounceText, SlideText, ScaleText, and index exports.
 *
 * @module lib/remotion/built-in/text/__tests__/text-components.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

// Import all components and definitions
import {
	BounceText,
	BounceTextSchema,
	BounceTextDefinition,
	bounceTextDefaultProps,
} from "../bounce-text";

import {
	SlideText,
	SlideTextSchema,
	SlideTextDefinition,
	slideTextDefaultProps,
} from "../slide-text";

import {
	ScaleText,
	ScaleTextSchema,
	ScaleTextDefinition,
	scaleTextDefaultProps,
} from "../scale-text";

import {
	textComponentDefinitions,
	textComponentsById,
	getTextComponent,
	isTextComponent,
} from "../index";

// Mock Remotion hooks
vi.mock("remotion", () => ({
	useCurrentFrame: vi.fn(() => 15),
	useVideoConfig: vi.fn(() => ({
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 90,
	})),
	interpolate: vi.fn((value, inputRange, outputRange, options) => {
		const [inputMin, inputMax] = inputRange;
		const [outputMin, outputMax] = outputRange;
		let progress = (value - inputMin) / (inputMax - inputMin);
		if (options?.extrapolateLeft === "clamp") progress = Math.max(0, progress);
		if (options?.extrapolateRight === "clamp") progress = Math.min(1, progress);
		return outputMin + progress * (outputMax - outputMin);
	}),
	spring: vi.fn(() => 0.5),
	Easing: {
		linear: (t: number) => t,
		ease: (t: number) => t,
		cubic: (t: number) => t * t * t,
		out: (fn: (t: number) => number) => (t: number) => 1 - fn(1 - t),
		in: (fn: (t: number) => number) => fn,
		inOut: (fn: (t: number) => number) => fn,
		back: (overshoot: number) => (t: number) => t,
	},
}));

// ============================================================================
// BounceText Tests
// ============================================================================

describe("BounceText", () => {
	describe("Schema", () => {
		it("should validate default props", () => {
			const result = BounceTextSchema.safeParse(bounceTextDefaultProps);
			expect(result.success).toBe(true);
		});

		it("should validate valid props", () => {
			const result = BounceTextSchema.safeParse({
				text: "Bounce test",
				bounceMode: "word",
				damping: 15,
				stiffness: 150,
			});
			expect(result.success).toBe(true);
		});

		it("should reject empty text", () => {
			const result = BounceTextSchema.safeParse({
				...bounceTextDefaultProps,
				text: "",
			});
			expect(result.success).toBe(false);
		});

		it("should reject invalid direction", () => {
			const result = BounceTextSchema.safeParse({
				...bounceTextDefaultProps,
				direction: "diagonal",
			});
			expect(result.success).toBe(false);
		});

		it("should apply default values", () => {
			const result = BounceTextSchema.parse({});
			expect(result.text).toBe("Bounce!");
			expect(result.bounceMode).toBe("character");
			expect(result.direction).toBe("up");
		});
	});

	describe("Component", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("should render without crashing", () => {
			const { container } = render(<BounceText />);
			expect(container).toBeTruthy();
		});

		it("should render with custom text", () => {
			render(<BounceText text="Custom Bounce" />);
			const container = document.querySelector("div");
			expect(container).toBeTruthy();
		});

		it("should render with custom font size", () => {
			render(<BounceText fontSize={96} />);
			// Component should render with custom props
			const container = document.querySelector("div");
			expect(container).toBeTruthy();
		});

		it("should render in 'all' mode", () => {
			render(<BounceText bounceMode="all" />);
			const container = document.querySelector("div");
			expect(container).toBeTruthy();
		});

		it("should render in 'word' mode", () => {
			render(<BounceText bounceMode="word" text="Bounce words" />);
			const container = document.querySelector("div");
			expect(container).toBeTruthy();
		});

		it("should render in 'character' mode", () => {
			render(<BounceText bounceMode="character" text="ABC" />);
			const container = document.querySelector("div");
			expect(container).toBeTruthy();
		});
	});

	describe("Definition", () => {
		it("should have correct id", () => {
			expect(BounceTextDefinition.id).toBe("built-in-bounce-text");
		});

		it("should have correct category", () => {
			expect(BounceTextDefinition.category).toBe("text");
		});

		it("should have spring tag", () => {
			expect(BounceTextDefinition.tags).toContain("spring");
		});
	});
});

// ============================================================================
// SlideText Tests
// ============================================================================

describe("SlideText", () => {
	describe("Schema", () => {
		it("should validate default props", () => {
			const result = SlideTextSchema.safeParse(slideTextDefaultProps);
			expect(result.success).toBe(true);
		});

		it("should validate valid props", () => {
			const result = SlideTextSchema.safeParse({
				text: "Slide test",
				direction: "right",
				slideMode: "word",
				slideDuration: 45,
			});
			expect(result.success).toBe(true);
		});

		it("should reject empty text", () => {
			const result = SlideTextSchema.safeParse({
				...slideTextDefaultProps,
				text: "",
			});
			expect(result.success).toBe(false);
		});

		it("should reject invalid direction", () => {
			const result = SlideTextSchema.safeParse({
				...slideTextDefaultProps,
				direction: "diagonal",
			});
			expect(result.success).toBe(false);
		});

		it("should apply default values", () => {
			const result = SlideTextSchema.parse({});
			expect(result.text).toBe("Slide In");
			expect(result.direction).toBe("left");
			expect(result.slideMode).toBe("all");
		});

		it("should validate all directions", () => {
			for (const direction of ["left", "right", "top", "bottom"]) {
				const result = SlideTextSchema.safeParse({
					...slideTextDefaultProps,
					direction,
				});
				expect(result.success).toBe(true);
			}
		});
	});

	describe("Component", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("should render without crashing", () => {
			const { container } = render(<SlideText />);
			expect(container).toBeTruthy();
		});

		it("should render with custom direction", () => {
			render(<SlideText direction="right" />);
			const container = document.querySelector("div");
			expect(container).toBeTruthy();
		});

		it("should render with custom font size", () => {
			render(<SlideText fontSize={84} />);
			// Component should render with custom props
			const container = document.querySelector("div");
			expect(container).toBeTruthy();
		});

		it("should render container for slide effect", () => {
			render(<SlideText />);
			const container = document.querySelector("div");
			// Component should render properly
			expect(container).toBeTruthy();
		});

		it("should render in all slide modes", () => {
			for (const slideMode of ["all", "word", "character"] as const) {
				const { container } = render(<SlideText slideMode={slideMode} />);
				expect(container).toBeTruthy();
			}
		});
	});

	describe("Definition", () => {
		it("should have correct id", () => {
			expect(SlideTextDefinition.id).toBe("built-in-slide-text");
		});

		it("should have correct category", () => {
			expect(SlideTextDefinition.category).toBe("text");
		});

		it("should have motion tag", () => {
			expect(SlideTextDefinition.tags).toContain("motion");
		});
	});
});

// ============================================================================
// ScaleText Tests
// ============================================================================

describe("ScaleText", () => {
	describe("Schema", () => {
		it("should validate default props", () => {
			const result = ScaleTextSchema.safeParse(scaleTextDefaultProps);
			expect(result.success).toBe(true);
		});

		it("should validate valid props", () => {
			const result = ScaleTextSchema.safeParse({
				text: "Scale test",
				animationStyle: "zoom",
				scaleMode: "word",
				animationDuration: 45,
			});
			expect(result.success).toBe(true);
		});

		it("should reject empty text", () => {
			const result = ScaleTextSchema.safeParse({
				...scaleTextDefaultProps,
				text: "",
			});
			expect(result.success).toBe(false);
		});

		it("should reject invalid animationStyle", () => {
			const result = ScaleTextSchema.safeParse({
				...scaleTextDefaultProps,
				animationStyle: "invalid",
			});
			expect(result.success).toBe(false);
		});

		it("should apply default values", () => {
			const result = ScaleTextSchema.parse({});
			expect(result.text).toBe("Scale Up!");
			expect(result.animationStyle).toBe("pop");
			expect(result.scaleMode).toBe("all");
		});

		it("should validate all animation styles", () => {
			for (const animationStyle of ["zoom", "pop", "grow", "shrink"]) {
				const result = ScaleTextSchema.safeParse({
					...scaleTextDefaultProps,
					animationStyle,
				});
				expect(result.success).toBe(true);
			}
		});
	});

	describe("Component", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("should render without crashing", () => {
			const { container } = render(<ScaleText />);
			expect(container).toBeTruthy();
		});

		it("should render with zoom style", () => {
			render(<ScaleText animationStyle="zoom" />);
			const container = document.querySelector("div");
			expect(container).toBeTruthy();
		});

		it("should render with pop style", () => {
			render(<ScaleText animationStyle="pop" />);
			const container = document.querySelector("div");
			expect(container).toBeTruthy();
		});

		it("should render with grow style", () => {
			render(<ScaleText animationStyle="grow" />);
			const container = document.querySelector("div");
			expect(container).toBeTruthy();
		});

		it("should render with shrink style", () => {
			render(<ScaleText animationStyle="shrink" />);
			const container = document.querySelector("div");
			expect(container).toBeTruthy();
		});

		it("should render with custom font size", () => {
			render(<ScaleText fontSize={100} />);
			// Component should render with custom props
			const container = document.querySelector("div");
			expect(container).toBeTruthy();
		});

		it("should render with rotation enabled", () => {
			render(<ScaleText includeRotation={true} initialRotation={45} />);
			const span = document.querySelector("span");
			// Component should render with rotation props
			expect(span).toBeTruthy();
		});
	});

	describe("Definition", () => {
		it("should have correct id", () => {
			expect(ScaleTextDefinition.id).toBe("built-in-scale-text");
		});

		it("should have correct category", () => {
			expect(ScaleTextDefinition.category).toBe("text");
		});

		it("should have scale and zoom tags", () => {
			expect(ScaleTextDefinition.tags).toContain("scale");
			expect(ScaleTextDefinition.tags).toContain("zoom");
		});
	});
});

// ============================================================================
// Index Export Tests
// ============================================================================

describe("Text Components Index", () => {
	it("should export all component definitions", () => {
		expect(textComponentDefinitions).toHaveLength(5);
	});

	it("should include all text components in definitions", () => {
		const ids = textComponentDefinitions.map((def) => def.id);
		expect(ids).toContain("built-in-typewriter");
		expect(ids).toContain("built-in-fade-in-text");
		expect(ids).toContain("built-in-bounce-text");
		expect(ids).toContain("built-in-slide-text");
		expect(ids).toContain("built-in-scale-text");
	});

	it("should have all definitions in textComponentsById map", () => {
		expect(textComponentsById.size).toBe(5);
		expect(textComponentsById.has("built-in-typewriter")).toBe(true);
		expect(textComponentsById.has("built-in-fade-in-text")).toBe(true);
		expect(textComponentsById.has("built-in-bounce-text")).toBe(true);
		expect(textComponentsById.has("built-in-slide-text")).toBe(true);
		expect(textComponentsById.has("built-in-scale-text")).toBe(true);
	});

	it("getTextComponent should return correct definition", () => {
		const typewriter = getTextComponent("built-in-typewriter");
		expect(typewriter).toBeDefined();
		expect(typewriter?.name).toBe("Typewriter");

		const fadeIn = getTextComponent("built-in-fade-in-text");
		expect(fadeIn).toBeDefined();
		expect(fadeIn?.name).toBe("Fade In Text");
	});

	it("getTextComponent should return undefined for unknown id", () => {
		const unknown = getTextComponent("unknown-component");
		expect(unknown).toBeUndefined();
	});

	it("isTextComponent should return true for text components", () => {
		expect(isTextComponent("built-in-typewriter")).toBe(true);
		expect(isTextComponent("built-in-fade-in-text")).toBe(true);
		expect(isTextComponent("built-in-bounce-text")).toBe(true);
		expect(isTextComponent("built-in-slide-text")).toBe(true);
		expect(isTextComponent("built-in-scale-text")).toBe(true);
	});

	it("isTextComponent should return false for non-text components", () => {
		expect(isTextComponent("unknown")).toBe(false);
		expect(isTextComponent("built-in-wipe")).toBe(false);
		expect(isTextComponent("")).toBe(false);
	});

	it("all definitions should have text category", () => {
		for (const def of textComponentDefinitions) {
			expect(def.category).toBe("text");
		}
	});

	it("all definitions should be built-in source", () => {
		for (const def of textComponentDefinitions) {
			expect(def.source).toBe("built-in");
		}
	});

	it("all definitions should have standard dimensions", () => {
		for (const def of textComponentDefinitions) {
			expect(def.width).toBe(1920);
			expect(def.height).toBe(1080);
			expect(def.fps).toBe(30);
		}
	});

	it("all definitions should have valid components", () => {
		for (const def of textComponentDefinitions) {
			expect(typeof def.component).toBe("function");
		}
	});

	it("all definitions should have valid schemas", () => {
		for (const def of textComponentDefinitions) {
			expect(def.schema).toBeDefined();
			expect(typeof def.schema.safeParse).toBe("function");
		}
	});
});

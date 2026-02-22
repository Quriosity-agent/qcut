import { describe, it, expect } from "vitest";
import {
	calculateGrid,
	validateSceneCount,
	getRecommendedResolution,
	RESOLUTION_PRESETS,
	SCENE_LIMITS,
} from "../grid-calculator";
import type { GridConfig } from "../grid-calculator";
import {
	buildStoryboardPrompt,
	buildRegenerationPrompt,
	getDefaultNegativePrompt,
	getStyleTokensFromPreset,
} from "../prompt-builder";
import type { StoryboardPromptConfig } from "../prompt-builder";

// ============================================================
// grid-calculator.ts
// ============================================================

describe("calculateGrid", () => {
	describe("edge case: 0 scenes", () => {
		it("returns 1x1 grid with full canvas size for landscape 2K", () => {
			const result = calculateGrid({
				sceneCount: 0,
				aspectRatio: "16:9",
				resolution: "2K",
			});
			expect(result.cols).toBe(1);
			expect(result.rows).toBe(1);
			expect(result.canvasWidth).toBe(1920);
			expect(result.canvasHeight).toBe(1080);
			expect(result.cellWidth).toBe(1920);
			expect(result.cellHeight).toBe(1080);
			expect(result.totalCells).toBe(1);
			expect(result.emptyCells).toBe(1);
		});

		it("returns 1x1 grid with full canvas size for portrait 4K", () => {
			const result = calculateGrid({
				sceneCount: 0,
				aspectRatio: "9:16",
				resolution: "4K",
			});
			expect(result.cols).toBe(1);
			expect(result.rows).toBe(1);
			expect(result.canvasWidth).toBe(2160);
			expect(result.canvasHeight).toBe(3840);
			expect(result.totalCells).toBe(1);
			expect(result.emptyCells).toBe(1);
		});
	});

	describe("edge case: 1 scene", () => {
		it("returns 1x1 grid with 0 empty cells for landscape 2K", () => {
			const result = calculateGrid({
				sceneCount: 1,
				aspectRatio: "16:9",
				resolution: "2K",
			});
			expect(result.cols).toBe(1);
			expect(result.rows).toBe(1);
			expect(result.cellWidth).toBe(1920);
			expect(result.cellHeight).toBe(1080);
			expect(result.totalCells).toBe(1);
			expect(result.emptyCells).toBe(0);
		});

		it("returns 1x1 grid with 0 empty cells for portrait 2K", () => {
			const result = calculateGrid({
				sceneCount: 1,
				aspectRatio: "9:16",
				resolution: "2K",
			});
			expect(result.cols).toBe(1);
			expect(result.rows).toBe(1);
			expect(result.cellWidth).toBe(1080);
			expect(result.cellHeight).toBe(1920);
			expect(result.totalCells).toBe(1);
			expect(result.emptyCells).toBe(0);
		});
	});

	describe("4 scenes (predefined optimal layout)", () => {
		it("returns 2x2 grid for landscape 2K", () => {
			const result = calculateGrid({
				sceneCount: 4,
				aspectRatio: "16:9",
				resolution: "2K",
			});
			expect(result.cols).toBe(2);
			expect(result.rows).toBe(2);
			expect(result.emptyCells).toBe(0);
			expect(result.totalCells).toBe(4);
			expect(result.canvasWidth).toBe(1920);
			expect(result.canvasHeight).toBe(1080);
		});

		it("returns 2x2 grid for portrait 2K", () => {
			const result = calculateGrid({
				sceneCount: 4,
				aspectRatio: "9:16",
				resolution: "2K",
			});
			expect(result.cols).toBe(2);
			expect(result.rows).toBe(2);
			expect(result.emptyCells).toBe(0);
			expect(result.totalCells).toBe(4);
			expect(result.canvasWidth).toBe(1080);
			expect(result.canvasHeight).toBe(1920);
		});

		it("returns correct cell dimensions for landscape 4K", () => {
			const result = calculateGrid({
				sceneCount: 4,
				aspectRatio: "16:9",
				resolution: "4K",
			});
			expect(result.cols).toBe(2);
			expect(result.rows).toBe(2);
			// cellWidth = floor(3840 / 2) = 1920
			expect(result.cellWidth).toBe(1920);
			// cellHeight = floor(1920 * 9 / 16) = 1080
			expect(result.cellHeight).toBe(1080);
		});
	});

	describe("9 scenes (3x3 optimal layout)", () => {
		it("returns 3x3 grid for landscape 2K", () => {
			const result = calculateGrid({
				sceneCount: 9,
				aspectRatio: "16:9",
				resolution: "2K",
			});
			expect(result.cols).toBe(3);
			expect(result.rows).toBe(3);
			expect(result.emptyCells).toBe(0);
			expect(result.totalCells).toBe(9);
		});

		it("returns 3x3 grid for portrait 2K", () => {
			const result = calculateGrid({
				sceneCount: 9,
				aspectRatio: "9:16",
				resolution: "2K",
			});
			expect(result.cols).toBe(3);
			expect(result.rows).toBe(3);
			expect(result.emptyCells).toBe(0);
			expect(result.totalCells).toBe(9);
		});
	});

	describe("12 scenes (predefined optimal layout)", () => {
		it("returns 4x3 grid for landscape 2K", () => {
			const result = calculateGrid({
				sceneCount: 12,
				aspectRatio: "16:9",
				resolution: "2K",
			});
			expect(result.cols).toBe(4);
			expect(result.rows).toBe(3);
			expect(result.emptyCells).toBe(0);
			expect(result.totalCells).toBe(12);
		});

		it("returns 3x4 grid for portrait 2K", () => {
			const result = calculateGrid({
				sceneCount: 12,
				aspectRatio: "9:16",
				resolution: "2K",
			});
			expect(result.cols).toBe(3);
			expect(result.rows).toBe(4);
			expect(result.emptyCells).toBe(0);
			expect(result.totalCells).toBe(12);
		});

		it("returns 4x3 grid for landscape 4K", () => {
			const result = calculateGrid({
				sceneCount: 12,
				aspectRatio: "16:9",
				resolution: "4K",
			});
			expect(result.cols).toBe(4);
			expect(result.rows).toBe(3);
			expect(result.emptyCells).toBe(0);
		});
	});

	describe("dynamic calculation (non-predefined scene counts)", () => {
		it("produces valid grid for 3 scenes landscape", () => {
			const result = calculateGrid({
				sceneCount: 3,
				aspectRatio: "16:9",
				resolution: "2K",
			});
			expect(result.totalCells).toBeGreaterThanOrEqual(3);
			expect(result.cols * result.rows).toBe(result.totalCells);
			expect(result.emptyCells).toBe(result.totalCells - 3);
		});

		it("produces valid grid for 5 scenes portrait", () => {
			const result = calculateGrid({
				sceneCount: 5,
				aspectRatio: "9:16",
				resolution: "2K",
			});
			expect(result.totalCells).toBeGreaterThanOrEqual(5);
			expect(result.cols * result.rows).toBe(result.totalCells);
			expect(result.emptyCells).toBe(result.totalCells - 5);
		});

		it("produces valid grid for 7 scenes landscape 4K", () => {
			const result = calculateGrid({
				sceneCount: 7,
				aspectRatio: "16:9",
				resolution: "4K",
			});
			expect(result.totalCells).toBeGreaterThanOrEqual(7);
			expect(result.cols * result.rows).toBe(result.totalCells);
			expect(result.canvasWidth).toBe(3840);
			expect(result.canvasHeight).toBe(2160);
		});
	});

	describe("resolution presets are correctly applied", () => {
		it("uses 1920x1080 for 2K landscape", () => {
			const result = calculateGrid({
				sceneCount: 4,
				aspectRatio: "16:9",
				resolution: "2K",
			});
			expect(result.canvasWidth).toBe(1920);
			expect(result.canvasHeight).toBe(1080);
		});

		it("uses 1080x1920 for 2K portrait", () => {
			const result = calculateGrid({
				sceneCount: 4,
				aspectRatio: "9:16",
				resolution: "2K",
			});
			expect(result.canvasWidth).toBe(1080);
			expect(result.canvasHeight).toBe(1920);
		});

		it("uses 3840x2160 for 4K landscape", () => {
			const result = calculateGrid({
				sceneCount: 4,
				aspectRatio: "16:9",
				resolution: "4K",
			});
			expect(result.canvasWidth).toBe(3840);
			expect(result.canvasHeight).toBe(2160);
		});

		it("uses 2160x3840 for 4K portrait", () => {
			const result = calculateGrid({
				sceneCount: 4,
				aspectRatio: "9:16",
				resolution: "4K",
			});
			expect(result.canvasWidth).toBe(2160);
			expect(result.canvasHeight).toBe(3840);
		});
	});

	describe("cell dimensions are positive integers", () => {
		const sceneCounts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

		for (const count of sceneCounts) {
			it(`cellWidth and cellHeight are positive for ${count} scenes (landscape 2K)`, () => {
				const result = calculateGrid({
					sceneCount: count,
					aspectRatio: "16:9",
					resolution: "2K",
				});
				expect(result.cellWidth).toBeGreaterThan(0);
				expect(result.cellHeight).toBeGreaterThan(0);
			});
		}
	});
});

describe("validateSceneCount", () => {
	it("returns valid for scene count within 2K limit", () => {
		const result = validateSceneCount(10, "2K");
		expect(result.isValid).toBe(true);
		expect(result.limit).toBe(12);
		expect(result.message).toBe("");
	});

	it("returns valid for scene count at exactly 2K limit", () => {
		const result = validateSceneCount(12, "2K");
		expect(result.isValid).toBe(true);
		expect(result.limit).toBe(12);
		expect(result.message).toBe("");
	});

	it("returns invalid for scene count exceeding 2K limit", () => {
		const result = validateSceneCount(13, "2K");
		expect(result.isValid).toBe(false);
		expect(result.limit).toBe(12);
		expect(result.message).toContain("2K");
		expect(result.message).toContain("12");
	});

	it("returns valid for scene count within 4K limit", () => {
		const result = validateSceneCount(30, "4K");
		expect(result.isValid).toBe(true);
		expect(result.limit).toBe(48);
		expect(result.message).toBe("");
	});

	it("returns valid for scene count at exactly 4K limit", () => {
		const result = validateSceneCount(48, "4K");
		expect(result.isValid).toBe(true);
		expect(result.limit).toBe(48);
	});

	it("returns invalid for scene count exceeding 4K limit", () => {
		const result = validateSceneCount(49, "4K");
		expect(result.isValid).toBe(false);
		expect(result.limit).toBe(48);
		expect(result.message).toContain("4K");
		expect(result.message).toContain("48");
	});

	it("returns valid for 0 scenes", () => {
		const result = validateSceneCount(0, "2K");
		expect(result.isValid).toBe(true);
	});

	it("returns valid for 1 scene", () => {
		const result = validateSceneCount(1, "4K");
		expect(result.isValid).toBe(true);
	});
});

describe("getRecommendedResolution", () => {
	it('returns "2K" for scene count within 2K limit', () => {
		expect(getRecommendedResolution(1)).toBe("2K");
		expect(getRecommendedResolution(6)).toBe("2K");
		expect(getRecommendedResolution(12)).toBe("2K");
	});

	it('returns "4K" for scene count exceeding 2K limit', () => {
		expect(getRecommendedResolution(13)).toBe("4K");
		expect(getRecommendedResolution(24)).toBe("4K");
		expect(getRecommendedResolution(48)).toBe("4K");
	});

	it('returns "2K" for 0 scenes (boundary)', () => {
		expect(getRecommendedResolution(0)).toBe("2K");
	});

	it("boundary: 12 scenes returns 2K, 13 scenes returns 4K", () => {
		expect(getRecommendedResolution(12)).toBe("2K");
		expect(getRecommendedResolution(13)).toBe("4K");
	});
});

// ============================================================
// prompt-builder.ts
// ============================================================

describe("buildStoryboardPrompt", () => {
	const baseConfig: StoryboardPromptConfig = {
		story: "A hero rescues a cat from a tree.",
		aspectRatio: "16:9",
		resolution: "2K",
		sceneCount: 4,
		styleTokens: ["anime", "vibrant"],
	};

	it("includes instruction block", () => {
		const prompt = buildStoryboardPrompt(baseConfig);
		expect(prompt).toContain("<instruction>");
		expect(prompt).toContain("</instruction>");
	});

	it("includes grid layout dimensions", () => {
		const prompt = buildStoryboardPrompt(baseConfig);
		// 4 scenes = 2x2 grid
		expect(prompt).toContain("2x2");
		expect(prompt).toContain("4 equal-sized panels");
	});

	it("includes aspect ratio", () => {
		const prompt = buildStoryboardPrompt(baseConfig);
		expect(prompt).toContain("16:9");
	});

	it("includes panel aspect ratio description for landscape", () => {
		const prompt = buildStoryboardPrompt(baseConfig);
		expect(prompt).toContain("16:9 (horizontal landscape)");
	});

	it("includes panel aspect ratio description for portrait", () => {
		const prompt = buildStoryboardPrompt({
			...baseConfig,
			aspectRatio: "9:16",
		});
		expect(prompt).toContain("9:16 (vertical portrait)");
	});

	it("includes story content", () => {
		const prompt = buildStoryboardPrompt(baseConfig);
		expect(prompt).toContain("<story_content>");
		expect(prompt).toContain("A hero rescues a cat from a tree.");
		expect(prompt).toContain("</story_content>");
	});

	it("includes style tokens", () => {
		const prompt = buildStoryboardPrompt(baseConfig);
		expect(prompt).toContain("Style: anime, vibrant");
	});

	it("omits style line when styleTokens is empty", () => {
		const prompt = buildStoryboardPrompt({
			...baseConfig,
			styleTokens: [],
		});
		expect(prompt).not.toContain("Style:");
	});

	it("includes panel placeholders for each scene", () => {
		const prompt = buildStoryboardPrompt(baseConfig);
		expect(prompt).toContain("Panel [row 1, col 1]: Scene 1 from story");
		expect(prompt).toContain("Panel [row 1, col 2]: Scene 2 from story");
		expect(prompt).toContain("Panel [row 2, col 1]: Scene 3 from story");
		expect(prompt).toContain("Panel [row 2, col 2]: Scene 4 from story");
	});

	it("includes negative constraints", () => {
		const prompt = buildStoryboardPrompt(baseConfig);
		expect(prompt).toContain("Negative constraints:");
		expect(prompt).toContain("watermark");
	});

	it("includes character descriptions when provided", () => {
		const prompt = buildStoryboardPrompt({
			...baseConfig,
			characters: [
				{ name: "Hero", visualTraits: "tall, muscular, blue cape" },
				{ name: "Villain", visualTraits: "dark armor, red eyes" },
			],
		});
		expect(prompt).toContain("<characters>");
		expect(prompt).toContain("Hero: tall, muscular, blue cape");
		expect(prompt).toContain("Villain: dark armor, red eyes");
		expect(prompt).toContain("</characters>");
	});

	it("omits character block when no characters provided", () => {
		const prompt = buildStoryboardPrompt(baseConfig);
		expect(prompt).not.toContain("<characters>");
	});

	it("omits character block when characters array is empty", () => {
		const prompt = buildStoryboardPrompt({
			...baseConfig,
			characters: [],
		});
		expect(prompt).not.toContain("<characters>");
	});

	it("uses fallback trait text for character with empty visualTraits", () => {
		const prompt = buildStoryboardPrompt({
			...baseConfig,
			characters: [{ name: "Mysterious", visualTraits: "" }],
		});
		expect(prompt).toContain("Mysterious: design based on name");
	});

	it("produces correct layout info for different scene counts", () => {
		const prompt9 = buildStoryboardPrompt({
			...baseConfig,
			sceneCount: 9,
		});
		// 9 scenes = 3x3
		expect(prompt9).toContain("3x3");
		expect(prompt9).toContain("9 equal-sized panels");
	});

	it("includes empty placeholder cells when grid has empty cells", () => {
		// 5 scenes with dynamic layout will have some empty cells
		const prompt = buildStoryboardPrompt({
			...baseConfig,
			sceneCount: 5,
		});
		// Scene 5 should be present
		expect(prompt).toContain("Scene 5 from story");
	});
});

describe("buildRegenerationPrompt", () => {
	it("produces the same output as buildStoryboardPrompt", () => {
		const config: StoryboardPromptConfig = {
			story: "A cat explores the city.",
			aspectRatio: "16:9",
			resolution: "2K",
			sceneCount: 4,
			styleTokens: ["watercolor"],
		};
		const storyboardPrompt = buildStoryboardPrompt(config);
		const regenPrompt = buildRegenerationPrompt(config);
		expect(regenPrompt).toBe(storyboardPrompt);
	});

	it("includes all expected sections", () => {
		const prompt = buildRegenerationPrompt({
			story: "Night in Tokyo.",
			aspectRatio: "9:16",
			resolution: "4K",
			sceneCount: 6,
			styleTokens: ["cyberpunk", "neon"],
			characters: [{ name: "Akira", visualTraits: "short hair, jacket" }],
		});
		expect(prompt).toContain("<instruction>");
		expect(prompt).toContain("<story_content>");
		expect(prompt).toContain("<characters>");
		expect(prompt).toContain("Akira: short hair, jacket");
		expect(prompt).toContain("Style: cyberpunk, neon");
	});
});

describe("getDefaultNegativePrompt", () => {
	it("returns a non-empty string", () => {
		const result = getDefaultNegativePrompt();
		expect(result).toBeTruthy();
		expect(result.length).toBeGreaterThan(0);
	});

	it("contains key negative terms", () => {
		const result = getDefaultNegativePrompt();
		expect(result).toContain("watermark");
		expect(result).toContain("blurry");
		expect(result).toContain("low quality");
		expect(result).toContain("text");
	});

	it("mentions border-related constraints", () => {
		const result = getDefaultNegativePrompt();
		expect(result).toContain("white borders");
		expect(result).toContain("black borders");
	});
});

describe("getStyleTokensFromPreset", () => {
	it('returns correct tokens for "ghibli" preset', () => {
		const tokens = getStyleTokensFromPreset("ghibli");
		expect(tokens).toContain("Studio Ghibli style");
		expect(tokens).toContain("anime");
		expect(tokens.length).toBeGreaterThan(0);
	});

	it('returns correct tokens for "cyberpunk" preset', () => {
		const tokens = getStyleTokensFromPreset("cyberpunk");
		expect(tokens).toContain("cyberpunk");
		expect(tokens).toContain("neon lights");
	});

	it('returns correct tokens for "realistic" preset', () => {
		const tokens = getStyleTokensFromPreset("realistic");
		expect(tokens).toContain("realistic");
		expect(tokens).toContain("photorealistic");
	});

	it('returns correct tokens for "idealized_realism" preset', () => {
		const tokens = getStyleTokensFromPreset("idealized_realism");
		expect(tokens).toContain("idealized realism");
		expect(tokens).toContain("Unreal Engine 5 render quality");
	});

	it("falls back to ghibli tokens for unknown preset", () => {
		const tokens = getStyleTokensFromPreset("nonexistent_style");
		const ghibliTokens = getStyleTokensFromPreset("ghibli");
		expect(tokens).toEqual(ghibliTokens);
	});

	it("falls back to ghibli tokens for empty string", () => {
		const tokens = getStyleTokensFromPreset("");
		const ghibliTokens = getStyleTokensFromPreset("ghibli");
		expect(tokens).toEqual(ghibliTokens);
	});

	it("returns array for each known preset", () => {
		const presetIds = [
			"ghibli",
			"miyazaki",
			"disney",
			"pixar",
			"cyberpunk",
			"watercolor",
			"realistic",
			"anime",
			"idealized_realism",
		];
		for (const id of presetIds) {
			const tokens = getStyleTokensFromPreset(id);
			expect(Array.isArray(tokens)).toBe(true);
			expect(tokens.length).toBeGreaterThan(0);
		}
	});
});

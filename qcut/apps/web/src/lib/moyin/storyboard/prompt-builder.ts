/**
 * Prompt Builder for Storyboard
 *
 * Generates the prompt for image generation API to create a storyboard grid.
 * Uses the same structured format as Merged Generation for consistency.
 */

import {
	type AspectRatio,
	type Resolution,
	calculateGrid,
} from "./grid-calculator";

export interface CharacterInfo {
	name: string;
	visualTraits: string;
}

export interface StoryboardPromptConfig {
	story: string;
	aspectRatio: AspectRatio;
	resolution: Resolution;
	sceneCount: number;
	styleTokens: string[];
	characters?: CharacterInfo[];
}

/**
 * Build the storyboard prompt for image generation.
 * Uses structured format identical to Merged Generation.
 */
export function buildStoryboardPrompt(config: StoryboardPromptConfig): string {
	const {
		story,
		aspectRatio,
		resolution,
		sceneCount,
		styleTokens,
		characters,
	} = config;

	// Calculate grid layout
	const grid = calculateGrid({ sceneCount, aspectRatio, resolution });
	const { cols, rows, totalCells, emptyCells } = grid;

	// Build prompt parts (same structure as Merged Generation)
	const promptParts: string[] = [];

	// 1. Core instruction block
	promptParts.push("<instruction>");
	promptParts.push(
		`Generate a clean ${rows}x${cols} storyboard grid with exactly ${totalCells} equal-sized panels.`
	);
	promptParts.push(`Overall Image Aspect Ratio: ${aspectRatio}.`);

	// Explicitly specify panel aspect ratio to prevent AI confusion
	const panelAspect =
		aspectRatio === "16:9"
			? "16:9 (horizontal landscape)"
			: "9:16 (vertical portrait)";
	promptParts.push(
		`Each individual panel must have a ${panelAspect} aspect ratio.`
	);

	promptParts.push(
		"Structure: No borders between panels, no text, no watermarks, no speech bubbles."
	);
	promptParts.push(
		"Consistency: Maintain consistent character appearance, lighting, and color grading across all panels."
	);
	promptParts.push("</instruction>");

	// 2. Layout description
	promptParts.push(
		`Layout: ${rows} rows, ${cols} columns, reading order left-to-right, top-to-bottom.`
	);

	// 3. Story content for panel descriptions
	promptParts.push("<story_content>");
	promptParts.push(story);
	promptParts.push("</story_content>");

	// 4. Character descriptions (if provided)
	if (characters && characters.length > 0) {
		promptParts.push("<characters>");
		for (const c of characters) {
			promptParts.push(
				`${c.name}: ${c.visualTraits || "design based on name"}`
			);
		}
		promptParts.push("</characters>");
	}

	// 5. Panel placeholders for narrative progression
	for (let idx = 0; idx < sceneCount; idx++) {
		const row = Math.floor(idx / cols) + 1;
		const col = (idx % cols) + 1;
		promptParts.push(
			`Panel [row ${row}, col ${col}]: Scene ${idx + 1} from story`
		);
	}

	// 6. Empty placeholder cells
	if (emptyCells > 0) {
		for (let i = sceneCount; i < totalCells; i++) {
			const row = Math.floor(i / cols) + 1;
			const col = (i % cols) + 1;
			promptParts.push(
				`Panel [row ${row}, col ${col}]: empty placeholder, solid gray background`
			);
		}
	}

	// 7. Global style
	if (styleTokens.length > 0) {
		promptParts.push(`Style: ${styleTokens.join(", ")}`);
	}

	// 8. Negative constraints
	promptParts.push(
		"Negative constraints: text, watermark, split screen borders, speech bubbles, blur, distortion, bad anatomy."
	);

	// Join with newlines for clearer structure
	return promptParts.join("\n");
}

/**
 * Build a simplified prompt for regeneration (keeps core elements)
 */
export function buildRegenerationPrompt(
	config: StoryboardPromptConfig
): string {
	// Same as main prompt for now, but could be simplified in the future
	return buildStoryboardPrompt(config);
}

/**
 * Extract style tokens from style preset ID
 */
export function getStyleTokensFromPreset(styleId: string): string[] {
	const STYLE_PRESETS: Record<string, string[]> = {
		ghibli: [
			"Studio Ghibli style",
			"anime",
			"soft colors",
			"hand-drawn",
			"whimsical",
		],
		miyazaki: [
			"Miyazaki style",
			"detailed backgrounds",
			"fantasy",
			"nature elements",
			"dreamlike",
		],
		disney: [
			"Disney animation style",
			"3D render",
			"vibrant colors",
			"expressive characters",
		],
		pixar: [
			"Pixar style",
			"3D animation",
			"detailed textures",
			"cinematic lighting",
		],
		cyberpunk: [
			"cyberpunk",
			"neon lights",
			"futuristic",
			"dark atmosphere",
			"high tech",
		],
		watercolor: [
			"watercolor painting",
			"soft edges",
			"artistic",
			"pastel colors",
			"fluid",
		],
		realistic: [
			"realistic",
			"photorealistic",
			"detailed",
			"lifelike",
			"high definition",
		],
		anime: [
			"anime style",
			"manga art",
			"2D animation",
			"cel shaded",
			"vibrant",
		],
		idealized_realism: [
			"idealized realism",
			"semi-realistic 2.5D illustration",
			"Unreal Engine 5 render quality",
			"volumetric lighting",
			"detailed material textures (metal, fabric, fire)",
			"cinematic atmosphere",
			"highly detailed",
			"between 2D and 3D",
		],
	};

	return STYLE_PRESETS[styleId] || STYLE_PRESETS.ghibli;
}

/**
 * Get default negative prompt for storyboard generation
 */
export function getDefaultNegativePrompt(): string {
	return "white borders, black borders, thick frames, wide gaps, padding, margins, white background, blurry, low quality, watermark, any text, captions, subtitles, labels, numbers, timestamps/timecodes, inconsistent style between frames, broken grid layout, misaligned frames, merged frames, continuous image, full page image";
}

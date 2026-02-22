/**
 * Moyin generation helpers — storyboard generation, split-and-apply, stage analysis.
 * Extracted from moyin-store.ts to keep it under 800 lines.
 */

import type { ScriptCharacter, ScriptScene, ScriptData, Shot } from "@/types/moyin-script";
import { buildStoryboardPrompt } from "@/lib/moyin/storyboard/prompt-builder";
import { calculateGrid } from "@/lib/moyin/storyboard/grid-calculator";
import { VISUAL_STYLE_PRESETS } from "@/lib/moyin/presets/visual-styles";
import { generateFalImage } from "./moyin-shot-generation";

// ==================== Types ====================

interface StoryboardResult {
	imageUrl: string;
	gridConfig: {
		cols: number;
		rows: number;
		cellWidth: number;
		cellHeight: number;
	};
}

interface SplitAndApplyResult {
	shots: Shot[];
}

// ==================== Storyboard Generation ====================

export async function generateStoryboardAction(
	scenes: ScriptScene[],
	characters: ScriptCharacter[],
	selectedStyleId: string,
	scriptData: ScriptData | null,
	onProgress: (progress: number) => void,
): Promise<StoryboardResult> {
	onProgress(10);

	const stylePreset = VISUAL_STYLE_PRESETS.find((s) => s.id === selectedStyleId);
	const styleTokens = stylePreset
		? [stylePreset.prompt]
		: ["Studio Ghibli style, anime, soft colors"];

	const storySummary = scenes
		.map(
			(s, i) =>
				`Scene ${i + 1}: ${s.visualPrompt || s.atmosphere || s.name || s.location || ""}`,
		)
		.join("\n");

	const title = scriptData?.title || "";
	const storyPrompt = title ? `${title}\n\n${storySummary}` : storySummary;

	const characterDescriptions = characters
		.filter((c) => c.visualPromptEn || c.appearance)
		.map((c) => c.visualPromptEn || c.appearance || "");

	const aspectRatio = "16:9" as const;
	const resolution = "2K" as const;

	const gridConfig = calculateGrid({
		sceneCount: scenes.length,
		aspectRatio,
		resolution,
	});

	const prompt = buildStoryboardPrompt({
		story: storyPrompt,
		sceneCount: scenes.length,
		aspectRatio,
		resolution,
		styleTokens,
		characters:
			characterDescriptions.length > 0
				? characterDescriptions.map((desc, i) => ({
						name: characters[i]?.name || `Character ${i + 1}`,
						visualTraits: desc,
					}))
				: undefined,
	});

	onProgress(20);

	const imageUrl = await generateFalImage(prompt, {
		width: gridConfig.canvasWidth,
		height: gridConfig.canvasHeight,
	});

	return {
		imageUrl,
		gridConfig: {
			cols: gridConfig.cols,
			rows: gridConfig.rows,
			cellWidth: gridConfig.cellWidth,
			cellHeight: gridConfig.cellHeight,
		},
	};
}

// ==================== Split & Apply ====================

export async function splitAndApplyAction(
	storyboardImageUrl: string,
	gridConfig: { cols: number; rows: number },
	scenes: ScriptScene[],
	shots: Shot[],
	scriptData: ScriptData | null,
): Promise<SplitAndApplyResult> {
	const { splitStoryboardImage } = await import(
		"@/lib/moyin/storyboard/image-splitter"
	);

	const results = await splitStoryboardImage(storyboardImageUrl, {
		aspectRatio: "16:9",
		resolution: "2K",
		sceneCount: scenes.length,
		options: {
			expectedCols: gridConfig.cols,
			expectedRows: gridConfig.rows,
		},
	});

	const updatedShots = [...shots];
	for (let i = 0; i < Math.min(results.length, updatedShots.length); i++) {
		updatedShots[i] = {
			...updatedShots[i],
			imageUrl: results[i].dataUrl,
			imageStatus: "completed",
		};
	}

	// Generate prompts for split scenes
	try {
		const { generateScenePrompts } = await import(
			"@/lib/moyin/storyboard/scene-prompt-generator"
		);
		const sceneInputs = updatedShots.map((shot, idx) => ({
			id: idx + 1,
			row: Math.floor(idx / gridConfig.cols),
			col: idx % gridConfig.cols,
			actionSummary: shot.actionSummary || "",
			cameraMovement: shot.cameraMovement || "",
			dialogue: shot.dialogue || "",
			sceneName: shot.shotLabel || `Shot ${idx + 1}`,
		}));

		const prompts = await generateScenePrompts({
			storyboardImage: storyboardImageUrl,
			storyPrompt: scriptData?.synopsis || "",
			scenes: sceneInputs,
			apiKey: "",
		});

		for (const p of prompts) {
			const idx = p.id - 1;
			if (idx >= 0 && idx < updatedShots.length) {
				updatedShots[idx] = {
					...updatedShots[idx],
					imagePrompt: p.imagePrompt || updatedShots[idx].imagePrompt,
					imagePromptZh: p.imagePromptZh || updatedShots[idx].imagePromptZh,
					videoPrompt: p.videoPrompt || updatedShots[idx].videoPrompt,
					videoPromptZh: p.videoPromptZh || updatedShots[idx].videoPromptZh,
					endFramePrompt: p.endFramePrompt || updatedShots[idx].endFramePrompt,
					endFramePromptZh: p.endFramePromptZh || updatedShots[idx].endFramePromptZh,
				};
			}
		}
	} catch {
		// Prompt generation is optional — don't fail the split
	}

	return { shots: updatedShots };
}

// ==================== Character Stage Analysis ====================

export async function analyzeStagesAction(
	characters: ScriptCharacter[],
	episodeCount: number,
	scriptData: ScriptData | null,
): Promise<ScriptCharacter[]> {
	const { detectMultiStageHints, analyzeCharacterStages, convertStagesToVariations } =
		await import("@/lib/moyin/script/character-stage-analyzer");

	const outline = scriptData?.synopsis || "";
	const hints = detectMultiStageHints(outline, episodeCount);
	if (!hints.suggestMultiStage) return characters;

	const background = {
		title: scriptData?.title || "",
		outline,
		characterBios: characters.map((c) => `${c.name}: ${c.role || ""}`).join("\n"),
		era: scriptData?.era || "现代",
		genre: scriptData?.genre || "",
	};

	const analyses = await analyzeCharacterStages(background, characters, episodeCount);

	return characters.map((c) => {
		const analysis = analyses.find((a) => a.characterName === c.name);
		if (!analysis?.needsMultiStage) return c;
		const newVariations = convertStagesToVariations(analysis).map((v, i) => ({
			...v,
			id: `${c.id}_stage_${i}`,
		}));
		if (newVariations.length === 0) return c;
		return {
			...c,
			variations: [...(c.variations || []), ...newVariations],
		};
	});
}

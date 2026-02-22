/**
 * Moyin generation helpers — storyboard generation, split-and-apply, stage analysis.
 * Extracted from moyin-store.ts to keep it under 800 lines.
 */

import type {
	ScriptCharacter,
	ScriptScene,
	ScriptData,
	Shot,
} from "@/types/moyin-script";
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
	onProgress: (progress: number) => void
): Promise<StoryboardResult> {
	onProgress(10);

	const stylePreset = VISUAL_STYLE_PRESETS.find(
		(s) => s.id === selectedStyleId
	);
	const styleTokens = stylePreset
		? [stylePreset.prompt]
		: ["Studio Ghibli style, anime, soft colors"];

	const storySummary = scenes
		.map(
			(s, i) =>
				`Scene ${i + 1}: ${s.visualPrompt || s.atmosphere || s.name || s.location || ""}`
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
	scriptData: ScriptData | null
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
			sceneName: shot.actionSummary || `Shot ${idx + 1}`,
		}));

		const prompts = await generateScenePrompts({
			storyboardImage: storyboardImageUrl,
			storyPrompt: scriptData?.logline || "",
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
					endFramePromptZh:
						p.endFramePromptZh || updatedShots[idx].endFramePromptZh,
				};
			}
		}
	} catch {
		// Prompt generation is optional — don't fail the split
	}

	return { shots: updatedShots };
}

// ==================== Shot Generation for Episode ====================

export async function generateShotsForEpisodeAction(
	episodeScenes: ScriptScene[],
	episodeTitle: string,
	scriptTitle: string
): Promise<Shot[]> {
	const api = window.electronAPI?.moyin;
	if (!api?.callLLM) {
		throw new Error("Moyin API not available.");
	}

	const sceneDescs = episodeScenes
		.map(
			(s, i) =>
				`Scene ${i + 1} (${s.id}): ${s.name || s.location}, ${s.time || ""}, ${s.atmosphere || ""}`
		)
		.join("\n");

	const result = await api.callLLM({
		systemPrompt: `You are a professional storyboard artist. Break each scene into 3-6 shots.

Return JSON array:
[{ "id": "shot_001", "sceneRefId": "scene_id", "index": 0, "actionSummary": "description", "shotSize": "MS/CU/WS/etc", "cameraMovement": "pan/tilt/static/etc", "characterIds": [], "characterVariations": {}, "imageStatus": "idle", "imageProgress": 0, "videoStatus": "idle", "videoProgress": 0 }]

Only return the JSON array.`,
		userPrompt: `Project: "${scriptTitle}", Episode: "${episodeTitle}"

Scenes:
${sceneDescs}

Generate shots for each scene with proper camera language and visual storytelling.`,
		temperature: 0.5,
		maxTokens: 8192,
	});

	if (!result.success || !result.text) {
		throw new Error(result.error || "Shot generation failed");
	}

	let cleaned = result.text
		.replace(/```json\n?/g, "")
		.replace(/```\n?/g, "")
		.trim();
	const jsonStart = cleaned.indexOf("[");
	const jsonEnd = cleaned.lastIndexOf("]");
	if (jsonStart !== -1 && jsonEnd !== -1) {
		cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
	}

	return JSON.parse(cleaned) as Shot[];
}

// ==================== Script Generation ====================

export async function generateScriptAction(
	idea: string,
	options: { genre?: string; targetDuration?: string },
	config: { sceneCount: string; shotCount: string; selectedStyleId: string }
): Promise<string> {
	const api = window.electronAPI?.moyin;
	if (!api?.callLLM) {
		throw new Error("Moyin API not available. Please run in Electron.");
	}

	const { generateScriptFromIdea } = await import(
		"@/lib/moyin/script/script-parser"
	);

	const llmAdapter = async (
		systemPrompt: string,
		userPrompt: string,
		opts?: { temperature?: number; maxTokens?: number }
	) => {
		const r = await api.callLLM({
			systemPrompt,
			userPrompt,
			temperature: opts?.temperature,
			maxTokens: opts?.maxTokens,
		});
		if (!r.success || !r.text) {
			throw new Error(r.error || "LLM call failed");
		}
		return r.text;
	};

	return generateScriptFromIdea(idea, llmAdapter, {
		targetDuration: options.targetDuration || "60s",
		sceneCount:
			config.sceneCount !== "auto" ? Number(config.sceneCount) : undefined,
		shotCount:
			config.shotCount !== "auto" ? Number(config.shotCount) : undefined,
		styleId: config.selectedStyleId,
	});
}

// ==================== Character Stage Analysis ====================

export async function analyzeStagesAction(
	characters: ScriptCharacter[],
	episodeCount: number,
	scriptData: ScriptData | null
): Promise<ScriptCharacter[]> {
	const {
		detectMultiStageHints,
		analyzeCharacterStages,
		convertStagesToVariations,
	} = await import("@/lib/moyin/script/character-stage-analyzer");

	const outline = scriptData?.logline || "";
	const hints = detectMultiStageHints(outline, episodeCount);
	if (!hints.suggestMultiStage) return characters;

	const background = {
		title: scriptData?.title || "",
		outline,
		characterBios: characters
			.map((c) => `${c.name}: ${c.role || ""}`)
			.join("\n"),
		era: "现代",
		genre: scriptData?.genre || "",
	};

	const analyses = await analyzeCharacterStages(
		background,
		characters,
		episodeCount
	);

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

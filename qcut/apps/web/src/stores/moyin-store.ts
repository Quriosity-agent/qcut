/**
 * Moyin Store — session-scoped state for the Moyin tab workflow.
 * Manages script parsing, character extraction, scene breakdown, and generation.
 */

import { create } from "zustand";
import type {
	ScriptCharacter,
	ScriptData,
	ScriptScene,
} from "@/types/moyin-script";
import { getFalApiKeyAsync } from "@/lib/ai-video/core/fal-request";
import { buildStoryboardPrompt } from "@/lib/moyin/storyboard/prompt-builder";
import { calculateGrid } from "@/lib/moyin/storyboard/grid-calculator";
import { VISUAL_STYLE_PRESETS } from "@/lib/moyin/presets/visual-styles";

// ==================== Types ====================

export type MoyinStep = "script" | "characters" | "scenes" | "generate";
export type ParseStatus = "idle" | "parsing" | "ready" | "error";
export type GenerationStatus = "idle" | "generating" | "done" | "error";
export type CalibrationStatus = "idle" | "calibrating" | "done" | "error";

interface MoyinState {
	// Workflow navigation
	activeStep: MoyinStep;

	// Script input & parsing
	rawScript: string;
	scriptData: ScriptData | null;
	parseStatus: ParseStatus;
	parseError: string | null;

	// Characters extracted from parsed script
	characters: ScriptCharacter[];

	// Scenes extracted from parsed script
	scenes: ScriptScene[];

	// Generation state
	generationStatus: GenerationStatus;
	generationProgress: number;
	generationError: string | null;

	// AI calibration state
	characterCalibrationStatus: CalibrationStatus;
	sceneCalibrationStatus: CalibrationStatus;
	calibrationError: string | null;

	// Style & cinematography selections
	selectedStyleId: string;
	selectedProfileId: string;

	// Storyboard result
	storyboardImageUrl: string | null;
	storyboardGridConfig: {
		cols: number;
		rows: number;
		cellWidth: number;
		cellHeight: number;
	} | null;
}

interface MoyinActions {
	setActiveStep: (step: MoyinStep) => void;

	// Script
	setRawScript: (text: string) => void;
	parseScript: () => Promise<void>;
	clearScript: () => void;

	// Characters
	updateCharacter: (id: string, updates: Partial<ScriptCharacter>) => void;
	addCharacter: (char: ScriptCharacter) => void;
	removeCharacter: (id: string) => void;

	// Scenes
	updateScene: (id: string, updates: Partial<ScriptScene>) => void;
	addScene: (scene: ScriptScene) => void;
	removeScene: (id: string) => void;

	// Style & profile
	setSelectedStyleId: (id: string) => void;
	setSelectedProfileId: (id: string) => void;

	// AI Calibration
	enhanceCharacters: () => Promise<void>;
	enhanceScenes: () => Promise<void>;

	// Generation
	generateStoryboard: () => Promise<void>;

	// Reset
	reset: () => void;
}

export type MoyinStore = MoyinState & MoyinActions;

// ==================== Initial State ====================

const initialState: MoyinState = {
	activeStep: "script",
	rawScript: "",
	scriptData: null,
	parseStatus: "idle",
	parseError: null,
	characters: [],
	scenes: [],
	generationStatus: "idle",
	generationProgress: 0,
	generationError: null,
	characterCalibrationStatus: "idle",
	sceneCalibrationStatus: "idle",
	calibrationError: null,
	selectedStyleId: "2d_ghibli",
	selectedProfileId: "classic-cinematic",
	storyboardImageUrl: null,
	storyboardGridConfig: null,
};

// ==================== Store ====================

export const useMoyinStore = create<MoyinStore>((set, get) => ({
	...initialState,

	setActiveStep: (step) => set({ activeStep: step }),

	setRawScript: (text) => set({ rawScript: text }),

	parseScript: async () => {
		const { rawScript } = get();
		if (!rawScript.trim()) return;

		set({ parseStatus: "parsing", parseError: null });

		try {
			const api = window.electronAPI?.moyin;
			if (!api) {
				throw new Error("Moyin API not available. Please run in Electron.");
			}

			const result = await api.parseScript({ rawScript });

			if (!result.success || !result.data) {
				throw new Error(result.error || "Failed to parse script");
			}

			const data = result.data as unknown as ScriptData;

			set({
				scriptData: data,
				characters: data.characters ?? [],
				scenes: data.scenes ?? [],
				parseStatus: "ready",
				activeStep: "characters",
			});
		} catch (error) {
			set({
				parseStatus: "error",
				parseError:
					error instanceof Error ? error.message : "Unknown parse error",
			});
		}
	},

	clearScript: () =>
		set({
			rawScript: "",
			scriptData: null,
			parseStatus: "idle",
			parseError: null,
			characters: [],
			scenes: [],
			generationStatus: "idle",
			generationProgress: 0,
			generationError: null,
			storyboardImageUrl: null,
			storyboardGridConfig: null,
			activeStep: "script",
		}),

	updateCharacter: (id, updates) =>
		set((state) => ({
			characters: state.characters.map((c) =>
				c.id === id ? { ...c, ...updates } : c
			),
		})),

	addCharacter: (char) =>
		set((state) => ({ characters: [...state.characters, char] })),

	removeCharacter: (id) =>
		set((state) => ({
			characters: state.characters.filter((c) => c.id !== id),
		})),

	updateScene: (id, updates) =>
		set((state) => ({
			scenes: state.scenes.map((s) => (s.id === id ? { ...s, ...updates } : s)),
		})),

	addScene: (scene) => set((state) => ({ scenes: [...state.scenes, scene] })),

	removeScene: (id) =>
		set((state) => ({ scenes: state.scenes.filter((s) => s.id !== id) })),

	setSelectedStyleId: (id) => set({ selectedStyleId: id }),

	setSelectedProfileId: (id) => set({ selectedProfileId: id }),

	enhanceCharacters: async () => {
		const { characters, scriptData } = get();
		if (characters.length === 0) return;

		set({ characterCalibrationStatus: "calibrating", calibrationError: null });

		try {
			const api = window.electronAPI?.moyin;
			if (!api?.callLLM) {
				throw new Error("Moyin API not available. Please run in Electron.");
			}

			const title =
				(scriptData as Record<string, unknown> | null)?.title || "Unknown";
			const genre =
				(scriptData as Record<string, unknown> | null)?.genre || "Drama";

			const charSummary = characters
				.map(
					(c) =>
						`- ${c.name}: ${c.role || "unknown role"}, ${c.gender || ""} ${c.age || ""}`
				)
				.join("\n");

			const result = await api.callLLM({
				systemPrompt: `You are a professional character designer. For each character, generate a detailed English visual description suitable for AI image generation.

Return JSON array:
[{ "id": "char_id", "visualPromptEn": "detailed English appearance description for AI image generation", "appearance": "concise appearance summary" }]

Only return the JSON array, no other text.`,
				userPrompt: `Project: "${title}" (${genre})

Characters:
${charSummary}

Generate visual prompts for each character. Include: face shape, hair style/color, eye details, build, clothing style, distinguishing features.`,
				temperature: 0.5,
				maxTokens: 4096,
			});

			if (!result.success || !result.text) {
				throw new Error(result.error || "AI enhancement failed");
			}

			// Parse enhanced data
			let cleaned = result.text
				.replace(/```json\n?/g, "")
				.replace(/```\n?/g, "")
				.trim();
			const jsonStart = cleaned.indexOf("[");
			const jsonEnd = cleaned.lastIndexOf("]");
			if (jsonStart !== -1 && jsonEnd !== -1) {
				cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
			}

			const enhanced = JSON.parse(cleaned) as Array<{
				id: string;
				visualPromptEn?: string;
				appearance?: string;
			}>;

			// Merge enhanced data into characters
			const enhancedMap = new Map(enhanced.map((e) => [e.id, e]));
			set((state) => ({
				characters: state.characters.map((c) => {
					const e = enhancedMap.get(c.id);
					if (!e) return c;
					return {
						...c,
						visualPromptEn: e.visualPromptEn || c.visualPromptEn,
						appearance: e.appearance || c.appearance,
					};
				}),
				characterCalibrationStatus: "done",
			}));
		} catch (error) {
			set({
				characterCalibrationStatus: "error",
				calibrationError:
					error instanceof Error ? error.message : "Enhancement failed",
			});
		}
	},

	enhanceScenes: async () => {
		const { scenes, scriptData } = get();
		if (scenes.length === 0) return;

		set({ sceneCalibrationStatus: "calibrating", calibrationError: null });

		try {
			const api = window.electronAPI?.moyin;
			if (!api?.callLLM) {
				throw new Error("Moyin API not available. Please run in Electron.");
			}

			const title =
				(scriptData as Record<string, unknown> | null)?.title || "Unknown";
			const genre =
				(scriptData as Record<string, unknown> | null)?.genre || "Drama";

			const sceneSummary = scenes
				.map(
					(s) =>
						`- ${s.name || s.location}: ${s.time || ""}, ${s.atmosphere || ""}`
				)
				.join("\n");

			const result = await api.callLLM({
				systemPrompt: `You are a professional art director. For each scene, generate a detailed English visual description suitable for AI concept art generation.

Return JSON array:
[{ "id": "scene_id", "visualPrompt": "detailed English scene description for AI image generation", "lightingDesign": "lighting description" }]

Only return the JSON array, no other text.`,
				userPrompt: `Project: "${title}" (${genre})

Scenes:
${sceneSummary}

Generate visual prompts for each scene. Include: architecture style, lighting conditions, weather, color palette, atmosphere, key props, camera perspective.`,
				temperature: 0.5,
				maxTokens: 4096,
			});

			if (!result.success || !result.text) {
				throw new Error(result.error || "AI enhancement failed");
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

			const enhanced = JSON.parse(cleaned) as Array<{
				id: string;
				visualPrompt?: string;
				lightingDesign?: string;
			}>;

			const enhancedMap = new Map(enhanced.map((e) => [e.id, e]));
			set((state) => ({
				scenes: state.scenes.map((s) => {
					const e = enhancedMap.get(s.id);
					if (!e) return s;
					return {
						...s,
						visualPrompt: e.visualPrompt || s.visualPrompt,
						lightingDesign: e.lightingDesign || s.lightingDesign,
					};
				}),
				sceneCalibrationStatus: "done",
			}));
		} catch (error) {
			set({
				sceneCalibrationStatus: "error",
				calibrationError:
					error instanceof Error ? error.message : "Enhancement failed",
			});
		}
	},

	generateStoryboard: async () => {
		const { scenes, characters, selectedStyleId, scriptData } = get();
		if (scenes.length === 0) return;

		set({
			generationStatus: "generating",
			generationProgress: 0,
			generationError: null,
			storyboardImageUrl: null,
			storyboardGridConfig: null,
		});

		try {
			// Get API key
			const apiKey = await getFalApiKeyAsync();
			if (!apiKey) {
				throw new Error(
					"FAL API key not configured. Please set it in Settings."
				);
			}

			set({ generationProgress: 10 });

			// Build storyboard prompt from scenes and style
			const stylePreset = VISUAL_STYLE_PRESETS.find(
				(s) => s.id === selectedStyleId
			);
			const styleTokens = stylePreset
				? [stylePreset.prompt]
				: ["Studio Ghibli style, anime, soft colors"];

			// Build a story summary from scene visual prompts
			const storySummary = scenes
				.map(
					(s, i) =>
						`Scene ${i + 1}: ${s.visualPrompt || s.atmosphere || s.name || s.location || ""}`
				)
				.join("\n");

			const title = (scriptData as Record<string, unknown> | null)?.title || "";
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

			set({ generationProgress: 20 });

			// Call fal.ai image generation directly
			const falEndpoint = "fal-ai/flux-pro/v1.1-ultra";
			const response = await fetch(`https://fal.run/${falEndpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Key ${apiKey}`,
				},
				body: JSON.stringify({
					prompt,
					num_images: 1,
					image_size: {
						width: gridConfig.canvasWidth,
						height: gridConfig.canvasHeight,
					},
					safety_tolerance: "6",
				}),
			});

			set({ generationProgress: 60 });

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				const detail =
					(errorData as Record<string, unknown>).detail ||
					(errorData as Record<string, unknown>).error ||
					response.statusText;
				throw new Error(`Image generation failed: ${detail}`);
			}

			const data = (await response.json()) as {
				images?: Array<{ url: string }>;
			};
			const imageUrl = data.images?.[0]?.url;
			if (!imageUrl) {
				throw new Error("No image returned from generation API");
			}

			set({
				generationStatus: "done",
				generationProgress: 100,
				storyboardImageUrl: imageUrl,
				storyboardGridConfig: {
					cols: gridConfig.cols,
					rows: gridConfig.rows,
					cellWidth: gridConfig.cellWidth,
					cellHeight: gridConfig.cellHeight,
				},
			});
		} catch (error) {
			set({
				generationStatus: "error",
				generationError:
					error instanceof Error ? error.message : "Unknown generation error",
			});
		}
	},

	reset: () => set(initialState),
}));

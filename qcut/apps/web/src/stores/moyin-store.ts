/**
 * Moyin Store — session-scoped state for the Moyin tab workflow.
 * Manages script parsing, character extraction, scene breakdown, and generation.
 */

import { create } from "zustand";
import type {
	Episode,
	ScriptCharacter,
	ScriptData,
	ScriptScene,
	Shot,
} from "@/types/moyin-script";
import { buildStoryboardPrompt } from "@/lib/moyin/storyboard/prompt-builder";
import { calculateGrid } from "@/lib/moyin/storyboard/grid-calculator";
import { VISUAL_STYLE_PRESETS } from "@/lib/moyin/presets/visual-styles";
import {
	buildShotImagePrompt,
	generateFalImage,
	generateShotImageRequest,
	generateShotVideoRequest,
} from "./moyin-shot-generation";

// ==================== Types ====================

export type MoyinStep = "script" | "characters" | "scenes" | "generate";
export type ParseStatus = "idle" | "parsing" | "ready" | "error";
export type GenerationStatus = "idle" | "generating" | "done" | "error";
export type CalibrationStatus = "idle" | "calibrating" | "done" | "error";
export type PipelineStep =
	| "import"
	| "title_calibration"
	| "synopsis"
	| "shot_calibration"
	| "character_calibration"
	| "scene_calibration";
export type PipelineStepStatus = "pending" | "active" | "done" | "error";

interface MoyinState {
	// Workflow navigation
	activeStep: MoyinStep;

	// Script input & parsing
	rawScript: string;
	scriptData: ScriptData | null;
	parseStatus: ParseStatus;
	parseError: string | null;

	// Script config
	language: string;
	sceneCount: string;
	shotCount: string;

	// API key status
	chatConfigured: boolean;

	// Characters extracted from parsed script
	characters: ScriptCharacter[];

	// Scenes extracted from parsed script
	scenes: ScriptScene[];

	// Shots broken down from scenes
	shots: Shot[];
	shotGenerationStatus: Record<string, GenerationStatus>;

	// Episodes
	episodes: Episode[];

	// Structure panel selection
	selectedItemId: string | null;
	selectedItemType: "episode" | "scene" | "character" | "shot" | null;

	// Import pipeline
	pipelineStep: PipelineStep | null;
	pipelineProgress: Record<PipelineStep, PipelineStepStatus>;

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

	// Script config
	setLanguage: (lang: string) => void;
	setSceneCount: (count: string) => void;
	setShotCount: (count: string) => void;

	// API key status
	checkApiKeyStatus: () => Promise<void>;

	// Characters
	updateCharacter: (id: string, updates: Partial<ScriptCharacter>) => void;
	addCharacter: (char: ScriptCharacter) => void;
	removeCharacter: (id: string) => void;

	// Scenes
	updateScene: (id: string, updates: Partial<ScriptScene>) => void;
	addScene: (scene: ScriptScene) => void;
	removeScene: (id: string) => void;

	// Shots
	addShot: (shot: Shot) => void;
	updateShot: (id: string, updates: Partial<Shot>) => void;
	removeShot: (id: string) => void;
	generateShotsForEpisode: (episodeId: string) => Promise<void>;
	generateShotImage: (shotId: string) => Promise<void>;
	generateShotVideo: (shotId: string) => Promise<void>;

	// Episodes
	addEpisode: (ep: Episode) => void;
	updateEpisode: (id: string, updates: Partial<Episode>) => void;
	removeEpisode: (id: string) => void;

	// Structure panel selection
	setSelectedItem: (
		id: string | null,
		type: "episode" | "scene" | "character" | "shot" | null
	) => void;

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
	language: "English",
	sceneCount: "auto",
	shotCount: "auto",
	chatConfigured: false,
	characters: [],
	scenes: [],
	shots: [],
	shotGenerationStatus: {},
	episodes: [],
	selectedItemId: null,
	selectedItemType: null,
	pipelineStep: null,
	pipelineProgress: {
		import: "pending",
		title_calibration: "pending",
		synopsis: "pending",
		shot_calibration: "pending",
		character_calibration: "pending",
		scene_calibration: "pending",
	},
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

	setLanguage: (lang) => set({ language: lang }),
	setSceneCount: (count) => set({ sceneCount: count }),
	setShotCount: (count) => set({ shotCount: count }),

	checkApiKeyStatus: async () => {
		try {
			const status = await window.electronAPI?.apiKeys?.status();
			if (!status) {
				set({ chatConfigured: false });
				return;
			}
			const configured =
				status.openRouterApiKey?.set ||
				status.geminiApiKey?.set ||
				status.anthropicApiKey?.set ||
				false;
			set({ chatConfigured: configured });
		} catch {
			set({ chatConfigured: false });
		}
	},

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
				episodes: data.episodes ?? [],
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
			shots: [],
			shotGenerationStatus: {},
			episodes: [],
			selectedItemId: null,
			selectedItemType: null,
			pipelineStep: null,
			pipelineProgress: initialState.pipelineProgress,
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

	addShot: (shot) => set((state) => ({ shots: [...state.shots, shot] })),

	updateShot: (id, updates) =>
		set((state) => ({
			shots: state.shots.map((s) => (s.id === id ? { ...s, ...updates } : s)),
		})),

	removeShot: (id) =>
		set((state) => ({ shots: state.shots.filter((s) => s.id !== id) })),

	generateShotsForEpisode: async (episodeId) => {
		const { episodes, scenes, scriptData } = get();
		const episode = episodes.find((ep) => ep.id === episodeId);
		if (!episode) return;

		set((state) => ({
			shotGenerationStatus: {
				...state.shotGenerationStatus,
				[episodeId]: "generating",
			},
		}));

		try {
			const api = window.electronAPI?.moyin;
			if (!api?.callLLM) {
				throw new Error("Moyin API not available.");
			}

			const episodeScenes = scenes.filter((s) =>
				episode.sceneIds.includes(s.id)
			);
			const sceneDescs = episodeScenes
				.map(
					(s, i) =>
						`Scene ${i + 1} (${s.id}): ${s.name || s.location}, ${s.time || ""}, ${s.atmosphere || ""}`
				)
				.join("\n");

			const title = scriptData?.title || "Unknown";

			const result = await api.callLLM({
				systemPrompt: `You are a professional storyboard artist. Break each scene into 3-6 shots.

Return JSON array:
[{ "id": "shot_001", "sceneRefId": "scene_id", "index": 0, "actionSummary": "description", "shotSize": "MS/CU/WS/etc", "cameraMovement": "pan/tilt/static/etc", "characterIds": [], "characterVariations": {}, "imageStatus": "idle", "imageProgress": 0, "videoStatus": "idle", "videoProgress": 0 }]

Only return the JSON array.`,
				userPrompt: `Project: "${title}", Episode: "${episode.title}"

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

			const newShots = JSON.parse(cleaned) as Shot[];

			set((state) => ({
				shots: [
					...state.shots.filter(
						(s) => !episodeScenes.some((es) => es.id === s.sceneRefId)
					),
					...newShots,
				],
				shotGenerationStatus: {
					...state.shotGenerationStatus,
					[episodeId]: "done",
				},
			}));
		} catch (error) {
			set((state) => ({
				shotGenerationStatus: {
					...state.shotGenerationStatus,
					[episodeId]: "error",
				},
				calibrationError:
					error instanceof Error ? error.message : "Shot generation failed",
			}));
		}
	},

	generateShotImage: async (shotId) => {
		const { shots, characters, scenes, selectedStyleId } = get();
		const shot = shots.find((s) => s.id === shotId);
		if (!shot) return;

		set((state) => ({
			shots: state.shots.map((s) =>
				s.id === shotId
					? {
							...s,
							imageStatus: "generating",
							imageProgress: 0,
							imageError: undefined,
						}
					: s
			),
		}));

		try {
			const scene = scenes.find((s) => s.id === shot.sceneRefId);
			const prompt = buildShotImagePrompt(
				shot,
				scene,
				characters,
				selectedStyleId
			);

			set((state) => ({
				shots: state.shots.map((s) =>
					s.id === shotId ? { ...s, imageProgress: 30 } : s
				),
			}));

			const imageUrl = await generateShotImageRequest(prompt);

			set((state) => ({
				shots: state.shots.map((s) =>
					s.id === shotId
						? { ...s, imageStatus: "completed", imageProgress: 100, imageUrl }
						: s
				),
			}));
		} catch (error) {
			set((state) => ({
				shots: state.shots.map((s) =>
					s.id === shotId
						? {
								...s,
								imageStatus: "failed",
								imageError:
									error instanceof Error
										? error.message
										: "Image generation failed",
							}
						: s
				),
			}));
		}
	},

	generateShotVideo: async (shotId) => {
		const { shots } = get();
		const shot = shots.find((s) => s.id === shotId);
		if (!shot) return;

		set((state) => ({
			shots: state.shots.map((s) =>
				s.id === shotId
					? {
							...s,
							videoStatus: "generating",
							videoProgress: 0,
							videoError: undefined,
						}
					: s
			),
		}));

		try {
			if (!shot.imageUrl) {
				throw new Error("Generate an image first before creating video.");
			}

			const prompt = shot.videoPrompt || shot.actionSummary || "";

			set((state) => ({
				shots: state.shots.map((s) =>
					s.id === shotId ? { ...s, videoProgress: 20 } : s
				),
			}));

			const videoUrl = await generateShotVideoRequest(shot.imageUrl, prompt);

			set((state) => ({
				shots: state.shots.map((s) =>
					s.id === shotId
						? { ...s, videoStatus: "completed", videoProgress: 100, videoUrl }
						: s
				),
			}));
		} catch (error) {
			set((state) => ({
				shots: state.shots.map((s) =>
					s.id === shotId
						? {
								...s,
								videoStatus: "failed",
								videoError:
									error instanceof Error
										? error.message
										: "Video generation failed",
							}
						: s
				),
			}));
		}
	},

	addEpisode: (ep) => set((state) => ({ episodes: [...state.episodes, ep] })),

	updateEpisode: (id, updates) =>
		set((state) => ({
			episodes: state.episodes.map((ep) =>
				ep.id === id ? { ...ep, ...updates } : ep
			),
		})),

	removeEpisode: (id) =>
		set((state) => ({
			episodes: state.episodes.filter((ep) => ep.id !== id),
		})),

	setSelectedItem: (id, type) =>
		set({ selectedItemId: id, selectedItemType: type }),

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

			const title = scriptData?.title || "Unknown";
			const genre = scriptData?.genre || "Drama";

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

			const title = scriptData?.title || "Unknown";
			const genre = scriptData?.genre || "Drama";

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
			set({ generationProgress: 10 });

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

			set({ generationProgress: 20 });

			const imageUrl = await generateFalImage(prompt, {
				width: gridConfig.canvasWidth,
				height: gridConfig.canvasHeight,
			});

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

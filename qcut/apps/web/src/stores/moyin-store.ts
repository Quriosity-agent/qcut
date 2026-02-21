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

// ==================== Types ====================

export type MoyinStep = "script" | "characters" | "scenes" | "generate";
export type ParseStatus = "idle" | "parsing" | "ready" | "error";
export type GenerationStatus = "idle" | "generating" | "done" | "error";

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

	// Style & cinematography selections
	selectedStyleId: string;
	selectedProfileId: string;
}

interface MoyinActions {
	setActiveStep: (step: MoyinStep) => void;

	// Script
	setRawScript: (text: string) => void;
	parseScript: () => Promise<void>;
	clearScript: () => void;

	// Characters
	updateCharacter: (id: string, updates: Partial<ScriptCharacter>) => void;

	// Scenes
	updateScene: (id: string, updates: Partial<ScriptScene>) => void;

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
	selectedStyleId: "2d_ghibli",
	selectedProfileId: "classic-cinematic",
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
			activeStep: "script",
		}),

	updateCharacter: (id, updates) =>
		set((state) => ({
			characters: state.characters.map((c) =>
				c.id === id ? { ...c, ...updates } : c
			),
		})),

	updateScene: (id, updates) =>
		set((state) => ({
			scenes: state.scenes.map((s) => (s.id === id ? { ...s, ...updates } : s)),
		})),

	generateStoryboard: async () => {
		const { scenes, selectedStyleId } = get();
		if (scenes.length === 0) return;

		set({
			generationStatus: "generating",
			generationProgress: 0,
			generationError: null,
		});

		try {
			const api = window.electronAPI?.moyin;
			if (!api) {
				throw new Error("Moyin API not available. Please run in Electron.");
			}

			const result = await api.generateStoryboard({
				scenes,
				styleId: selectedStyleId,
			});

			if (!result.success) {
				throw new Error(result.error || "Failed to generate storyboard");
			}

			set({
				generationStatus: "done",
				generationProgress: 100,
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

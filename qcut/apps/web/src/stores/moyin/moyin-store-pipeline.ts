/**
 * Moyin Store — Pipeline Actions
 * parseScript, generateScript, enhance, analyze, storyboard actions.
 * Extracted from moyin-store.ts to keep files under 800 lines.
 */

import type {
	ScriptCharacter,
	ScriptData,
	ScriptScene,
	Shot,
} from "@/types/moyin-script";
import {
	calibrateTitleLLM,
	generateSynopsisLLM,
	enhanceCharactersLLM,
	enhanceScenesLLM,
} from "./moyin-calibration";
import {
	generateStoryboardAction,
	splitAndApplyAction,
	analyzeStagesAction,
	generateShotsForEpisodeAction,
	generateScriptAction,
} from "./moyin-generation";
import type {
	PipelineStep,
	PipelineStepStatus,
	MoyinStore,
} from "./moyin-store";

type SetFn = (
	partial: Partial<MoyinStore> | ((state: MoyinStore) => Partial<MoyinStore>)
) => void;
type GetFn = () => MoyinStore;

const initialPipelineProgress: Record<PipelineStep, PipelineStepStatus> = {
	import: "pending",
	title_calibration: "pending",
	synopsis: "pending",
	shot_calibration: "pending",
	character_calibration: "pending",
	scene_calibration: "pending",
};

export function createPipelineActions(set: SetFn, get: GetFn) {
	return {
		parseScript: async () => {
			const { rawScript } = get();
			if (!rawScript.trim()) return;

			const advancePipeline = (
				step: PipelineStep,
				status: PipelineStepStatus
			) => {
				const progress = { ...get().pipelineProgress, [step]: status };
				set({ pipelineStep: step, pipelineProgress: progress });
			};

			set({
				parseStatus: "parsing",
				parseError: null,
				pipelineStep: "import",
				pipelineProgress: initialPipelineProgress,
			});

			try {
				advancePipeline("import", "active");

				const api = window.electronAPI?.moyin;
				if (!api) {
					throw new Error("Moyin API not available. Please run in Electron.");
				}

				const result = await api.parseScript({ rawScript });

				if (!result.success || !result.data) {
					throw new Error(result.error || "Failed to parse script");
				}

				advancePipeline("import", "done");

				const data = result.data as unknown as ScriptData;

				// Set data immediately so user can see results while calibration runs
				set({
					scriptData: data,
					characters: data.characters ?? [],
					scenes: data.scenes ?? [],
					episodes: data.episodes ?? [],
					shots: [],
					shotGenerationStatus: {},
					selectedShotIds: new Set<string>(),
					activeStep: "characters",
				});

				// --- Title Calibration ---
				advancePipeline("title_calibration", "active");
				try {
					const { title, logline } = await calibrateTitleLLM(data, rawScript);
					const updated = { ...data, title, logline };
					set({ scriptData: updated });
					advancePipeline("title_calibration", "done");
				} catch (err) {
					console.warn("[Moyin] Title calibration failed:", err);
					advancePipeline("title_calibration", "error");
				}

				// --- Synopsis Generation ---
				advancePipeline("synopsis", "active");
				try {
					const synopsis = await generateSynopsisLLM(
						get().scriptData ?? data,
						rawScript
					);
					const current = get().scriptData;
					if (current) {
						set({ scriptData: { ...current, logline: synopsis } });
					}
					advancePipeline("synopsis", "done");
				} catch (err) {
					console.warn("[Moyin] Synopsis generation failed:", err);
					advancePipeline("synopsis", "error");
				}

				// --- Shot Calibration ---
				advancePipeline("shot_calibration", "active");
				try {
					const { episodes, scenes, scriptData: sd } = get();
					for (const ep of episodes) {
						const epScenes = scenes.filter((s) => ep.sceneIds.includes(s.id));
						if (epScenes.length === 0) continue;
						const newShots = await generateShotsForEpisodeAction(
							epScenes,
							ep.title,
							sd?.title || "Unknown"
						);
						set((state) => ({
							shots: [
								...state.shots.filter(
									(s) => !newShots.some((ns) => ns.id === s.id)
								),
								...newShots,
							],
						}));
					}
					advancePipeline("shot_calibration", "done");
				} catch (err) {
					console.warn("[Moyin] Shot calibration failed:", err);
					advancePipeline("shot_calibration", "error");
				}

				// --- Character Calibration ---
				advancePipeline("character_calibration", "active");
				try {
					const { characters: chars, scriptData: sd2 } = get();
					const enhanced = await enhanceCharactersLLM(chars, sd2, rawScript);
					set({ characters: enhanced });
					advancePipeline("character_calibration", "done");
				} catch (err) {
					console.warn("[Moyin] Character calibration failed:", err);
					advancePipeline("character_calibration", "error");
				}

				// --- Scene Calibration ---
				advancePipeline("scene_calibration", "active");
				try {
					const { scenes: scns, scriptData: sd3 } = get();
					const enhanced = await enhanceScenesLLM(scns, sd3, rawScript);
					set({ scenes: enhanced });
					advancePipeline("scene_calibration", "done");
				} catch (err) {
					console.warn("[Moyin] Scene calibration failed:", err);
					advancePipeline("scene_calibration", "error");
				}

				set({ parseStatus: "ready" });
			} catch (error) {
				const currentStep = get().pipelineStep;
				if (currentStep) advancePipeline(currentStep, "error");
				set({
					parseStatus: "error",
					parseError:
						error instanceof Error ? error.message : "Unknown parse error",
				});
			}
		},

		generateScript: async (
			idea: string,
			options: { genre?: string; targetDuration?: string } = {}
		) => {
			if (!idea.trim()) return;
			set({ createStatus: "generating", createError: null });

			try {
				const { sceneCount, shotCount, selectedStyleId } = get();
				const generatedText = await generateScriptAction(idea, options, {
					sceneCount,
					shotCount,
					selectedStyleId,
				});
				set({
					rawScript: generatedText,
					createStatus: "done",
					createError: null,
				});
			} catch (error) {
				set({
					createStatus: "error",
					createError:
						error instanceof Error ? error.message : "Script generation failed",
				});
			}
		},

		enhanceCharacters: async () => {
			const { characters, scriptData, rawScript } = get();
			if (characters.length === 0) return;
			set({
				characterCalibrationStatus: "calibrating",
				calibrationError: null,
			});
			try {
				const enhanced = await enhanceCharactersLLM(
					characters,
					scriptData,
					rawScript
				);
				set({
					characters: enhanced,
					characterCalibrationStatus: "done",
				});
			} catch (error) {
				set({
					characterCalibrationStatus: "error",
					calibrationError:
						error instanceof Error ? error.message : "Enhancement failed",
				});
			}
		},

		enhanceScenes: async () => {
			const { scenes, scriptData, rawScript } = get();
			if (scenes.length === 0) return;
			set({
				sceneCalibrationStatus: "calibrating",
				calibrationError: null,
			});
			try {
				const enhanced = await enhanceScenesLLM(scenes, scriptData, rawScript);
				set({ scenes: enhanced, sceneCalibrationStatus: "done" });
			} catch (error) {
				set({
					sceneCalibrationStatus: "error",
					calibrationError:
						error instanceof Error ? error.message : "Enhancement failed",
				});
			}
		},

		analyzeCharacterStages: async (): Promise<number> => {
			const { characters, episodes, scriptData } = get();
			if (characters.length === 0 || episodes.length < 2) return 0;
			try {
				const updated = await analyzeStagesAction(
					characters,
					episodes.length,
					scriptData
				);
				const count = updated.filter(
					(c, i) =>
						(c.variations?.length || 0) >
						(characters[i].variations?.length || 0)
				).length;
				set({ characters: updated });
				return count;
			} catch (error) {
				console.error("[analyzeCharacterStages]", error);
				return 0;
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
				const result = await generateStoryboardAction(
					scenes,
					characters,
					selectedStyleId,
					scriptData,
					(p) => set({ generationProgress: p })
				);
				set({
					generationStatus: "done",
					generationProgress: 100,
					storyboardImageUrl: result.imageUrl,
					storyboardGridConfig: result.gridConfig,
				});
			} catch (error) {
				set({
					generationStatus: "error",
					generationError:
						error instanceof Error ? error.message : "Unknown generation error",
				});
			}
		},

		splitAndApplyStoryboard: async () => {
			const {
				storyboardImageUrl: url,
				storyboardGridConfig: grid,
				scenes,
				shots,
				scriptData,
			} = get();
			if (!url || !grid) return;
			try {
				const result = await splitAndApplyAction(
					url,
					grid,
					scenes,
					shots,
					scriptData
				);
				set({ shots: result.shots });
			} catch (error) {
				set({
					generationError:
						error instanceof Error
							? error.message
							: "Failed to split storyboard",
				});
			}
		},
	};
}

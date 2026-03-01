/**
 * Moyin Parse Actions — extracted from moyin-store.ts to keep it under 800 lines.
 * Contains the calibration pipeline, PTY terminal execution helper, and model options.
 */

import type { ScriptData, ScriptScene } from "@/types/moyin-script";
import {
	calibrateTitleLLM,
	generateSynopsisLLM,
	enhanceCharactersLLM,
	enhanceScenesLLM,
} from "./moyin-calibration";
import { generateShotsForEpisodeAction } from "./moyin-generation";
import type { PipelineStep, PipelineStepStatus } from "./moyin-store";

// ==================== Model Options ====================

export const MODEL_OPTIONS = [
	{ value: "minimax", label: "MiniMax M2.5" },
	{ value: "gemini", label: "Gemini Flash" },
	{ value: "gemini-pro", label: "Gemini Pro" },
	{ value: "kimi", label: "Kimi K2.5" },
	{ value: "claude", label: "Claude (no key)" },
] as const;

/** Display label for a model alias */
export function getModelLabel(value: string): string {
	const opt = MODEL_OPTIONS.find((o) => o.value === value);
	return opt?.label ?? value;
}

// ==================== Calibration Pipeline ====================

interface StoreRef {
	getState: () => {
		scriptData: ScriptData | null;
		characters: import("@/types/moyin-script").ScriptCharacter[];
		scenes: ScriptScene[];
		episodes: import("@/types/moyin-script").Episode[];
		shots: import("@/types/moyin-script").Shot[];
		pipelineProgress: Record<PipelineStep, PipelineStepStatus>;
		pipelineStep: PipelineStep | null;
	};
	setState: (
		partial:
			| Partial<ReturnType<StoreRef["getState"]>>
			| ((
					state: ReturnType<StoreRef["getState"]>
			  ) => Partial<ReturnType<StoreRef["getState"]>>)
	) => void;
}

/**
 * Run the 5-step calibration pipeline after initial parse.
 * Extracted so both parseScript() and onParsed listener can use it.
 */
export async function runCalibrationPipeline(
	data: ScriptData,
	rawScript: string,
	store: StoreRef
): Promise<void> {
	const advancePipeline = (
		step: PipelineStep,
		status: PipelineStepStatus
	) => {
		const progress = { ...store.getState().pipelineProgress, [step]: status };
		store.setState({ pipelineStep: step, pipelineProgress: progress });
	};

	// Set data immediately so user can see results while calibration runs
	store.setState({
		scriptData: data,
		characters: data.characters ?? [],
		scenes: data.scenes ?? [],
		episodes: data.episodes ?? [],
		shots: [],
	});

	advancePipeline("import", "done");

	// --- Title Calibration ---
	advancePipeline("title_calibration", "active");
	try {
		const { title, logline } = await calibrateTitleLLM(data, rawScript);
		const updated = { ...data, title, logline };
		store.setState({ scriptData: updated });
		advancePipeline("title_calibration", "done");
	} catch (err) {
		console.warn("[Moyin] Title calibration failed:", err);
		advancePipeline("title_calibration", "error");
	}

	// --- Synopsis Generation ---
	advancePipeline("synopsis", "active");
	try {
		const synopsis = await generateSynopsisLLM(
			store.getState().scriptData ?? data,
			rawScript
		);
		const current = store.getState().scriptData;
		if (current) {
			store.setState({ scriptData: { ...current, logline: synopsis } });
		}
		advancePipeline("synopsis", "done");
	} catch (err) {
		console.warn("[Moyin] Synopsis generation failed:", err);
		advancePipeline("synopsis", "error");
	}

	// --- Shot Calibration ---
	advancePipeline("shot_calibration", "active");
	try {
		const { episodes, scenes, scriptData: sd } = store.getState();
		for (const ep of episodes) {
			const epScenes = scenes.filter((s) => ep.sceneIds.includes(s.id));
			if (epScenes.length === 0) continue;
			const newShots = await generateShotsForEpisodeAction(
				epScenes,
				ep.title,
				sd?.title || "Unknown"
			);
			store.setState((state) => ({
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
		const { characters: chars, scriptData: sd2 } = store.getState();
		const enhanced = await enhanceCharactersLLM(chars, sd2, rawScript);
		store.setState({ characters: enhanced });
		advancePipeline("character_calibration", "done");
	} catch (err) {
		console.warn("[Moyin] Character calibration failed:", err);
		advancePipeline("character_calibration", "error");
	}

	// --- Scene Calibration ---
	advancePipeline("scene_calibration", "active");
	try {
		const { scenes: scns, scriptData: sd3 } = store.getState();
		const enhanced = await enhanceScenesLLM(scns, sd3, rawScript);
		store.setState({ scenes: enhanced });
		advancePipeline("scene_calibration", "done");
	} catch (err) {
		console.warn("[Moyin] Scene calibration failed:", err);
		advancePipeline("scene_calibration", "error");
	}
}

// ==================== PTY Terminal Execution ====================

/**
 * Attempt to run parse-script via PTY terminal for streaming output.
 * Returns true if successfully initiated; data arrives via onParsed listener.
 * Returns false if PTY unavailable (caller should fall back to IPC).
 */
export async function attemptPtyParse(
	rawScript: string,
	model: string
): Promise<{ success: boolean; tempPath?: string }> {
	try {
		const api = window.electronAPI?.moyin;
		const ptyApi = window.electronAPI?.pty;
		if (!api?.saveTempScript || !ptyApi) return { success: false };

		// 1. Save script to temp file
		const saveResult = await api.saveTempScript({ rawScript });
		if (!saveResult.success || !saveResult.filePath) return { success: false };

		const projectRoot = saveResult.projectRoot;
		if (!projectRoot) {
			api.cleanupTempScript(saveResult.filePath);
			return { success: false };
		}

		// 2. Switch to PTY terminal tab
		const { useMediaPanelStore } = await import(
			"@/components/editor/media-panel/store"
		);
		useMediaPanelStore.getState().setActiveTab("pty");

		// 3. Ensure shell session is running
		const { usePtyTerminalStore } = await import(
			"@/stores/pty-terminal-store"
		);
		const ptyState = usePtyTerminalStore.getState();

		// If connected to a non-shell provider, disconnect and reconnect as shell
		if (
			ptyState.status === "connected" &&
			ptyState.cliProvider !== "shell"
		) {
			await usePtyTerminalStore.getState().disconnect({ userInitiated: true });
			// Small delay for clean disconnect
			await new Promise((resolve) => setTimeout(resolve, 300));
		}

		// Spawn a shell session if not connected
		if (usePtyTerminalStore.getState().status !== "connected") {
			usePtyTerminalStore.getState().setCliProvider("shell");
			await usePtyTerminalStore.getState().connect({ manual: true });
			// Give shell time to initialize
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		const sessionId = usePtyTerminalStore.getState().sessionId;
		if (!sessionId) {
			api.cleanupTempScript(saveResult.filePath);
			return { success: false };
		}

		// 4. Build and write CLI command
		const escapedPath = saveResult.filePath.replace(/ /g, "\\ ");
		const cmd = `cd ${projectRoot.replace(/ /g, "\\ ")} && bun run pipeline moyin:parse-script --script ${escapedPath} --model ${model} --stream`;

		await ptyApi.write(sessionId, cmd + "\n");

		// 5. Schedule temp file cleanup after 5 minutes
		setTimeout(() => {
			api.cleanupTempScript(saveResult.filePath!);
		}, 300_000);

		return { success: true, tempPath: saveResult.filePath };
	} catch (error) {
		console.warn("[Moyin] PTY parse attempt failed:", error);
		return { success: false };
	}
}

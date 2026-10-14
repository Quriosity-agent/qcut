/**
 * Claude Project Settings Bridge
 *
 * Applies project settings sent through the editor API
 * (`editor:project:update-settings`). The main process writes them to the
 * project's `project.qcut`, but the editor opens projects from its own
 * storage. So an update for the loaded project is applied live, and one for
 * any other project is written into its stored record, which is what the
 * editor shows the next time that project opens. A project that is still
 * loading counts as not open: saving before its timeline loads would store
 * the cleared timeline.
 *
 * @module lib/claude-bridge/claude-project-settings-bridge
 */

import { type PlatformClaudeProjectAPI, platform } from "@qcut/platform-core";
import { storageService } from "@/lib/storage/storage-service";
import { useEditorStore } from "@/stores/editor/editor-store";
import { useProjectStore } from "@/stores/project-store";
import type { TProject } from "@/types/project";

export interface ClaudeProjectSettingsUpdate {
	name?: string;
	width?: number;
	height?: number;
	fps?: number;
	aspectRatio?: string;
	backgroundColor?: string;
	canvasSize?: {
		width?: number;
		height?: number;
	};
}

function positiveNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.round(value)
		: undefined;
}

/** `project` with `settings` applied; a canvas size change makes it custom. */
export function mergeProjectSettings({
	project,
	settings,
}: {
	project: TProject;
	settings: ClaudeProjectSettingsUpdate;
}): TProject {
	const width =
		positiveNumber(settings.width) ??
		positiveNumber(settings.canvasSize?.width) ??
		project.canvasSize.width;
	const height =
		positiveNumber(settings.height) ??
		positiveNumber(settings.canvasSize?.height) ??
		project.canvasSize.height;
	const dimensionsChanged =
		width !== project.canvasSize.width || height !== project.canvasSize.height;
	return {
		...project,
		name:
			typeof settings.name === "string" && settings.name.trim()
				? settings.name.trim()
				: project.name,
		fps: positiveNumber(settings.fps) ?? project.fps,
		backgroundColor: settings.backgroundColor ?? project.backgroundColor,
		canvasSize: { width, height },
		canvasMode: dimensionsChanged ? "custom" : project.canvasMode,
		updatedAt: new Date(),
	};
}

/**
 * Updates written to a stored project while it was not open. They are applied
 * again once the project next finishes loading, because a load already in
 * flight may have read the record before the write landed.
 */
const pendingByProject = new Map<string, ClaudeProjectSettingsUpdate>();
let unsubscribeProjectStore: (() => void) | null = null;

async function applyToActiveProject({
	settings,
}: {
	settings: ClaudeProjectSettingsUpdate;
}): Promise<void> {
	const activeProject = useProjectStore.getState().activeProject;
	if (!activeProject) return;
	const nextProject = mergeProjectSettings({
		project: activeProject,
		settings,
	});
	useProjectStore.setState({ activeProject: nextProject });
	useEditorStore
		.getState()
		.setCanvasSize(nextProject.canvasSize, nextProject.canvasMode);
	await useProjectStore.getState().saveCurrentProject();
}

/** Applies `settings` to `projectId`, open or not. */
export async function applyClaudeProjectSettings({
	projectId,
	settings,
}: {
	projectId: string;
	settings: ClaudeProjectSettingsUpdate;
}): Promise<void> {
	if (useProjectStore.getState().loadedProjectId === projectId) {
		await applyToActiveProject({ settings });
		return;
	}
	const stored = await storageService.loadProject({ id: projectId });
	if (!stored) return;
	pendingByProject.set(projectId, {
		...pendingByProject.get(projectId),
		...settings,
	});
	await storageService.saveProject({
		project: mergeProjectSettings({ project: stored, settings }),
	});
	await useProjectStore.getState().loadAllProjects();
}

/** Listen for settings updates for every project, open or not. */
export function setupClaudeProjectSettingsBridge(): void {
	let projectApi: PlatformClaudeProjectAPI | undefined;
	try {
		projectApi = platform().claude?.project;
	} catch {
		return; // Platform not initialized yet
	}
	if (!projectApi?.onUpdated) return;

	unsubscribeProjectStore?.();
	unsubscribeProjectStore = useProjectStore.subscribe((state) => {
		const projectId = state.loadedProjectId;
		const settings = projectId ? pendingByProject.get(projectId) : undefined;
		if (!projectId || !settings) return;
		pendingByProject.delete(projectId);
		applyToActiveProject({ settings }).catch((error) => {
			console.error("[ClaudeProjectSettingsBridge] Apply failed:", error);
		});
	});

	projectApi.onUpdated((projectId, settings) => {
		applyClaudeProjectSettings({
			projectId,
			settings: settings as ClaudeProjectSettingsUpdate,
		}).catch((error) => {
			// project.qcut already holds the update; the editor copy is stale.
			console.error("[ClaudeProjectSettingsBridge] Update failed:", error);
		});
	});
}

/** Stop applying settings updates. The IPC listener goes with the project bridge's cleanup. */
export function cleanupClaudeProjectSettingsBridge(): void {
	unsubscribeProjectStore?.();
	unsubscribeProjectStore = null;
	pendingByProject.clear();
}

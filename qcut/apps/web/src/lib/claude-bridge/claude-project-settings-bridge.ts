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
 * The other direction matters too: changes made inside the editor are
 * mirrored into the open project's `project.qcut`, so the CLI reads the
 * canvas and frame rate the editor actually renders.
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
/** What project.qcut is known to hold, so unchanged state is not rewritten. */
let lastMirroredSettings: string | null = null;

interface MirrorWrite {
	projectApi: PlatformClaudeProjectAPI;
	projectId: string;
	settings: ClaudeProjectSettingsUpdate;
	key: string;
}

/** The newest state, waiting for the write in flight to finish. */
let queuedMirror: MirrorWrite | null = null;
let mirrorInFlight = false;

/**
 * Writes one state at a time, always the newest. Overlapping writes could
 * finish out of order and leave an older canvas in project.qcut. A state
 * counts as mirrored only once its write succeeds, so a failed write is tried
 * again on the next store change.
 */
async function drainMirrorQueue(): Promise<void> {
	mirrorInFlight = true;
	try {
		while (queuedMirror) {
			const next = queuedMirror;
			queuedMirror = null;
			if (next.key === lastMirroredSettings) continue;
			try {
				await next.projectApi.updateSettings(next.projectId, next.settings, {
					broadcast: false,
				});
				lastMirroredSettings = next.key;
			} catch (error) {
				console.error("[ClaudeProjectSettingsBridge] Mirror failed:", error);
			}
		}
	} finally {
		mirrorInFlight = false;
	}
}

/**
 * Writes the open project's canvas, frame rate and background into its
 * project.qcut whenever they change in the editor (the canvas picker, the
 * first clip fitting the canvas). `editor:project:settings` and project.json
 * read that file, so without this they report a size the editor no longer
 * renders. `broadcast: false` keeps the write from echoing back here.
 */
function mirrorOpenProjectSettings({
	projectApi,
	project,
	loadedProjectId,
}: {
	projectApi: PlatformClaudeProjectAPI;
	project: TProject | null;
	loadedProjectId: string | null;
}): void {
	if (!project || loadedProjectId !== project.id) return;
	if (typeof projectApi.updateSettings !== "function") return;
	const settings = {
		width: project.canvasSize.width,
		height: project.canvasSize.height,
		...(project.fps ? { fps: project.fps } : {}),
		backgroundColor: project.backgroundColor,
	};
	const key = JSON.stringify([project.id, settings]);
	// While a write is in flight even a known state is queued: it may need to
	// overwrite what that write is putting there.
	if (!mirrorInFlight && key === lastMirroredSettings) return;
	queuedMirror = { projectApi, projectId: project.id, settings, key };
	if (!mirrorInFlight) void drainMirrorQueue();
}

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

	const api = projectApi;
	unsubscribeProjectStore?.();
	unsubscribeProjectStore = useProjectStore.subscribe((state) => {
		mirrorOpenProjectSettings({
			projectApi: api,
			project: state.activeProject,
			loadedProjectId: state.loadedProjectId,
		});
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
	lastMirroredSettings = null;
	queuedMirror = null;
}

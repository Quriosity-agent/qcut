import { storageService } from "@/lib/storage/storage-service";
import type { MediaFileData } from "@/lib/storage/types";
import { useProjectStore } from "@/stores/project-store";
import type { TProject } from "@/types/project";
import type { TimelineTrack } from "@/types/timeline";

/**
 * A project as storage holds it. Read-only editor API requests that name a
 * project other than the one the editor has loaded answer from this, so
 * reading a project never switches what the user has open (N23).
 */
export interface StoredProjectView {
	project: TProject;
	/** The current scene's tracks. */
	tracks: TimelineTrack[];
	media: Array<Pick<MediaFileData, "id" | "name" | "type">>;
}

/** Whether the editor has `projectId` loaded, so its live state answers. */
export function isLoadedProject(projectId: string | undefined): boolean {
	return (
		projectId === undefined ||
		useProjectStore.getState().loadedProjectId === projectId
	);
}

export function storedProjectNotFound(projectId: string): Error {
	return new Error(`Project ${projectId} was not found`);
}

/** The named project from storage, or null when there is no such project. */
export async function loadStoredProjectView({
	projectId,
}: {
	projectId: string;
}): Promise<StoredProjectView | null> {
	const project = await storageService.loadProject({ id: projectId });
	if (!project) return null;
	const [tracks, media] = await Promise.all([
		storageService.loadTimeline({
			projectId,
			sceneId: project.currentSceneId || undefined,
		}),
		storageService.loadAllMediaSummaries(projectId),
	]);
	return { project, tracks: tracks ?? [], media };
}

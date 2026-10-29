import { storageService } from "@/lib/storage/storage-service";
import type { TProject } from "@/types/project";

/**
 * Saves a change to one project's stored record and returns the record, or
 * null when there is no such project.
 *
 * The open project changes as the editor holds it now, a closed one as it is
 * stored. The project list is only a snapshot from its last refresh: saving
 * its copy wrote back an older mix, canvas or anything else changed since,
 * and put that copy in the editor too (N19: a rename lost the master curve
 * set after the copy was listed).
 */
export async function saveProjectRecordChange({
	projectId,
	patch,
	getActiveProject,
	setActiveProject,
}: {
	projectId: string;
	patch: Partial<Pick<TProject, "name" | "folderId">>;
	getActiveProject: () => TProject | null;
	setActiveProject: (project: TProject) => void;
}): Promise<TProject | null> {
	const active = getActiveProject();
	if (active?.id === projectId) {
		// In the editor first, so any save from here on carries the change.
		const updated = { ...active, ...patch, updatedAt: new Date() };
		setActiveProject(updated);
		await storageService.saveProject({ project: updated });
		return updated;
	}
	const stored = await storageService.loadProject({ id: projectId });
	if (!stored) return null;
	const updated = { ...stored, ...patch, updatedAt: new Date() };
	await storageService.saveProject({ project: updated });
	return updated;
}

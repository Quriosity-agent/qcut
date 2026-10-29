import { storageService } from "@/lib/storage/storage-service";
import type { TProject } from "@/types/project";

type RecordPatch = Partial<Pick<TProject, "name" | "folderId">>;

function alreadyHolds({
	project,
	patch,
}: {
	project: TProject;
	patch: RecordPatch;
}): boolean {
	return Object.entries(patch).every(
		([field, value]) =>
			(project[field as keyof RecordPatch] ?? null) === (value ?? null)
	);
}

/**
 * Saves a change to one project's stored record and returns the record, or
 * null when there is no such project. A record that already holds the change
 * is returned as it is.
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
	patch: RecordPatch;
	getActiveProject: () => TProject | null;
	setActiveProject: (project: TProject) => void;
}): Promise<TProject | null> {
	const active = getActiveProject();
	if (active?.id === projectId) {
		if (alreadyHolds({ project: active, patch })) return active;
		// In the editor first, so any save from here on carries the change.
		const updated = { ...active, ...patch, updatedAt: new Date() };
		setActiveProject(updated);
		try {
			await storageService.saveProject({ project: updated });
		} catch (error) {
			// Taken back unless something has changed the project since, so the
			// editor does not show a change storage never got.
			if (getActiveProject() === updated) setActiveProject(active);
			throw error;
		}
		return updated;
	}
	const stored = await storageService.loadProject({ id: projectId });
	if (!stored) return null;
	if (alreadyHolds({ project: stored, patch })) return stored;
	const updated = { ...stored, ...patch, updatedAt: new Date() };
	await storageService.saveProject({ project: updated });
	return updated;
}

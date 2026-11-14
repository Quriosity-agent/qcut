import { storageService } from "@/lib/storage/storage-service";
import type { TProject } from "@/types/project";

/**
 * Moves the open project's `updatedAt` to now and saves its record.
 *
 * A project's timeline and media are stored apart from its record, so
 * saving them left `updatedAt` where the last settings change had put it: a
 * project re-cut all day still showed yesterday's time in the project list,
 * from the editor and from `qcut editor timeline apply` alike. Whatever
 * saves the project's contents calls this once the save is in.
 *
 * Only the open project changes this way; it is saved as the editor holds
 * it now, like every other record change. Returns the new time, or null
 * when `projectId` is not the open project.
 *
 * Some record changes are stored before the editor holds them (a new frame
 * rate is saved, then set). One in flight when this runs is not in the copy
 * saved here, and this save, landing second, would put the old value back in
 * storage while the editor shows the new one. So when the editor's project
 * has moved on by the time this save is in, it is saved once more as it is.
 */
export async function saveProjectContentChange({
	projectId,
	getActiveProject,
	setActiveProject,
	now = () => new Date(),
}: {
	projectId: string;
	getActiveProject: () => TProject | null;
	setActiveProject: (project: TProject) => void;
	now?: () => Date;
}): Promise<Date | null> {
	const active = getActiveProject();
	if (active?.id !== projectId) return null;
	const updated = { ...active, updatedAt: now() };
	setActiveProject(updated);
	await storageService.saveProject({ project: updated });
	const latest = getActiveProject();
	if (latest && latest.id === projectId && latest !== updated) {
		await storageService.saveProject({ project: latest });
	}
	return updated.updatedAt;
}

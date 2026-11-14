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
 * has moved on by the time a save is in, it is saved again as it is, until a
 * save lands with the editor still holding what it wrote. Saves reach storage
 * in the order they were sent, so the last one written is then the editor's.
 *
 * It never stops on a write the editor has already moved past: that write
 * could be the one that puts an old value back. A project that is still
 * changing after this many saves in a row is not a user changing settings,
 * and the save fails loudly instead of going round for ever.
 */
const RUNAWAY_FOLLOW_UP_SAVES = 50;

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
	let saved = updated;
	await storageService.saveProject({ project: saved });
	for (
		let followUps = 0;
		followUps <= RUNAWAY_FOLLOW_UP_SAVES;
		followUps += 1
	) {
		const latest = getActiveProject();
		const settled = !latest || latest.id !== projectId || latest === saved;
		if (settled) return updated.updatedAt;
		if (followUps === RUNAWAY_FOLLOW_UP_SAVES) break;
		// A settings change stamps itself when it starts, which can be before
		// this change: the later of the two times is the project's.
		const isOlder = latest.updatedAt.getTime() < updated.updatedAt.getTime();
		saved = isOlder ? { ...latest, updatedAt: updated.updatedAt } : latest;
		if (isOlder) setActiveProject(saved);
		await storageService.saveProject({ project: saved });
	}
	throw new Error(
		`Project ${projectId} kept changing through ${RUNAWAY_FOLLOW_UP_SAVES} saves of its change time; its stored record may be behind the editor's`
	);
}

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
 * could be the one that puts an old value back. There is no limit on the
 * number of saves for the same reason; what ends it is the project holding
 * still for the length of one save, and only a record that really differs
 * counts as having moved on.
 *
 * The project can also be closed, or another one opened, while a save is in
 * flight. What the editor last held of this project is then no longer the
 * open project, so it is followed through `watchActiveProject` for as long
 * as the saves run: a setting published just before the switch is still
 * written last.
 */

/** Same record, whether or not it is the same object. */
function sameRecord({ left, right }: { left: TProject; right: TProject }) {
	return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export async function saveProjectContentChange({
	projectId,
	getActiveProject,
	setActiveProject,
	watchActiveProject,
	now = () => new Date(),
}: {
	projectId: string;
	getActiveProject: () => TProject | null;
	setActiveProject: (project: TProject) => void;
	/** Calls back on every change of the open project; returns how to stop. */
	watchActiveProject?: (
		onChange: (project: TProject | null) => void
	) => () => void;
	now?: () => Date;
}): Promise<Date | null> {
	const active = getActiveProject();
	if (active?.id !== projectId) return null;
	const updated = { ...active, updatedAt: now() };
	// The newest record of this project the editor has held, open or not.
	let lastHeld: TProject = updated;
	const noteIfThisProject = (project: TProject | null) => {
		if (project?.id === projectId) lastHeld = project;
	};
	const stopWatching = watchActiveProject?.(noteIfThisProject);
	try {
		setActiveProject(updated);
		let saved = updated;
		await storageService.saveProject({ project: saved });
		while (true) {
			const open = getActiveProject();
			noteIfThisProject(open);
			if (sameRecord({ left: lastHeld, right: saved })) break;
			// A settings change stamps itself when it starts, which can be
			// before this change: the later of the two times is the project's.
			const isOlder =
				lastHeld.updatedAt.getTime() < updated.updatedAt.getTime();
			saved = isOlder
				? { ...lastHeld, updatedAt: updated.updatedAt }
				: lastHeld;
			lastHeld = saved;
			// Never put a project back in the editor that it has left.
			if (isOlder && open?.id === projectId) setActiveProject(saved);
			await storageService.saveProject({ project: saved });
		}
		return updated.updatedAt;
	} finally {
		stopWatching?.();
	}
}

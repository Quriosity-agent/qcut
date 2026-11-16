/**
 * Renames the editor still has to settle.
 *
 * A media rename changes the item, each scene's timeline and the stickers,
 * which are stored apart, while the file's name is in the desktop app's
 * hands. When it fails, the editor takes back what it changed and the file
 * is put back under its old name. Two things can leave the stored project
 * naming an id the file does not have: a step that cannot be taken back (a
 * timeline that will not save), and the desktop app putting the file back
 * after the editor had finished (its answer came too late) when the editor
 * then cannot go back either. Nothing would put that right once the project
 * is closed.
 *
 * So such a rename is noted here, in a store of its own beside the
 * project's, and settled from what the project folder holds the next time
 * the project is open (`settleUnsettledMediaRenames`).
 *
 * @module stores/media/media-rename-notes
 */
import { platform } from "@qcut/platform-core";

/** A rename after which the editor and the folder may not agree. */
export interface UnsettledRename {
	/** What the rename was to give the file. */
	newId: string;
	newName: string;
	newPath: string;
	/** What the file had before it. */
	oldId: string;
	oldName: string;
	oldPath: string;
	/** Epoch milliseconds. */
	notedAt: number;
}

const storageKey = (projectId: string) =>
	`media-renames-unsettled-${projectId}`;

/** One change to a project's notes at a time: each reads, then writes. */
const lastChange = new Map<string, Promise<unknown>>();

function isUnsettledRename(candidate: unknown): candidate is UnsettledRename {
	if (typeof candidate !== "object" || candidate === null) return false;
	const record = candidate as Record<string, unknown>;
	return (
		["newId", "newName", "newPath", "oldId", "oldName", "oldPath"].every(
			(key) => typeof record[key] === "string" && record[key] !== ""
		) &&
		typeof record.notedAt === "number" &&
		Number.isFinite(record.notedAt)
	);
}

/** The renames noted for a project; none when the notes cannot be read. */
export async function readUnsettledRenames(
	projectId: string
): Promise<UnsettledRename[]> {
	const stored = await platform().storage.load(storageKey(projectId));
	return Array.isArray(stored) ? stored.filter(isUnsettledRename) : [];
}

function change({
	projectId,
	edit,
}: {
	projectId: string;
	edit: (notes: UnsettledRename[]) => UnsettledRename[];
}): Promise<void> {
	const run = (lastChange.get(projectId) ?? Promise.resolve()).then(
		async () => {
			const notes = await readUnsettledRenames(projectId);
			const edited = edit(notes);
			if (edited.length === 0) {
				if (notes.length > 0) {
					await platform().storage.remove(storageKey(projectId));
				}
				return;
			}
			const saved = await platform().storage.save(
				storageKey(projectId),
				edited
			);
			if (saved === false) {
				throw new Error("The note of an unsettled rename could not be saved");
			}
		}
	);
	lastChange.set(
		projectId,
		run.catch(() => undefined)
	);
	return run;
}

const samePair = (
	left: Pick<UnsettledRename, "newId" | "oldId">,
	right: Pick<UnsettledRename, "newId" | "oldId">
) => left.newId === right.newId && left.oldId === right.oldId;

/** Notes a rename to be settled; one note per pair of ids. */
export function noteUnsettledRename({
	projectId,
	rename,
}: {
	projectId: string;
	rename: UnsettledRename;
}): Promise<void> {
	return change({
		projectId,
		edit: (notes) => [
			...notes.filter((note) => !samePair(note, rename)),
			rename,
		],
	});
}

/** Drops the note of a rename that is settled. */
export function forgetUnsettledRename({
	projectId,
	rename,
}: {
	projectId: string;
	rename: Pick<UnsettledRename, "newId" | "oldId">;
}): Promise<void> {
	return change({
		projectId,
		edit: (notes) => notes.filter((note) => !samePair(note, rename)),
	});
}

/** Test seam: forget the order of changes kept between cases. */
export function resetUnsettledRenameChanges(): void {
	lastChange.clear();
}

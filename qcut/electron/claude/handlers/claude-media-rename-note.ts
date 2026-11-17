/**
 * The desktop app's notes of media renames the editor may not have settled.
 *
 * The rename route renames a file and has the editor follow, and puts the
 * file back when the editor does not. In between, the editor and the folder
 * can be apart: the editor's answer may not come though it finished, it may
 * not have taken everything back, a file may not go back, and the app can
 * end at any point. The editor may not be able to say so later (it is busy,
 * it was reloaded, its own note could not be written). So the route notes
 * every rename itself, before the file is moved, and drops the note once
 * the editor is known to be where the file is: the editor settles a rename
 * that is still noted from what the folder holds when the project has next
 * finished loading (apps/web/src/stores/media/media-rename.ts).
 *
 * The notes are the app's, and kept here alone (main process only): one
 * record for a rename in the app's key-value store. They are written here,
 * handed to the editor from here (`listUnsettledMediaRenames`), and dropped
 * here, also when it is the editor that has settled one
 * (`forgetMediaRenameSettledByEditor`).
 *
 * The app also knows which renames it is at work on: from the note made
 * before the file is moved until it says where it left the file, or is done
 * with the rename some other way. The editor is told so with each note and
 * leaves such a rename alone: by following the folder then, it would end
 * on a name the file is about to leave, behind the back of the request that
 * is moving it. A note of such a rename is not dropped for the editor
 * either. This is known, not read off the age of a note: a rename can take
 * any time (a large file copied on a volume without hard links), and a note
 * that could not be written again says nothing about whether it goes on.
 *
 * @module electron/claude/handlers/claude-media-rename-note
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { app, ipcMain } from "electron";
import {
	readStorageJson,
	removeStorageJson,
	removeStorageJsonIf,
	writeStorageJson,
} from "../../main-ipc/storage-json.js";
import type { RenamedMediaFile } from "./claude-media-rename.js";

/**
 * What the app says of a rename, as it goes:
 * - `moving`: the file is about to get its new name, or is under it and
 *   still to be followed or put back. The app is at work on the rename
 *   from here on, and the folder settles nothing yet.
 * - `back`: the file is under its old name again, and stays there.
 * - `stays`: it could not be put back, and keeps its new name.
 * - `left`: the app is done with the rename, however it went. Nothing is
 *   written: a note that is there says what was last known.
 */
export type RenamedFileStage = "moving" | "back" | "stays" | "left";

/** A rename this app is at work on. */
interface RenameAtWork {
	/**
	 * Since when the two names may have been apart from the editor (epoch
	 * ms): when the app began the rename, before the file was moved; or when
	 * it began an earlier one between the same names that is not settled.
	 */
	beganAt: number;
	/** The request that is making it, by the name it gives itself. */
	by: string | undefined;
	/**
	 * The note that was there when the rename began: of an earlier rename
	 * between the same two names, which is still to be settled.
	 */
	earlier?: Record<string, unknown>;
}

/** The renames this app is at work on, by the path of their notes. */
const atWork = new Map<string, RenameAtWork>();

/**
 * The renames that were under way have ended without a last word: the
 * process that was making them is gone. The editor settles them from here
 * on.
 */
export function noLongerAtWorkOnMediaRenames(): void {
	atWork.clear();
}

let lastNotedAt = 0;

/**
 * The time of a note, and never the same for two: the editor names the note
 * it has settled by it, and a note written since is then not the one.
 */
function nextNotedAt(): number {
	lastNotedAt = Math.max(Date.now(), lastNotedAt + 1);
	return lastNotedAt;
}

const keyPrefix = (projectId: string) => `media-rename-unsettled-${projectId}-`;

/** A key ends in this many hex digits, made of the rename's two ids. */
const KEY_DIGEST_LENGTH = 32;

/**
 * The key of the note of a rename: one for its two ids, whichever way
 * round. A rename and its undoing are one matter, and have one note. Ids
 * follow file names and can be long, and a key becomes a file name: the
 * pair goes in as a digest.
 */
export function unsettledRenameKey({
	projectId,
	newId,
	oldId,
}: {
	projectId: string;
	newId: string;
	oldId: string;
}): string {
	const digest = createHash("sha256")
		.update([newId, oldId].sort().join("\n"), "utf8")
		.digest("hex");
	return `${keyPrefix(projectId)}${digest.slice(0, KEY_DIGEST_LENGTH)}`;
}

const notesFolder = () => path.join(app.getPath("userData"), "projects");

function notePath(rename: {
	projectId: string;
	newId: string;
	oldId: string;
}): string {
	return path.join(
		notesFolder(),
		`${path.basename(unsettledRenameKey(rename))}.json`
	);
}

const notePathOf = ({
	projectId,
	renamed,
}: {
	projectId: string;
	renamed: RenamedMediaFile;
}) => notePath({ projectId, newId: renamed.id, oldId: renamed.previous.id });

/**
 * Notes a rename for the editor to settle when the project is next open,
 * and keeps track of whether the app is at work on it (`stage`).
 *
 * The note names the file before and after the rename, and says:
 * - where the app left the file, once it is done moving it (`fileIs`);
 * - what the file looked like: its size and the time it was last changed,
 *   as the editor is shown them (get-file-info). Another file can take one
 *   of the two names meanwhile, and is told from the renamed one by these;
 * - when the app began the rename (`beganAt`). Until then the file had its
 *   old name, and no other file could have had it: a media item the editor
 *   held before that is not one of a file that took a name since.
 *
 * `by` is the request making the rename. A rename between two names that
 * another request is at work on is not begun: `moving` fails, and nothing
 * of the other request's is touched. Its other words are for its own
 * rename only.
 *
 * A rename can begin while a note of an earlier one between the same two
 * names is still there, not settled. The two are one matter from then on:
 * the note keeps the earlier beginning, since that is how long the names
 * may have been apart from the editor, and the earlier note is kept aside
 * for the case that this rename does not move the file
 * (`forgetUnsettledMediaRename`).
 */
export async function noteUnsettledMediaRename({
	projectId,
	renamed,
	stage = "moving",
	by,
}: {
	projectId: string;
	renamed: RenamedMediaFile;
	stage?: RenamedFileStage;
	by?: string;
}): Promise<void> {
	const before = renamed.previous;
	const filePath = notePathOf({ projectId, renamed });
	// What is known of the rename is brought up to date before anything is
	// awaited: whoever asks next is told how things stand now.
	const work = atWork.get(filePath);
	const ours = work !== undefined && work.by === by;
	if (stage === "left") {
		if (ours) atWork.delete(filePath);
		return;
	}
	if (work && !ours) {
		throw new Error(
			`Another request is renaming ${before.name} to ${renamed.name}, or back, at this moment`
		);
	}
	const mark: RenameAtWork | undefined =
		stage === "moving"
			? { ...work, beganAt: work?.beganAt ?? Date.now(), by }
			: undefined;
	if (mark) {
		atWork.set(filePath, mark);
	} else {
		// The file is where it stays, whatever becomes of this note: one that
		// cannot be written leaves the last one, and the folder, to say so.
		atWork.delete(filePath);
	}
	if (mark && !work) {
		// The first word of this rename: what is noted already is an earlier
		// rename's, which the editor has not settled.
		const earlier = await storedNote(filePath);
		if (earlier) {
			mark.earlier = earlier;
			const { beganAt: before } = earlier;
			if (typeof before === "number" && Number.isFinite(before)) {
				mark.beganAt = Math.min(mark.beganAt, before);
			}
		}
	}
	const beganAt = mark?.beganAt ?? work?.beganAt;

	// Where the file is. On its way it has one of the two names: the old
	// one until it is moved, which is when the route notes it.
	const places =
		stage === "back"
			? [before.path]
			: stage === "stays"
				? [renamed.path]
				: [before.path, renamed.path];
	let seen: Awaited<ReturnType<typeof fs.stat>> | undefined;
	for (const place of places) {
		seen ??= await fs.stat(place).catch(() => undefined);
	}
	const note = {
		oldId: before.id,
		oldName: before.name,
		oldPath: before.path,
		newId: renamed.id,
		newName: renamed.name,
		newPath: renamed.path,
		...(seen?.isFile()
			? { file: { size: seen.size, modifiedAt: seen.mtime.getTime() } }
			: {}),
		...(stage === "moving" ? {} : { fileIs: stage === "back" ? "old" : "new" }),
		...(beganAt === undefined ? {} : { beganAt }),
		notedAt: nextNotedAt(),
	};
	try {
		await writeStorageJson({ filePath, data: note });
	} catch (error) {
		// A rename that cannot be noted is not made: the app is not at work
		// on it, unless it has begun it again meanwhile.
		if (mark && atWork.get(filePath) === mark) atWork.delete(filePath);
		throw error;
	}
}

/**
 * Drops the note of a rename, for the request that made it: the editor and
 * the folder are known to agree. The app is no longer at work on the
 * rename.
 *
 * `unmoved` says that the file was not moved after all. Nothing has changed
 * then, and that includes what was noted before this rename began: the note
 * of an earlier rename between the same two names, still to be settled, is
 * put back as it was.
 */
export async function forgetUnsettledMediaRename({
	projectId,
	renamed,
	by,
	unmoved = false,
}: {
	projectId: string;
	renamed: RenamedMediaFile;
	by?: string;
	unmoved?: boolean;
}): Promise<void> {
	const filePath = notePathOf({ projectId, renamed });
	const work = atWork.get(filePath);
	// Another request's rename, and its note: not this one's to drop.
	if (work && work.by !== by) return;
	atWork.delete(filePath);
	if (unmoved && work?.earlier) {
		await writeStorageJson({ filePath, data: work.earlier });
		return;
	}
	await removeStorageJson({ filePath });
}

/** The note stored at a path, when there is one that can be read. */
async function storedNote(
	filePath: string
): Promise<Record<string, unknown> | undefined> {
	const stored = await readStorageJson({ filePath }).catch(() => null);
	const note = stored?.value;
	return typeof note === "object" && note !== null && !Array.isArray(note)
		? (note as Record<string, unknown>)
		: undefined;
}

/**
 * The renames noted for a project, as they are stored, each with whether
 * the app is at work on it at this moment (`atWork`).
 */
export async function listUnsettledMediaRenames({
	projectId,
}: {
	projectId: string;
}): Promise<Array<Record<string, unknown> & { atWork: boolean }>> {
	const prefix = keyPrefix(projectId);
	const isNoteOfProject = (name: string) =>
		name.startsWith(prefix) &&
		/^[0-9a-f]+\.json$/.test(name.slice(prefix.length)) &&
		name.length === prefix.length + KEY_DIGEST_LENGTH + ".json".length;
	let names: string[];
	try {
		names = await fs.readdir(notesFolder());
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const notes: Array<Record<string, unknown> & { atWork: boolean }> = [];
	for (const name of names.filter(isNoteOfProject).sort()) {
		const filePath = path.join(notesFolder(), name);
		// One that cannot be read is left out; it is still there next time.
		const note = await storedNote(filePath);
		if (note) notes.push({ ...note, atWork: atWork.has(filePath) });
	}
	return notes;
}

/**
 * Drops a note the editor has settled, and says whether it is gone.
 *
 * The editor settles a note by what it read of it and of the folder a
 * moment ago. The note is kept when that no longer holds: when the app is
 * at work on the rename (again), or the note was written since, which the
 * editor tells by the time of the one it read (`notedAt`). What the note
 * then says is still to be settled. The look and the removal are one step
 * to every write of the note.
 */
export function forgetMediaRenameSettledByEditor({
	projectId,
	oldId,
	newId,
	notedAt,
}: {
	projectId: string;
	oldId: string;
	newId: string;
	notedAt: number;
}): Promise<boolean> {
	const filePath = notePath({ projectId, newId, oldId });
	if (atWork.has(filePath)) return Promise.resolve(false);
	return removeStorageJsonIf({
		filePath,
		isStill: (stored) =>
			!atWork.has(filePath) &&
			typeof stored === "object" &&
			stored !== null &&
			(stored as { notedAt?: unknown }).notedAt === notedAt,
	});
}

const isText = (value: unknown): value is string =>
	typeof value === "string" && value !== "";

/** Lets the editor read the notes of a project, and have a settled one dropped. */
export function setupMediaRenameNotesIPC(): void {
	ipcMain.handle(
		"claude:media:unsettled-renames",
		async (_event, projectId: unknown) =>
			isText(projectId) ? listUnsettledMediaRenames({ projectId }) : []
	);
	ipcMain.handle(
		"claude:media:forget-settled-rename",
		async (_event, request: unknown) => {
			const { projectId, oldId, newId, notedAt } = (request ?? {}) as Record<
				string,
				unknown
			>;
			if (
				!isText(projectId) ||
				!isText(oldId) ||
				!isText(newId) ||
				typeof notedAt !== "number"
			) {
				return false;
			}
			return forgetMediaRenameSettledByEditor({
				projectId,
				oldId,
				newId,
				notedAt,
			});
		}
	);
}

/**
 * Renames the editor still has to settle.
 *
 * A media rename changes the item, each scene's timeline and the stickers,
 * which are stored apart, while the file's name is in the desktop app's
 * hands. When it fails, the editor takes back what it changed and the file
 * is put back under its old name. Several things can leave the stored
 * project naming an id the file does not have: a step that cannot be taken
 * back (a timeline that will not save), the desktop app putting the file
 * back after the editor had finished (its answer came too late) when the
 * editor then cannot go back either, a file that cannot be put back after
 * the editor has gone back, and the app ending in the middle of it all.
 * Nothing would put that right once the project is closed.
 *
 * So every rename is noted, in the desktop app's key-value store beside the
 * project's, and what is still noted is settled from what the project
 * folder holds the next time the project is open
 * (`settleUnsettledMediaRenames`). A note is a record of its own, under a
 * key made of the project and the two ids.
 *
 * The desktop app alone writes notes
 * (electron/claude/handlers/claude-media-rename-note.ts): before it moves
 * the file, and again once it knows where it has left it. The app has the
 * file in view; the editor knows only where a request wanted the file,
 * which may be a request the app has since gone back on. The editor reads
 * notes, and drops one when it has seen itself and the folder agree.
 *
 * @module stores/media/media-rename-notes
 */
import { platform } from "@qcut/platform-core";

/** What tells a file from another one that has since taken its name. */
export interface NotedFile {
	size: number;
	/** Epoch milliseconds. */
	modifiedAt: number;
}

/** A rename after which the editor and the folder may not agree. */
export interface UnsettledRename {
	/** The name the file had before the rename. */
	oldId: string;
	oldName: string;
	oldPath: string;
	/** The name the rename gave it. */
	newId: string;
	newName: string;
	newPath: string;
	/**
	 * The renamed file as the desktop app saw it. With it the file is told
	 * from another that has taken one of the two names since.
	 */
	file?: NotedFile;
	/**
	 * Where the desktop app left the file, once it is done moving it: under
	 * its old name again, or under the new one. Not set while the file may
	 * still move: what the folder holds settles nothing yet.
	 */
	fileIs?: "old" | "new";
	/** Epoch milliseconds. */
	notedAt: number;
}

type RenamePair = Pick<UnsettledRename, "newId" | "oldId">;

const keyPrefix = (projectId: string) => `media-rename-unsettled-${projectId}-`;

/**
 * The key of the note for two ids, whichever way round: a rename and its
 * undoing are one matter, and have one note. Ids follow file names and can
 * be long, and a key becomes a file name: the pair goes in as a digest.
 */
export async function unsettledRenameKey({
	projectId,
	rename,
}: {
	projectId: string;
	rename: RenamePair;
}): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode([rename.newId, rename.oldId].sort().join("\n"))
	);
	const hex = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0")
	).join("");
	return `${keyPrefix(projectId)}${hex.slice(0, 32)}`;
}

function notedFileOf(candidate: unknown): NotedFile | undefined {
	if (typeof candidate !== "object" || candidate === null) return;
	const { size, modifiedAt } = candidate as Record<string, unknown>;
	return typeof size === "number" &&
		Number.isFinite(size) &&
		typeof modifiedAt === "number" &&
		Number.isFinite(modifiedAt)
		? { size, modifiedAt }
		: undefined;
}

/** The note a stored value is, or undefined when it is not one. */
function noteOf(candidate: unknown): UnsettledRename | undefined {
	if (typeof candidate !== "object" || candidate === null) return;
	const record = candidate as Record<string, unknown>;
	const text = (key: string) =>
		typeof record[key] === "string" && record[key] !== ""
			? (record[key] as string)
			: undefined;
	const [oldId, oldName, oldPath, newId, newName, newPath] = [
		"oldId",
		"oldName",
		"oldPath",
		"newId",
		"newName",
		"newPath",
	].map(text);
	const { notedAt, fileIs } = record;
	if (
		!oldId ||
		!oldName ||
		!oldPath ||
		!newId ||
		!newName ||
		!newPath ||
		typeof notedAt !== "number" ||
		!Number.isFinite(notedAt)
	) {
		return;
	}
	const file = notedFileOf(record.file);
	return {
		oldId,
		oldName,
		oldPath,
		newId,
		newName,
		newPath,
		...(file ? { file } : {}),
		...(fileIs === "old" || fileIs === "new" ? { fileIs } : {}),
		notedAt,
	};
}

/** The renames noted for a project. */
export async function readUnsettledRenames(
	projectId: string
): Promise<UnsettledRename[]> {
	const prefix = keyPrefix(projectId);
	const keys = (await platform().storage.list()).filter((key) =>
		key.startsWith(prefix)
	);
	const notes: UnsettledRename[] = [];
	for (const key of keys.sort()) {
		const note = noteOf(await platform().storage.load(key));
		if (note) notes.push(note);
	}
	return notes;
}

/** The note of the rename between two ids, when there is one. */
export async function readUnsettledRename({
	projectId,
	rename,
}: {
	projectId: string;
	rename: RenamePair;
}): Promise<UnsettledRename | undefined> {
	return noteOf(
		await platform().storage.load(
			await unsettledRenameKey({ projectId, rename })
		)
	);
}

/** Drops the note of a rename that is settled. */
export async function forgetUnsettledRename({
	projectId,
	rename,
}: {
	projectId: string;
	rename: RenamePair;
}): Promise<void> {
	await platform().storage.remove(
		await unsettledRenameKey({ projectId, rename })
	);
}

/** What the folder shows at a path: a file, none (null), or no answer. */
async function fileAt(
	filePath: string
): Promise<Partial<NotedFile> | null | undefined> {
	let info: unknown;
	try {
		info = await platform().files.getFileInfo(filePath);
	} catch (error) {
		// The desktop app answers a missing file with the system's ENOENT;
		// any other failure says nothing about the file.
		const reason = error instanceof Error ? error.message : String(error);
		return /ENOENT/.test(reason) ? null : undefined;
	}
	if (typeof info !== "object" || info === null) return null;
	const { size, modifiedAt, modified, lastModified } = info as Record<
		string,
		unknown
	>;
	// The desktop app gives the time as a date, other platforms as a number.
	const changed = modifiedAt ?? modified ?? lastModified;
	const changedAt =
		changed instanceof Date
			? changed.getTime()
			: typeof changed === "string"
				? Date.parse(changed)
				: changed;
	return {
		...(typeof size === "number" ? { size } : {}),
		...(typeof changedAt === "number" && Number.isFinite(changedAt)
			? { modifiedAt: changedAt }
			: {}),
	};
}

const isNotedFile = (seen: Partial<NotedFile>, noted: NotedFile) =>
	seen.size === noted.size && seen.modifiedAt === noted.modifiedAt;

/** Where the folder shows a noted file to be. */
export interface NotedFilePlace {
	/** The one of the note's two names that the renamed file has. */
	name: "old" | "new";
	/** The other name has a file too: another one, that took it since. */
	otherNameTaken: boolean;
}

/**
 * Which of a note's two names the file has, by what the folder holds:
 * "nowhere" when neither has a file, undefined when the folder cannot be
 * asked.
 *
 * A name that alone has a file is the one. When both have one, another file
 * has taken a name since. The renamed file is then the one that looks as
 * the desktop app noted it. Where that does not tell them apart, it is
 * where the app says it left it; and if the app never said, it is under the
 * new name: put back under the old one, it would have left the new one
 * free.
 */
export async function whereNotedFileIs(
	note: UnsettledRename
): Promise<NotedFilePlace | "nowhere" | undefined> {
	const atOld = await fileAt(note.oldPath);
	const atNew = await fileAt(note.newPath);
	if (atOld === undefined || atNew === undefined) return;
	if (!atOld && !atNew) return "nowhere";
	if (!atOld) return { name: "new", otherNameTaken: false };
	if (!atNew) return { name: "old", otherNameTaken: false };
	const looksLike = (seen: Partial<NotedFile>) =>
		note.file !== undefined && isNotedFile(seen, note.file);
	const name =
		looksLike(atNew) !== looksLike(atOld)
			? looksLike(atNew)
				? "new"
				: "old"
			: (note.fileIs ?? "new");
	return { name, otherNameTaken: true };
}

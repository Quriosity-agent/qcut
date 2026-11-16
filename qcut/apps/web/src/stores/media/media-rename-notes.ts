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
 * editor then cannot go back either, and a file that cannot be put back
 * after the editor has gone back. Nothing would put that right once the
 * project is closed.
 *
 * So a rename is noted, in the desktop app's key-value store beside the
 * project's, and settled from what the project folder holds the next time
 * the project is open (`settleUnsettledMediaRenames`). A note is a record
 * of its own, under a key made of the project and the two ids. The desktop
 * app writes one for every rename, before it moves the file, and drops it
 * when the rename has ended with the two together
 * (electron/claude/handlers/claude-media-rename-note.ts makes the same
 * key); the editor writes one when it knows that they are apart.
 *
 * A note is dropped by whoever has seen the editor and the folder agree:
 * the desktop app, once the file is where it had the editor end, or the
 * editor when it settles the note itself.
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
	/**
	 * The name the file is expected to have when the folder does not say:
	 * the one it had before the rename, or, when it could not be put back,
	 * the one the rename gave it.
	 */
	oldId: string;
	oldName: string;
	oldPath: string;
	/** The other name of the rename. */
	newId: string;
	newName: string;
	newPath: string;
	/**
	 * The renamed file as the desktop app saw it. With it the file is told
	 * from another that has taken one of the two names since.
	 */
	file?: NotedFile;
	/**
	 * Set by the desktop app once it is done moving the file. Until then
	 * the file may still go back under its old name, and what the folder
	 * holds settles nothing yet.
	 */
	decided?: boolean;
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
	const { notedAt } = record;
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
		...(record.decided === true ? { decided: true } : {}),
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

/**
 * Notes a rename to be settled; one note for a pair of ids.
 *
 * A note that is there is kept as it is when the desktop app has marked it
 * as decided: the app knows where the file ended, and the editor only where
 * a request wanted it, which may be a request the app has since gone back
 * on. It is kept too when it expects the file under the same name: it says
 * as much, and may be the app's, which has also seen the file. Otherwise it
 * is replaced, and what it knew of the file goes into the new one.
 */
export async function noteUnsettledRename({
	projectId,
	rename,
}: {
	projectId: string;
	rename: UnsettledRename;
}): Promise<void> {
	const key = await unsettledRenameKey({ projectId, rename });
	const noted = noteOf(await platform().storage.load(key));
	if (noted && (noted.decided || noted.oldId === rename.oldId)) return;
	const saved = await platform().storage.save(
		key,
		rename.file || !noted?.file ? rename : { ...rename, file: noted.file }
	);
	if (saved === false) {
		throw new Error("The note of an unsettled rename could not be saved");
	}
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
 * has taken a name since: the renamed file is then known by what the
 * desktop app noted of it, and where that does not tell them apart, the
 * name the note expects is taken.
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
	const underNew =
		note.file !== undefined &&
		isNotedFile(atNew, note.file) &&
		!isNotedFile(atOld, note.file);
	return { name: underNew ? "new" : "old", otherNameTaken: true };
}

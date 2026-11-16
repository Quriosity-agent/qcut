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
 * (`settleUnsettledMediaRenames`).
 *
 * The desktop app keeps the notes
 * (electron/claude/handlers/claude-media-rename-note.ts). It writes them:
 * before it moves the file, and again once it knows where it has left it.
 * It says of each whether it is at work on the rename at this moment. And
 * it drops one when the editor says it has settled it. The app has the file
 * in view; the editor knows only where a request wanted the file, which may
 * be a request the app has since gone back on. So the editor reads the
 * notes, settles those the app is not at work on, and has them dropped.
 *
 * @module stores/media/media-rename-notes
 */
import { platform } from "@qcut/platform-core";
import {
	readSourceFileStat,
	sameSourceFile,
} from "@/lib/project/media-source-stat";
import type { MediaItem } from "./media-store-types";

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
	/**
	 * When the desktop app began the rename, before it moved the file (epoch
	 * milliseconds). Until then the file had its old name, and no other file
	 * could have had it.
	 */
	beganAt?: number;
	/**
	 * When the note was written (epoch milliseconds). No two notes of a
	 * rename have the same: it tells the note read here from a later one.
	 */
	notedAt: number;
	/**
	 * The desktop app is at work on the rename at this moment: the file may
	 * still move, and the rename is the app's to see through.
	 */
	atWork: boolean;
}

/** A rename and its undoing are one matter, and have one note. */
type RenamePair = Pick<UnsettledRename, "newId" | "oldId">;

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
	const { notedAt, fileIs, beganAt, atWork } = record;
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
		...(typeof beganAt === "number" && Number.isFinite(beganAt)
			? { beganAt }
			: {}),
		notedAt,
		// Only the app's plain "no" lets the editor settle a rename.
		atWork: atWork !== false,
	};
}

/**
 * The renames noted for a project, as the desktop app holds them now. Only
 * the desktop app renames files and keeps notes of it: elsewhere there are
 * none.
 */
export async function readUnsettledRenames(
	projectId: string
): Promise<UnsettledRename[]> {
	const media = platform().claude?.media;
	if (!media?.unsettledRenames) return [];
	const notes: UnsettledRename[] = [];
	for (const candidate of await media.unsettledRenames(projectId)) {
		const note = noteOf(candidate);
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
	const pair = [rename.newId, rename.oldId].sort().join("\n");
	return (await readUnsettledRenames(projectId)).find(
		(note) => [note.newId, note.oldId].sort().join("\n") === pair
	);
}

/**
 * Has the desktop app drop the note of a rename the editor has settled, and
 * answers whether it is gone. The app keeps it when it is at work on the
 * rename (again), or has written the note since the one given here was
 * read: what the note says by then is still to be settled.
 */
export async function forgetUnsettledRename({
	projectId,
	rename,
}: {
	projectId: string;
	rename: Pick<UnsettledRename, "newId" | "oldId" | "notedAt">;
}): Promise<boolean> {
	const media = platform().claude?.media;
	if (!media?.forgetSettledRename) return false;
	const gone = await media.forgetSettledRename({
		projectId,
		oldId: rename.oldId,
		newId: rename.newId,
		notedAt: rename.notedAt,
	});
	return gone === true;
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
 * where the app says it left it. And if the app never said, nothing tells
 * which it is ("unclear"): it may have gone back and another file taken the
 * new name, or stayed and another file taken the old one.
 */
export async function whereNotedFileIs(
	note: UnsettledRename
): Promise<NotedFilePlace | "nowhere" | "unclear" | undefined> {
	const atOld = await fileAt(note.oldPath);
	const atNew = await fileAt(note.newPath);
	if (atOld === undefined || atNew === undefined) return;
	if (!atOld && !atNew) return "nowhere";
	if (!atOld) return { name: "new", otherNameTaken: false };
	if (!atNew) return { name: "old", otherNameTaken: false };
	const looksLike = (seen: Partial<NotedFile>) =>
		note.file !== undefined && isNotedFile(seen, note.file);
	if (looksLike(atNew) !== looksLike(atOld)) {
		return { name: looksLike(atNew) ? "new" : "old", otherNameTaken: true };
	}
	return note.fileIs ? { name: note.fileIs, otherNameTaken: true } : "unclear";
}

/**
 * Whose a media item is that the project holds under the name the renamed
 * file left, now that another file has that name: the renamed file's own,
 * which the editor has not brought over yet, or an item of the other file,
 * imported since, with clips of its own.
 *
 * Two things together make it the renamed file's. The editor held it before
 * the app began the rename: until then the name was the renamed file's, and
 * no other file can have had it. And it was copied from a file that looks
 * as the app noted the renamed file. Neither is enough alone: two files can
 * have one size and time, and an item of a file long gone from that name
 * was held before the rename too.
 *
 * It is another file's when both say so: it was not held before the rename
 * began, as far as is recorded, and was copied from a file that does not
 * look like the renamed one. Everything in between is not known, and
 * nothing is to be changed on it: an item with no record of when the editor
 * came to hold it, a note that does not say what the file looked like or
 * when the rename began.
 */
export function whoseItemIs({
	item,
	note,
}: {
	item: Pick<MediaItem, "file" | "metadata">;
	note: UnsettledRename;
}): "the renamed file's" | "another file's" | "unknown" {
	if (!note.file) return "unknown";
	const copiedFrom = readSourceFileStat({ item });
	if (!copiedFrom) {
		// From before the record was kept: the size of its copy is all there
		// is, and a copy of another size is not the renamed file's.
		return item.file.size === note.file.size ? "unknown" : "another file's";
	}
	const looksLikeIt = sameSourceFile(copiedFrom, note.file);
	const heldBeforeRename =
		copiedFrom.heldSince !== undefined &&
		note.beganAt !== undefined &&
		copiedFrom.heldSince < note.beganAt;
	if (looksLikeIt && heldBeforeRename) return "the renamed file's";
	if (!looksLikeIt && !heldBeforeRename) return "another file's";
	return "unknown";
}

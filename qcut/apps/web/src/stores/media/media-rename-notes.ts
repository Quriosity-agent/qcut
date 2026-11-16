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
 * So such a rename is noted, in the desktop app's key-value store beside
 * the project's, and settled from what the project folder holds the next
 * time the project is open (`settleUnsettledMediaRenames`). A note is a
 * record of its own, under a key made of the project and the two ids: the
 * editor writes one when it knows, and so does the desktop app before it
 * puts a file back without the editor's word
 * (electron/claude/handlers/claude-media-rename-note.ts makes the same key).
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

type RenamePair = Pick<UnsettledRename, "newId" | "oldId">;

const keyPrefix = (projectId: string) => `media-rename-unsettled-${projectId}-`;

/**
 * The key of the note for one pair of ids. Ids follow file names and can be
 * long, and a key becomes a file name: the pair goes in as a digest.
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
		new TextEncoder().encode(`${rename.newId}\n${rename.oldId}`)
	);
	const hex = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0")
	).join("");
	return `${keyPrefix(projectId)}${hex.slice(0, 32)}`;
}

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
		const stored = await platform().storage.load(key);
		if (isUnsettledRename(stored)) notes.push(stored);
	}
	return notes;
}

/** Notes a rename to be settled; one note per pair of ids. */
export async function noteUnsettledRename({
	projectId,
	rename,
}: {
	projectId: string;
	rename: UnsettledRename;
}): Promise<void> {
	const saved = await platform().storage.save(
		await unsettledRenameKey({ projectId, rename }),
		rename
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

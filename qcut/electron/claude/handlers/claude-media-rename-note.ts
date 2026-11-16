/**
 * The desktop app's note of a media rename the editor may not have settled.
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
 * The note is one record in the app's key-value store, under the key the
 * editor looks it up by (media-rename-notes.ts): written here and nowhere
 * else, read by the editor, and removed by whoever has seen the editor and
 * the folder agree. Main process only.
 *
 * While a rename is under way its note is written again every minute. A
 * rename can take long (a large file copied on a volume without hard
 * links), and the editor must not settle a note the app is still at work
 * on: it would end where the file is about to leave. So the editor leaves
 * alone a note that does not say where the file was left for as long as it
 * is kept fresh, and takes one that has gone stale for a rename the app has
 * left (it ended, or its last word could not be written).
 *
 * @module electron/claude/handlers/claude-media-rename-note
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { app } from "electron";
import {
	removeStorageJson,
	writeStorageJson,
} from "../../main-ipc/storage-json.js";
import type { RenamedMediaFile } from "./claude-media-rename.js";

/**
 * Where the renamed file is when a note is written:
 * - `moving`: about to get its new name, or under it and still to be
 *   followed or put back. The folder settles nothing yet, and the editor
 *   leaves the note alone for a while.
 * - `back`: under its old name again.
 * - `stays`: it could not be put back, and keeps its new name.
 */
export type RenamedFileStage = "moving" | "back" | "stays";

/** How often the note of a rename that is under way is written again. */
export const RENAME_NOTE_FRESH_EVERY_MS = 60_000;

/** The notes of the renames this app is at work on, and what keeps each fresh. */
const underWay = new Map<string, NodeJS.Timeout>();

function stopKeepingFresh(filePath: string): void {
	const upkeep = underWay.get(filePath);
	if (!upkeep) return;
	clearInterval(upkeep);
	underWay.delete(filePath);
}

/**
 * The renames that were under way have ended without a last word: the
 * process that was making them is gone. Their notes are no longer kept
 * fresh, so that the editor settles them.
 */
export function noLongerAtWorkOnMediaRenames(): void {
	for (const upkeep of underWay.values()) clearInterval(upkeep);
	underWay.clear();
}

/**
 * The same key as `unsettledRenameKey` in the editor's notes makes: one for
 * the two ids, whichever way round.
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
	return `media-rename-unsettled-${projectId}-${digest.slice(0, 32)}`;
}

function notePath({
	projectId,
	renamed,
}: {
	projectId: string;
	renamed: RenamedMediaFile;
}): string {
	const key = unsettledRenameKey({
		projectId,
		newId: renamed.id,
		oldId: renamed.previous.id,
	});
	return path.join(
		app.getPath("userData"),
		"projects",
		`${path.basename(key)}.json`
	);
}

/**
 * Notes a rename for the editor to settle when the project is next open.
 *
 * The note names the file before and after the rename, says where the app
 * left it once it is done moving it (`fileIs`), and what the file looked
 * like: its size and the time it was last changed, as the editor is shown
 * them (get-file-info). Another file can take one of the two names
 * meanwhile, and is told from the renamed one by these.
 *
 * A note of a file that may still move (`moving`) is kept fresh from here
 * on, until the next note of the rename, its removal, or the end of the
 * process that is making the rename.
 */
export async function noteUnsettledMediaRename({
	projectId,
	renamed,
	stage = "moving",
}: {
	projectId: string;
	renamed: RenamedMediaFile;
	stage?: RenamedFileStage;
}): Promise<void> {
	const before = renamed.previous;
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
	const filePath = notePath({ projectId, renamed });
	// The rename has come this far whatever becomes of this note: a note
	// that cannot be written leaves the last one to go stale.
	stopKeepingFresh(filePath);
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
	};
	await writeStorageJson({ filePath, data: { ...note, notedAt: Date.now() } });
	if (stage !== "moving") return;
	const upkeep = setInterval(() => {
		writeStorageJson({
			filePath,
			data: { ...note, notedAt: Date.now() },
		}).catch(() => undefined);
	}, RENAME_NOTE_FRESH_EVERY_MS);
	// It is not what keeps the app running.
	upkeep.unref();
	underWay.set(filePath, upkeep);
}

/** Drops the note of a rename: the editor and the folder are known to agree. */
export async function forgetUnsettledMediaRename({
	projectId,
	renamed,
}: {
	projectId: string;
	renamed: RenamedMediaFile;
}): Promise<void> {
	const filePath = notePath({ projectId, renamed });
	stopKeepingFresh(filePath);
	await removeStorageJson({ filePath });
}

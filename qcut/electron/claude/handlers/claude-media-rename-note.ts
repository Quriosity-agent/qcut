/**
 * The desktop app's note of a media rename the editor may not have settled.
 *
 * The rename route puts a file back under its old name when the editor did
 * not follow the rename. When the editor's answer did not come, or says it
 * could not take everything back, the editor may still name the new id, and
 * it may not be able to say so later (it is busy, it was reloaded, its own
 * note could not be written). And a file that cannot be put back keeps a
 * name the editor has left. So the route notes the rename itself, before it
 * moves the file: the editor settles every noted rename from what the
 * folder holds when the project has next finished loading
 * (apps/web/src/stores/media/media-rename.ts).
 *
 * The note is one record in the app's key-value store, under the key the
 * editor's own notes use (media-rename-notes.ts): written by either, read
 * by the editor, and removed by whoever has seen the editor and the folder
 * agree. Main process only.
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
 * - `moving`: under its new name, about to be put back. The folder settles
 *   nothing yet, and the editor leaves the note alone for a while.
 * - `back`: under its old name again.
 * - `stays`: it could not be put back, and keeps its new name.
 */
export type RenamedFileStage = "moving" | "back" | "stays";

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
 * The note says under which name the file is expected (its old one, unless
 * it stays renamed), whether the app is done moving it, and what the file
 * looked like: its size and the time it was last changed, as the editor is
 * shown them (get-file-info). Another file can take one of the two names
 * meanwhile, and is told from the renamed one by these.
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
	const [expected, other] =
		stage === "stays" ? [renamed, before] : [before, renamed];
	const seen = await fs
		.stat(stage === "back" ? before.path : renamed.path)
		.catch(() => undefined);
	await writeStorageJson({
		filePath: notePath({ projectId, renamed }),
		data: {
			newId: other.id,
			newName: other.name,
			newPath: other.path,
			oldId: expected.id,
			oldName: expected.name,
			oldPath: expected.path,
			...(seen?.isFile()
				? { file: { size: seen.size, modifiedAt: seen.mtime.getTime() } }
				: {}),
			...(stage === "moving" ? {} : { decided: true }),
			notedAt: Date.now(),
		},
	});
}

/** Drops the note of a rename: the editor and the folder are known to agree. */
export async function forgetUnsettledMediaRename({
	projectId,
	renamed,
}: {
	projectId: string;
	renamed: RenamedMediaFile;
}): Promise<void> {
	await removeStorageJson({ filePath: notePath({ projectId, renamed }) });
}

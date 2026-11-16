/**
 * The desktop app's note of a media rename the editor may not have settled.
 *
 * The rename route puts a file back under its old name when the editor did
 * not follow the rename. When the editor's answer did not come, or says it
 * could not take everything back, the editor may still name the new id, and
 * it may not be able to say so later (it is busy, it was reloaded, its own
 * note could not be written). So the route notes the rename itself, before
 * the file goes back: the editor settles every noted rename from what the
 * folder holds when the project has next finished loading
 * (apps/web/src/stores/media/media-rename.ts).
 *
 * The note is one record in the app's key-value store, under the key the
 * editor's own notes use (media-rename-notes.ts): written by either, read
 * and removed by the editor. Main process only.
 *
 * @module electron/claude/handlers/claude-media-rename-note
 */
import { createHash } from "node:crypto";
import * as path from "node:path";
import { app } from "electron";
import { writeStorageJson } from "../../main-ipc/storage-json.js";
import type { RenamedMediaFile } from "./claude-media-rename.js";

/** The same key as `unsettledRenameKey` in the editor's notes makes. */
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
		.update(`${newId}\n${oldId}`, "utf8")
		.digest("hex");
	return `media-rename-unsettled-${projectId}-${digest.slice(0, 32)}`;
}

/** Notes a rename for the editor to settle when the project is next open. */
export async function noteUnsettledMediaRename({
	projectId,
	renamed,
}: {
	projectId: string;
	renamed: RenamedMediaFile;
}): Promise<void> {
	const key = unsettledRenameKey({
		projectId,
		newId: renamed.id,
		oldId: renamed.previous.id,
	});
	await writeStorageJson({
		filePath: path.join(
			app.getPath("userData"),
			"projects",
			`${path.basename(key)}.json`
		),
		data: {
			newId: renamed.id,
			newName: renamed.name,
			newPath: renamed.path,
			oldId: renamed.previous.id,
			oldName: renamed.previous.name,
			oldPath: renamed.previous.path,
			notedAt: Date.now(),
		},
	});
}

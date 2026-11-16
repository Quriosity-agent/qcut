/**
 * What the rename route does when it cannot tell where the editor stands.
 *
 * The route renames the file, then waits for the editor to follow. When the
 * editor's answer does not come in time, the editor may have finished all
 * the same; when its answer says it could not take everything back, part of
 * the project still names the new id. Putting the file back then leaves the
 * two apart. So the editor is first asked to end on the old id, in a
 * request that has no deadline: the file has that name for good.
 *
 * @module electron/claude/http/claude-http-media-rename-settle
 */
import type { ClaudeMediaRenamedEvent } from "../../types/claude-media-bridge-api.js";
import type { RenamedMediaFile } from "../handlers/claude-media-rename.js";
import { claudeLog } from "../utils/logger.js";

/**
 * Whether a failed rename leaves it open where the editor stands: its
 * answer did not come, or says that not everything was taken back (the
 * editor's own words, see `renameProjectMedia`).
 */
export function mediaRenameOutcomeUnknown({
	reason,
}: {
	reason: string;
}): boolean {
	return /timed out|timeout|Not everything could be taken back/i.test(reason);
}

/**
 * Asks the editor to end on the id the file had before the rename. Answers
 * why it did not confirm, or null when it did.
 */
async function settleMediaRenameInEditor({
	requestMediaRename,
	projectId,
	renamed,
}: {
	requestMediaRename: (
		payload: Omit<ClaudeMediaRenamedEvent, "requestId">
	) => Promise<void>;
	projectId: string;
	renamed: RenamedMediaFile;
}): Promise<string | null> {
	try {
		await requestMediaRename({
			projectId,
			mediaId: renamed.id,
			newMediaId: renamed.previous.id,
			newName: renamed.previous.name,
			newPath: renamed.previous.path,
			previousName: renamed.name,
			previousPath: renamed.path,
			settles: true,
		});
		return null;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		claudeLog.warn(
			"HTTP",
			`The editor did not confirm that it is back on ${renamed.previous.id}: ${reason}`
		);
		return reason;
	}
}

/**
 * Before a file goes back under its old name without the editor's word:
 * notes the rename, then asks the editor to end on the old id.
 *
 * The note comes first and is the desktop app's own, so that it is there
 * whatever becomes of the editor: its answer may not come, it may be
 * reloaded before it gets to the request, and its own note may not be
 * written. The editor settles a noted rename from what the folder holds
 * when the project has next finished loading, and drops the note once it
 * has ended on the old id.
 *
 * Answers what to tell the caller when the editor did not confirm, null
 * when it did. Nothing is promised that is not in place: without a note
 * the caller is told that the project may still name the new id.
 */
export async function settleUnknownMediaRename({
	accessor,
	requestMediaRename,
	projectId,
	renamed,
}: {
	accessor: {
		noteUnsettledMediaRename?(payload: {
			projectId: string;
			renamed: RenamedMediaFile;
		}): Promise<void>;
	};
	requestMediaRename: (
		payload: Omit<ClaudeMediaRenamedEvent, "requestId">
	) => Promise<void>;
	projectId: string;
	renamed: RenamedMediaFile;
}): Promise<string | null> {
	let notNoted: string | null = null;
	try {
		if (!accessor.noteUnsettledMediaRename) {
			throw new Error("this server cannot note it");
		}
		await accessor.noteUnsettledMediaRename({ projectId, renamed });
	} catch (error) {
		notNoted = error instanceof Error ? error.message : String(error);
		claudeLog.warn(
			"HTTP",
			`The rename of ${renamed.previous.id} could not be noted for the editor to settle: ${notNoted}`
		);
	}
	const unconfirmed = await settleMediaRenameInEditor({
		requestMediaRename,
		projectId,
		renamed,
	});
	if (unconfirmed === null) return null;
	const stand = `the editor did not confirm that it names ${renamed.previous.id} again (${unconfirmed})`;
	return notNoted === null
		? `${stand}; it puts that right when the project is next opened. Check the timeline before the rename is tried again`
		: `${stand}, and the rename could not be noted for it to put right later (${notNoted}): the project may still name ${renamed.id}. Check the timeline (editor:timeline:export) and the media list before the rename is tried again`;
}

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
export async function settleMediaRenameInEditor({
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

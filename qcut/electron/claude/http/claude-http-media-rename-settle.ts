/**
 * What the rename route does with a rename the editor did not follow.
 *
 * The route renames the file, then waits for the editor to follow. When the
 * editor does not, the file goes back under its old name. Three things can
 * leave the editor and the folder apart on the way, and each is seen to:
 *
 * - Where the editor stands is not known: its answer did not come in time
 *   (it may have finished all the same), or says it could not take
 *   everything back. The editor is asked to end on the old id, in a request
 *   that has no deadline, before the file goes back.
 * - The file cannot be put back (its old name was taken meanwhile, or the
 *   folder refuses). The editor has left a name the file keeps, so it is
 *   asked to follow the file after all. When it confirms, the rename stands.
 * - The editor cannot be asked, or does not confirm: it is busy, it was
 *   reloaded, its window is gone. The rename is therefore noted by the
 *   desktop app itself before the file is moved, and the note is kept until
 *   the editor is known to be where the file is. The editor settles a noted
 *   rename from what the folder holds when the project has next finished
 *   loading.
 *
 * @module electron/claude/http/claude-http-media-rename-settle
 */
import type { ClaudeMediaRenamedEvent } from "../../types/claude-media-bridge-api.js";
import {
	type RenamedMediaFile,
	undoMediaRename,
} from "../handlers/claude-media-rename.js";
import type { RenamedFileStage } from "../handlers/claude-media-rename-note.js";
import { HttpError } from "../utils/http-router.js";
import { claudeLog } from "../utils/logger.js";

type RequestMediaRename = (
	payload: Omit<ClaudeMediaRenamedEvent, "requestId">
) => Promise<void>;

/** The desktop app's notes of renames the editor may not have settled. */
export interface MediaRenameNotes {
	noteUnsettledMediaRename?(payload: {
		projectId: string;
		renamed: RenamedMediaFile;
		stage: RenamedFileStage;
	}): Promise<void>;
	forgetUnsettledMediaRename?(payload: {
		projectId: string;
		renamed: RenamedMediaFile;
	}): Promise<void>;
}

const messageOf = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/**
 * Whether a failed rename leaves it open where the editor stands: its
 * answer did not come, or says that not everything was taken back (the
 * editor's own words, see `renameProjectMedia`).
 */
function mediaRenameOutcomeUnknown({ reason }: { reason: string }): boolean {
	return /timed out|timeout|Not everything could be taken back/i.test(reason);
}

/**
 * Asks the editor to end on one of the file's two names: the one it had
 * (`old`), or the one the rename gave it (`new`). Answers why it did not
 * confirm, or null when it did.
 */
async function askEditorToEndOn({
	requestMediaRename,
	projectId,
	renamed,
	name,
}: {
	requestMediaRename: RequestMediaRename;
	projectId: string;
	renamed: RenamedMediaFile;
	name: "old" | "new";
}): Promise<string | null> {
	const [to, from] =
		name === "old" ? [renamed.previous, renamed] : [renamed, renamed.previous];
	try {
		await requestMediaRename({
			projectId,
			mediaId: from.id,
			newMediaId: to.id,
			newName: to.name,
			newPath: to.path,
			previousName: from.name,
			previousPath: from.path,
			settles: true,
		});
		return null;
	} catch (error) {
		const reason = messageOf(error);
		claudeLog.warn(
			"HTTP",
			`The editor did not confirm that it names ${to.id} and not ${from.id}: ${reason}`
		);
		return reason;
	}
}

/**
 * The app's note of one rename, as the route keeps it: written again as the
 * file moves, dropped when the editor is known to be where the file is.
 * Neither can fail the route; what could not be written is told to the
 * caller instead (`outlook`).
 */
function noteOf({
	accessor,
	projectId,
	renamed,
}: {
	accessor: MediaRenameNotes;
	projectId: string;
	renamed: RenamedMediaFile;
}) {
	let inPlace = false;
	let notNoted = "";
	return {
		async write(stage: RenamedFileStage): Promise<void> {
			try {
				if (!accessor.noteUnsettledMediaRename) {
					throw new Error("this server cannot note it");
				}
				await accessor.noteUnsettledMediaRename({ projectId, renamed, stage });
				inPlace = true;
			} catch (error) {
				notNoted = messageOf(error);
				claudeLog.warn(
					"HTTP",
					`The rename of ${renamed.previous.id} could not be noted for the editor to settle: ${notNoted}`
				);
			}
		},
		async drop(): Promise<void> {
			if (!inPlace) return;
			// A note left behind is settled by the editor, and changes nothing.
			await accessor
				.forgetUnsettledMediaRename?.({ projectId, renamed })
				.catch((error: unknown) => {
					claudeLog.warn(
						"HTTP",
						`The note of the rename of ${renamed.previous.id} could not be removed: ${messageOf(error)}`
					);
				});
		},
		/**
		 * What becomes of an editor that did not confirm. Nothing is promised
		 * that is not in place: without a note the caller is told which id
		 * the project may still name.
		 */
		outlook({ mayStillName }: { mayStillName: string }): string {
			return inPlace
				? "; it puts that right when the project is next opened. Check the timeline before the rename is tried again"
				: `, and the rename could not be noted for it to put right later (${notNoted}): the project may still name ${mayStillName}. Check the timeline (editor:timeline:export) and the media list before the rename is tried again`;
		},
	};
}

/**
 * Sees a rename through that the editor did not follow (`error` is its
 * refusal, or the lack of an answer).
 *
 * The file is put back under its old name, and the failure is thrown: as it
 * was when the editor is known to be on the old id, with what remains open
 * when it is not. When the file cannot be put back and the editor then
 * follows it, the rename stands after all, and this returns a warning to
 * hand to the caller with the result.
 */
export async function settleUnfollowedMediaRename({
	accessor,
	requestMediaRename,
	projectId,
	renamed,
	error,
}: {
	accessor: MediaRenameNotes;
	requestMediaRename: RequestMediaRename;
	projectId: string;
	renamed: RenamedMediaFile;
	error: unknown;
}): Promise<{ warning: string }> {
	const reason = messageOf(error);
	const note = noteOf({ accessor, projectId, renamed });
	const { previous } = renamed;

	// The note comes first, so that it is there whatever becomes of the
	// editor: the request may never reach it.
	let onOldId: string | null = null;
	if (mediaRenameOutcomeUnknown({ reason })) {
		await note.write("moving");
		onOldId = await askEditorToEndOn({
			requestMediaRename,
			projectId,
			renamed,
			name: "old",
		});
	}

	const notPutBack = await undoMediaRename({ projectId, renamed }).then(
		() => null,
		(undoError: unknown) => messageOf(undoError)
	);
	if (notPutBack === null) {
		if (onOldId === null) {
			await note.drop();
			throw error;
		}
		await note.write("back");
		throw new HttpError(
			error instanceof HttpError ? error.status : 500,
			`${reason}. The file is back under ${previous.name}, but the editor did not confirm that it names ${previous.id} again (${onOldId})${note.outlook({ mayStillName: renamed.id })}`
		);
	}

	// The file keeps its new name, which the editor has left or never took.
	await note.write("stays");
	const following = await askEditorToEndOn({
		requestMediaRename,
		projectId,
		renamed,
		name: "new",
	});
	if (following === null) {
		await note.drop();
		return {
			warning: `The editor did not follow the rename at first (${reason}), and the file could not be put back under ${previous.name} (${notPutBack}). The editor has followed the renamed file since: the rename stands.`,
		};
	}
	throw new HttpError(
		500,
		`${reason}. The file stays renamed to ${renamed.name} (${renamed.id}), and putting it back failed: ${notPutBack}. The editor did not confirm that it follows the renamed file (${following})${note.outlook({ mayStillName: previous.id })}`
	);
}

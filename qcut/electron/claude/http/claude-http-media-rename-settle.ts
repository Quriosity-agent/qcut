/**
 * How the rename route keeps the editor and the folder together.
 *
 * The route renames the file, then waits for the editor to follow. When the
 * editor does not, the file goes back under its old name. Between the first
 * move of the file and the editor's last word, the two can be apart, and
 * each way of that is seen to:
 *
 * - Every rename is noted by the desktop app before the file is moved, and
 *   a rename that cannot be noted is not made. The note is kept until the
 *   editor is known to be where the file is, and says where the file is as
 *   it moves. The editor settles a rename that is still noted from what the
 *   folder holds, when the project has next finished loading: whatever
 *   becomes of the editor or of this request, a record is there.
 * - Where the editor stands is not known: its answer did not come in time
 *   (it may have finished all the same), or says it could not take
 *   everything back. The editor is asked to end on the old id, in a request
 *   that has no deadline, before the file goes back.
 * - The file cannot be put back (its old name was taken meanwhile, or the
 *   folder refuses). The editor has left a name the file keeps, so it is
 *   asked to follow the file after all. When it confirms, the rename stands.
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
	noteUnsettledMediaRename(payload: {
		projectId: string;
		renamed: RenamedMediaFile;
		stage: RenamedFileStage;
	}): Promise<void>;
	forgetUnsettledMediaRename(payload: {
		projectId: string;
		renamed: RenamedMediaFile;
	}): Promise<void>;
}

/** What an editor that did not confirm is left with: the note. */
const PUT_RIGHT_LATER =
	"; it puts that right when the project is next opened. Check the timeline before the rename is tried again";

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
 * Drops the note of a rename that needs none any more: the editor is where
 * the file is, or the file was not moved. A note that cannot be dropped is
 * left; the editor settles it and finds nothing to change.
 */
export async function forgetSettledMediaRename({
	notes,
	projectId,
	renamed,
}: {
	notes: MediaRenameNotes;
	projectId: string;
	renamed: RenamedMediaFile;
}): Promise<void> {
	try {
		await notes.forgetUnsettledMediaRename({ projectId, renamed });
	} catch (error) {
		claudeLog.warn(
			"HTTP",
			`The note of the rename of ${renamed.previous.id} could not be removed: ${messageOf(error)}`
		);
	}
}

/**
 * What a rename on disk is given so that no file is moved unnoted
 * (`renameMediaFileOnDisk`).
 *
 * The note is written while the file still has its old name. A rename that
 * cannot be noted is not made: nothing has changed then, and the caller is
 * told so. From the move on, the note is the record that outlasts the
 * editor, this request and the app itself.
 */
export function notedMove({
	notes,
	projectId,
}: {
	notes: MediaRenameNotes;
	projectId: string;
}): {
	beforeMove: (planned: RenamedMediaFile) => Promise<void>;
	notMoved: (planned: RenamedMediaFile) => Promise<void>;
} {
	return {
		beforeMove: async (planned) => {
			try {
				await notes.noteUnsettledMediaRename({
					projectId,
					renamed: planned,
					stage: "moving",
				});
			} catch (error) {
				throw new HttpError(
					500,
					`The rename could not be noted for the editor to settle (${messageOf(error)}), so it was not made: nothing was changed`
				);
			}
		},
		notMoved: (planned) =>
			forgetSettledMediaRename({ notes, projectId, renamed: planned }),
	};
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
 * Sees a rename through that the editor did not follow (`error` is its
 * refusal, or the lack of an answer). The rename was noted before the file
 * was moved (`notedMove`).
 *
 * The file is put back under its old name, and the failure is thrown: as it
 * was when the editor is known to be on the old id, with what remains open
 * when it is not. When the file cannot be put back and the editor then
 * follows it, the rename stands after all, and this returns a warning to
 * hand to the caller with the result.
 *
 * The note is dropped when the editor is known to be where the file ended,
 * and otherwise says where that is. Writing that can fail without harm: the
 * note made before the move is still there, and tells the file by its size
 * and time.
 */
export async function settleUnfollowedMediaRename({
	notes,
	requestMediaRename,
	projectId,
	renamed,
	error,
}: {
	notes: MediaRenameNotes;
	requestMediaRename: RequestMediaRename;
	projectId: string;
	renamed: RenamedMediaFile;
	error: unknown;
}): Promise<{ warning: string }> {
	const reason = messageOf(error);
	const { previous } = renamed;
	const noteThatFileIs = async (stage: RenamedFileStage): Promise<void> => {
		try {
			await notes.noteUnsettledMediaRename({ projectId, renamed, stage });
		} catch (noteError) {
			claudeLog.warn(
				"HTTP",
				`The note of the rename of ${previous.id} could not be brought up to date: ${messageOf(noteError)}`
			);
		}
	};

	const onOldId = mediaRenameOutcomeUnknown({ reason })
		? await askEditorToEndOn({
				requestMediaRename,
				projectId,
				renamed,
				name: "old",
			})
		: null;

	const notPutBack = await undoMediaRename({ projectId, renamed }).then(
		() => null,
		(undoError: unknown) => messageOf(undoError)
	);
	if (notPutBack === null) {
		if (onOldId === null) {
			await forgetSettledMediaRename({ notes, projectId, renamed });
			throw error;
		}
		await noteThatFileIs("back");
		throw new HttpError(
			error instanceof HttpError ? error.status : 500,
			`${reason}. The file is back under ${previous.name}, but the editor did not confirm that it names ${previous.id} again (${onOldId})${PUT_RIGHT_LATER}`
		);
	}

	// The file keeps its new name, which the editor has left or never took.
	await noteThatFileIs("stays");
	const following = await askEditorToEndOn({
		requestMediaRename,
		projectId,
		renamed,
		name: "new",
	});
	if (following === null) {
		await forgetSettledMediaRename({ notes, projectId, renamed });
		return {
			warning: `The editor did not follow the rename at first (${reason}), and the file could not be put back under ${previous.name} (${notPutBack}). The editor has followed the renamed file since: the rename stands.`,
		};
	}
	throw new HttpError(
		500,
		`${reason}. The file stays renamed to ${renamed.name} (${renamed.id}), and putting it back failed: ${notPutBack}. The editor did not confirm that it follows the renamed file (${following})${PUT_RIGHT_LATER}`
	);
}

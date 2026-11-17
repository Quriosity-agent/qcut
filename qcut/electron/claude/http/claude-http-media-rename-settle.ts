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
 * - While this request may still move the file, the editor does not settle
 *   the rename by itself: the app knows that it is at work on it, from the
 *   first note until it says where it left the file, and at the latest
 *   until the request is over (`notedMove`).
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

/**
 * The desktop app's notes of renames the editor may not have settled, for
 * one request: what it says of a rename is said in its own name.
 */
export interface MediaRenameNotes {
	noteUnsettledMediaRename(payload: {
		projectId: string;
		renamed: RenamedMediaFile;
		stage: RenamedFileStage;
	}): Promise<void>;
	forgetUnsettledMediaRename(payload: {
		projectId: string;
		renamed: RenamedMediaFile;
		/**
		 * The file was not moved after all: what was noted of the two names
		 * before this rename began is as it was.
		 */
		unmoved?: boolean;
	}): Promise<void>;
}

/**
 * The same notes as a server reaches them: every word names the request
 * that says it (`by`), so that the app tells one request's rename from
 * another's between the same two names.
 */
export interface MediaRenameNoteAccess {
	noteUnsettledMediaRename(
		payload: Parameters<MediaRenameNotes["noteUnsettledMediaRename"]>[0] & {
			by: string;
		}
	): Promise<void>;
	forgetUnsettledMediaRename(
		payload: Parameters<MediaRenameNotes["forgetUnsettledMediaRename"]>[0] & {
			by: string;
		}
	): Promise<void>;
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
 * the file is, or the file was not moved (`unmoved`: an earlier rename
 * between the same two names that is still noted stays noted). A note that
 * cannot be dropped is left; the editor settles it and finds nothing to
 * change.
 */
export async function forgetSettledMediaRename({
	notes,
	projectId,
	renamed,
	unmoved = false,
}: {
	notes: MediaRenameNotes;
	projectId: string;
	renamed: RenamedMediaFile;
	unmoved?: boolean;
}): Promise<void> {
	try {
		await notes.forgetUnsettledMediaRename({
			projectId,
			renamed,
			...(unmoved ? { unmoved } : {}),
		});
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
 *
 * With that note the app is at work on the rename, and the editor leaves
 * it alone. `left` ends that, and is to be called when the request is
 * over, however it went: the note that is there then is the editor's to
 * settle. It is said for every rename this request set out to note, also
 * one whose note may not have got through: the app may have it all the
 * same, and nothing else would end it.
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
	left: () => Promise<void>;
} {
	const begun: RenamedMediaFile[] = [];
	return {
		beforeMove: async (planned) => {
			begun.push(planned);
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
			forgetSettledMediaRename({
				notes,
				projectId,
				renamed: planned,
				unmoved: true,
			}),
		left: async () => {
			for (const planned of begun) {
				try {
					await notes.noteUnsettledMediaRename({
						projectId,
						renamed: planned,
						stage: "left",
					});
				} catch (error) {
					// It is at work on it until the process serving requests ends.
					claudeLog.warn(
						"HTTP",
						`The app was not told that the rename of ${planned.previous.id} is over: ${messageOf(error)}`
					);
				}
			}
		},
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

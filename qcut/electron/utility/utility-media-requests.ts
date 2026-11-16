/**
 * What the utility process has the main process do for media where no
 * window is needed: every change to a restricted file's metadata, and the
 * notes of renames. The main process alone changes both
 * (claude-media-restricted-metadata.ts and claude-media-rename-note.ts say
 * why); its side of these requests is in utility-media-bridge.ts.
 *
 * Nothing here loads a main-process module: only what is asked, and how.
 *
 * @module electron/utility/utility-media-requests
 */
import type { RestrictedMetadataChanges } from "../claude/handlers/claude-media-restricted-metadata.js";
import type { MediaRenameNoteAccess } from "../claude/http/claude-http-media-rename-settle.js";
import type { UtilityRequestFromMain } from "./utility-timeline-accessor.js";

export const RESTRICTED_METADATA_CHANNEL = "media:restricted-metadata";
export const NOTE_RENAME_CHANNEL = "media:note-unsettled-rename";
export const FORGET_RENAME_CHANNEL = "media:forget-unsettled-rename";

/** The changes to restricted metadata, each asked of the main process. */
export function restrictedMetadataChangesThroughMain({
	requestFromMain,
}: {
	requestFromMain: UtilityRequestFromMain;
}): RestrictedMetadataChanges {
	const askMainTo =
		(change: keyof RestrictedMetadataChanges) => (request: unknown) =>
			requestFromMain(RESTRICTED_METADATA_CHANNEL, { change, request });
	return {
		persist: askMainTo("persist") as RestrictedMetadataChanges["persist"],
		stage: askMainTo("stage") as RestrictedMetadataChanges["stage"],
		discard: askMainTo("discard") as RestrictedMetadataChanges["discard"],
		remove: askMainTo("remove") as RestrictedMetadataChanges["remove"],
	};
}

/** The desktop app's notes of renames, as the utility process reaches them. */
export function mediaRenameNotesThroughMain({
	requestFromMain,
}: {
	requestFromMain: UtilityRequestFromMain;
}): MediaRenameNoteAccess {
	return {
		/** Notes a rename for the editor to settle when the project is next open. */
		noteUnsettledMediaRename: (payload) =>
			requestFromMain(NOTE_RENAME_CHANNEL, { payload }) as Promise<void>,
		/** Drops that note: the editor and the folder are known to agree. */
		forgetUnsettledMediaRename: (payload) =>
			requestFromMain(FORGET_RENAME_CHANNEL, { payload }) as Promise<void>,
	};
}

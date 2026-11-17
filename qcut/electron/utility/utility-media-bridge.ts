/**
 * The main process's side of what the utility process asks for media where
 * no window is needed (utility-media-requests.ts has the asking side): a
 * rename is noted, and a restricted file's metadata changed, also when the
 * editor's window is gone.
 *
 * @module electron/utility/utility-media-bridge
 */
import {
	forgetUnsettledMediaRename,
	noteUnsettledMediaRename,
} from "../claude/handlers/claude-media-rename-note.js";
import { changeRestrictedMetadataHere } from "../claude/handlers/claude-media-restricted-metadata.js";
import {
	FORGET_RENAME_CHANNEL,
	NOTE_RENAME_CHANNEL,
	RESTRICTED_METADATA_CHANNEL,
} from "./utility-media-requests.js";

/**
 * Does what one of these requests asks, or answers undefined for a request
 * that is not one of them. `deadline` is when the utility process stops
 * waiting for the answer.
 */
export function handleWindowFreeMediaRequest({
	channel,
	data,
	deadline,
}: {
	channel: string;
	data: Record<string, unknown>;
	deadline?: number;
}): Promise<unknown> | undefined {
	if (channel === RESTRICTED_METADATA_CHANNEL) {
		// What the utility process has stopped waiting for is not made.
		return changeRestrictedMetadataHere({
			...(data as Parameters<typeof changeRestrictedMetadataHere>[0]),
			deadline,
		});
	}
	if (channel === NOTE_RENAME_CHANNEL) {
		const req = data as unknown as {
			payload: Parameters<typeof noteUnsettledMediaRename>[0];
		};
		return noteUnsettledMediaRename(req.payload);
	}
	if (channel === FORGET_RENAME_CHANNEL) {
		const req = data as unknown as {
			payload: Parameters<typeof forgetUnsettledMediaRename>[0];
		};
		return forgetUnsettledMediaRename(req.payload);
	}
	return;
}

import type { BrowserWindow } from "electron";
import type {
	ClaudeMediaDeletedEvent,
	ClaudeMediaImportedEvent,
	ClaudeMediaRefreshEvent,
	ClaudeMediaRefreshResult,
	ClaudeMediaRenamedEvent,
} from "../../types/claude-media-bridge-api.js";
import {
	MEDIA_RENAME_COMMIT_MARGIN_MS,
	MEDIA_RENAME_TIMEOUT_MS,
	mediaRefreshWaitMs,
} from "./claude-media-deadlines.js";
import { requestRendererMutation } from "./claude-renderer-mutation-handler.js";

const MEDIA_IMPORT_CHANNEL = "claude:media:imported" as const;
const MEDIA_IMPORT_RESPONSE_CHANNEL = "claude:media:imported:response" as const;
const MEDIA_DELETE_CHANNEL = "claude:media:deleted" as const;
const MEDIA_DELETE_RESPONSE_CHANNEL = "claude:media:deleted:response" as const;
const MEDIA_RENAME_CHANNEL = "claude:media:renamed" as const;
const MEDIA_RENAME_RESPONSE_CHANNEL = "claude:media:renamed:response" as const;
const MEDIA_REFRESH_CHANNEL = "claude:media:refresh" as const;
const MEDIA_REFRESH_RESPONSE_CHANNEL = "claude:media:refresh:response" as const;
const MEDIA_RENDERER_TIMEOUT_MS = 30_000;

export async function requestMediaImportFromRenderer({
	payload,
	win,
}: {
	payload: Omit<ClaudeMediaImportedEvent, "requestId">;
	win: BrowserWindow;
}): Promise<void> {
	await requestRendererMutation({
		channel: MEDIA_IMPORT_CHANNEL,
		payload,
		requestIdPrefix: "media",
		responseChannel: MEDIA_IMPORT_RESPONSE_CHANNEL,
		timeoutMessage: "Renderer media mutation timed out.",
		timeoutMs: MEDIA_RENDERER_TIMEOUT_MS,
		win,
	});
}

export async function requestMediaDeleteFromRenderer({
	payload,
	win,
}: {
	payload: Omit<ClaudeMediaDeletedEvent, "requestId">;
	win: BrowserWindow;
}): Promise<void> {
	await requestRendererMutation({
		channel: MEDIA_DELETE_CHANNEL,
		payload,
		requestIdPrefix: "media",
		responseChannel: MEDIA_DELETE_RESPONSE_CHANNEL,
		timeoutMessage: "Renderer media mutation timed out.",
		timeoutMs: MEDIA_RENDERER_TIMEOUT_MS,
		win,
	});
}

/**
 * Tells the editor a media file was renamed on disk, and waits until it has
 * re-keyed the item and pointed every clip at the new id.
 */
export async function requestMediaRenameFromRenderer({
	payload,
	win,
}: {
	payload: Omit<ClaudeMediaRenamedEvent, "requestId" | "deadlineAt">;
	win: BrowserWindow;
}): Promise<void> {
	await requestRendererMutation({
		channel: MEDIA_RENAME_CHANNEL,
		// The editor is told when this stops waiting: a rename it finished
		// after that would stand in the editor while the file is put back.
		// A request that settles has no such moment: the file stays where
		// it is, and the editor is to end on its id however long it takes.
		payload: payload.settles
			? payload
			: {
					...payload,
					deadlineAt:
						Date.now() +
						MEDIA_RENAME_TIMEOUT_MS -
						MEDIA_RENAME_COMMIT_MARGIN_MS,
				},
		requestIdPrefix: "media",
		responseChannel: MEDIA_RENAME_RESPONSE_CHANNEL,
		timeoutMessage: "Renderer media rename timed out.",
		timeoutMs: MEDIA_RENAME_TIMEOUT_MS,
		win,
	});
}

function refreshEntries({ value }: { value: unknown }): Array<{
	id: string;
	name: string;
	error?: string;
}> {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [];
		const { id, name, error } = entry as Record<string, unknown>;
		if (typeof id !== "string" || typeof name !== "string") return [];
		return [{ id, name, ...(typeof error === "string" ? { error } : {}) }];
	});
}

/**
 * Has the editor read again the media files that changed in the project
 * folder, and says which ones it read and which it could not.
 */
export async function requestMediaRefreshFromRenderer({
	payload,
	win,
}: {
	payload: Omit<ClaudeMediaRefreshEvent, "requestId">;
	win: BrowserWindow;
}): Promise<ClaudeMediaRefreshResult> {
	const answer = await requestRendererMutation({
		channel: MEDIA_REFRESH_CHANNEL,
		payload,
		requestIdPrefix: "media",
		responseChannel: MEDIA_REFRESH_RESPONSE_CHANNEL,
		timeoutMessage: "Renderer media refresh timed out.",
		timeoutMs: mediaRefreshWaitMs({ timeoutMs: payload.timeoutMs }),
		win,
	});
	const record =
		typeof answer === "object" && answer !== null
			? (answer as Record<string, unknown>)
			: {};
	// An answer that is not one must not read as "nothing had changed": an
	// export through the renderer would go ahead on it.
	if (
		typeof record.checked !== "number" ||
		!Array.isArray(record.refreshed) ||
		!Array.isArray(record.failed)
	) {
		throw new Error(
			"The editor's answer to the media check could not be read."
		);
	}
	return {
		checked: record.checked,
		refreshed: refreshEntries({ value: record.refreshed }).map(
			({ id, name }) => ({ id, name })
		),
		failed: refreshEntries({ value: record.failed }).map(
			({ id, name, error }) => ({ id, name, error: error ?? "unknown error" })
		),
	};
}

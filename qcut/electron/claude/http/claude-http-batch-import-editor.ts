/**
 * Batch import hands what it copied to the open editor.
 *
 * A batch import used to only copy the files into the project folder; the
 * editor loaded all of them on the first add-element afterwards, which could
 * outlast that add's wait, so the add reported a timeout and the element was
 * not placed (N15, 2026-10-28 trailer report). Now the editor loads each file
 * before the import answers, the same way a single import with metadata does,
 * and the answer says per file whether the editor has it.
 *
 * @module electron/claude/http/claude-http-batch-import-editor
 */

import type { BatchImportResult } from "../../types/claude-api.js";
import type { WindowAccessor } from "./claude-http-shared-routes.js";

/**
 * How long one batch import takes at most before it answers, copying the
 * files included. It keeps the answer inside the CLI's default 30 s request
 * wait; files the editor has not confirmed by then keep loading there.
 */
export const BATCH_IMPORT_EDITOR_WAIT_MS = 20_000;

type Outcome = { loaded: true } | { loaded: false; reason?: string };

/** The request's outcome, or "still loading" once `timeoutMs` passes. */
async function settleWithin({
	request,
	timeoutMs,
}: {
	request: Promise<void>;
	timeoutMs: number;
}): Promise<Outcome> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			request.then(
				(): Outcome => ({ loaded: true }),
				(error): Outcome => ({
					loaded: false,
					reason: error instanceof Error ? error.message : String(error),
				})
			),
			new Promise<Outcome>((resolve) => {
				timer = setTimeout(() => resolve({ loaded: false }), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Asks the editor to load each copied file, one at a time, and waits for it
 * until `waitMs` after `startedAt` (when the import began, so the copy counts
 * too). Files left when the time is up are still sent, so the editor keeps
 * loading them; their entries say so.
 */
export async function loadBatchImportInEditor({
	accessor,
	projectId,
	results,
	startedAt = Date.now(),
	waitMs = BATCH_IMPORT_EDITOR_WAIT_MS,
}: {
	accessor: Pick<WindowAccessor, "requestMediaImport">;
	projectId: string;
	results: BatchImportResult[];
	startedAt?: number;
	waitMs?: number;
}): Promise<BatchImportResult[]> {
	if (!accessor.requestMediaImport) return results;
	const deadline = startedAt + waitMs;
	const loaded: BatchImportResult[] = [];
	for (const result of results) {
		const media = result.mediaFile;
		if (!result.success || !media) {
			loaded.push(result);
			continue;
		}
		const request = accessor.requestMediaImport({
			id: media.id,
			name: media.name,
			path: media.path,
			projectId,
			size: media.size,
			type: media.type,
		});
		const remaining = deadline - Date.now();
		if (remaining <= 0) request.catch(() => undefined);
		const outcome: Outcome =
			remaining > 0
				? await settleWithin({ request, timeoutMs: remaining })
				: { loaded: false };
		loaded.push(
			outcome.loaded
				? { ...result, editorReady: true }
				: {
						...result,
						editorReady: false,
						warning: outcome.reason
							? `Copied, but the editor could not load it (${outcome.reason}); editor:timeline:add-element tries again.`
							: "Copied; the editor is still loading it. editor:timeline:add-element waits for it.",
					}
		);
	}
	return loaded;
}

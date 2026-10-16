/**
 * Cancellation of a running export: the error the engine's steps throw once
 * the job's AbortController fires, and the check each step makes first.
 * @module electron/claude/handlers/claude-export-handler/export-cancel
 */

export class ExportCancelledError extends Error {
	constructor() {
		super("Export cancelled");
		this.name = "ExportCancelledError";
	}
}

export function isExportCancelled(error: unknown): boolean {
	return error instanceof ExportCancelledError;
}

/** Throws when the job was cancelled, so a step never starts for nothing. */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new ExportCancelledError();
}

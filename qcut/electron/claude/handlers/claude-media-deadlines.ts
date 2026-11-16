/**
 * How long each side waits for the editor to follow a media rename or to
 * read changed media files again.
 *
 * A request passes through several waits: the editor's own work, the main
 * process waiting for the editor's answer, the utility process (which
 * serves the HTTP API) waiting for the main process, the HTTP request, and
 * the command line. Each has to be longer than the one inside it. If an
 * outer wait ends first, the route answers "failed" while the editor is
 * still at work: for a rename the file is then put back under its old name
 * and the editor goes on to commit the new one.
 *
 * No imports: the utility process reads these too, and must not load the
 * main-process handlers to get them.
 *
 * @module electron/claude/handlers/claude-media-deadlines
 */

/** The main process waits this long for the editor to follow a rename. */
export const MEDIA_RENAME_TIMEOUT_MS = 30_000;
/**
 * The editor stops this long before the main process gives up, so its
 * answer is back in time: past that point it takes the rename back.
 */
export const MEDIA_RENAME_COMMIT_MARGIN_MS = 3_000;
/**
 * The main process waits this long for a refresh that was asked for
 * outright. It reads whole files again, so it may take a while; it stays
 * under the utility server's two minutes for one HTTP request.
 */
export const MEDIA_REFRESH_TIMEOUT_MS = 100_000;
/** An export start waits this long for the check that precedes it. */
export const MEDIA_REFRESH_BEFORE_EXPORT_MS = 15_000;
/** The utility process waits this much longer than the main process does. */
export const UTILITY_BRIDGE_MARGIN_MS = 5_000;
/** What the command line waits for each, outlasting every wait inside. */
export const MEDIA_RENAME_CLIENT_TIMEOUT_MS = 45_000;
export const MEDIA_REFRESH_CLIENT_TIMEOUT_MS = 125_000;

/** How long the main process waits for one refresh request. */
export function mediaRefreshWaitMs({
	timeoutMs,
}: {
	timeoutMs?: unknown;
}): number {
	return typeof timeoutMs === "number" &&
		Number.isFinite(timeoutMs) &&
		timeoutMs > 0
		? Math.min(timeoutMs, MEDIA_REFRESH_TIMEOUT_MS)
		: MEDIA_REFRESH_TIMEOUT_MS;
}

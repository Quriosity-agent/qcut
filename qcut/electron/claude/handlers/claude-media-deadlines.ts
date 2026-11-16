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
 * under the two minutes one HTTP request for it has.
 */
export const MEDIA_REFRESH_TIMEOUT_MS = 100_000;
/** An export start waits this long for the check that precedes it. */
export const MEDIA_REFRESH_BEFORE_EXPORT_MS = 15_000;
/** The utility process waits this much longer than the main process does. */
export const UTILITY_BRIDGE_MARGIN_MS = 5_000;
/**
 * What one HTTP request has for each, in the main-process server and in the
 * utility server alike. A server ends a request that outlasts its usual
 * time (30 s in the main-process server) with a 408, whatever the route is
 * still doing: a rename waits that long by itself, and a refresh longer.
 */
// A rename can wait for the editor twice: to follow, and, when that fails
// with the editor's state unknown, to end on the old id again.
export const MEDIA_RENAME_HTTP_TIMEOUT_MS =
	2 * (MEDIA_RENAME_TIMEOUT_MS + UTILITY_BRIDGE_MARGIN_MS) + 5_000;
export const MEDIA_REFRESH_HTTP_TIMEOUT_MS = 120_000;
/** An export start keeps the 30 s it had; the check before it comes on top. */
export const EXPORT_START_HTTP_TIMEOUT_MS =
	30_000 + MEDIA_REFRESH_BEFORE_EXPORT_MS + UTILITY_BRIDGE_MARGIN_MS;
/** What the command line waits for each, outlasting every wait inside. */
export const MEDIA_RENAME_CLIENT_TIMEOUT_MS = 80_000;
export const MEDIA_REFRESH_CLIENT_TIMEOUT_MS = 125_000;

const MEDIA_RENAME_ROUTE_PATTERN =
	/^\/api\/claude\/media\/[^/]+\/[^/]+\/rename$/;
const MEDIA_REFRESH_ROUTE_PATTERN = /^\/api\/claude\/media\/[^/]+\/refresh$/;
const EXPORT_START_ROUTE_PATTERN = /^\/api\/claude\/export\/[^/]+\/start$/;

/**
 * The time one HTTP request needs when it is for a rename, a refresh or an
 * export start; nothing for any other route. A server gives the request at
 * least this.
 */
export function mediaRouteHttpTimeoutMs({
	path,
}: {
	path: string;
}): number | undefined {
	if (MEDIA_REFRESH_ROUTE_PATTERN.test(path)) {
		return MEDIA_REFRESH_HTTP_TIMEOUT_MS;
	}
	if (MEDIA_RENAME_ROUTE_PATTERN.test(path)) {
		return MEDIA_RENAME_HTTP_TIMEOUT_MS;
	}
	if (EXPORT_START_ROUTE_PATTERN.test(path)) {
		return EXPORT_START_HTTP_TIMEOUT_MS;
	}
	return;
}

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

/**
 * How long one HTTP request may last, by route.
 *
 * The main-process server and the utility server each end a request that
 * outlasts their usual time with a 408, whatever the route is still doing.
 * A route that waits for longer work gets what that work needs, and the
 * same in both servers: its own deadline has to come first, so that the
 * route's answer is the one sent.
 *
 * @module electron/claude/http/claude-http-request-timeout
 */
import { mediaRouteHttpTimeoutMs } from "../handlers/claude-media-deadlines.js";
import {
	TIMELINE_BATCH_HTTP_TIMEOUT_MS,
	TIMELINE_BATCH_ROUTE_PATTERN,
} from "../utils/timeline-batch-deadline.js";
import {
	JIANYING_PROJECT_EXPORT_ROUTE_PATH,
	JIANYING_PROJECT_EXPORT_ROUTE_TIMEOUT_MS,
} from "./claude-http-jianying-project-export-routes.js";
import {
	JIANYING_PROJECT_IMPORT_ROUTE_PATH,
	JIANYING_PROJECT_IMPORT_ROUTE_TIMEOUT_MS,
} from "./claude-http-jianying-project-import-routes.js";

const LONG_RUNNING_ROUTE_PATHS = new Set([
	JIANYING_PROJECT_IMPORT_ROUTE_PATH,
	JIANYING_PROJECT_EXPORT_ROUTE_PATH,
]);
// The extra minute keeps the route-level 504 authoritative: the socket-level
// 408 must never fire before the route's own deadline.
const LONG_RUNNING_REQUEST_TIMEOUT_MS =
	Math.max(
		JIANYING_PROJECT_IMPORT_ROUTE_TIMEOUT_MS,
		JIANYING_PROJECT_EXPORT_ROUTE_TIMEOUT_MS
	) + 60_000;

/**
 * The time a request for `path` has in a server whose usual time is
 * `usualMs`.
 */
export function httpRequestTimeoutMs({
	path,
	usualMs,
}: {
	path: string;
	usualMs: number;
}): number {
	if (LONG_RUNNING_ROUTE_PATHS.has(path)) {
		return LONG_RUNNING_REQUEST_TIMEOUT_MS;
	}
	if (TIMELINE_BATCH_ROUTE_PATTERN.test(path)) {
		return TIMELINE_BATCH_HTTP_TIMEOUT_MS;
	}
	// A media rename, a media refresh and an export start wait for the
	// editor: never less than the server's usual time, more where they need it.
	return Math.max(usualMs, mediaRouteHttpTimeoutMs({ path }) ?? 0);
}

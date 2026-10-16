/**
 * What to tell the user when a request to the editor fails before an
 * answer arrives. `fetch` reports every network failure as "fetch failed",
 * so the cause decides: QCut not listening, QCut closing the connection
 * mid-request (the work usually goes on in the app), or the client's own
 * timeout.
 *
 * @module electron/native-pipeline/editor/editor-api-failure
 */

/** The socket never connected: QCut is not reachable there. */
const CONNECT_FAILED =
	/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i;
/** QCut took the request but the connection's own timer ran out waiting for the answer. */
const RESPONSE_TIMED_OUT = /UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/i;
/** An open connection went away mid-request. */
const CONNECTION_DROPPED =
	/ECONNRESET|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED|UND_ERR_DESTROYED|UND_ERR_ABORTED|socket hang up|other side closed/i;

function causeCode(error: unknown): string {
	const cause = (error as { cause?: { code?: unknown; message?: unknown } })
		?.cause;
	const code = cause?.code;
	if (typeof code === "string") return code;
	return typeof cause?.message === "string" ? cause.message : "";
}

/** A message for a connection-level failure, or null when it is not one. */
export function describeRequestFailure({
	error,
	url,
	baseUrl,
}: {
	error: unknown;
	url: string;
	baseUrl: string;
}): string | null {
	const name = error instanceof Error ? error.name : "";
	const message = error instanceof Error ? error.message : String(error);
	const cause = causeCode(error);
	if (name === "TimeoutError") {
		return `QCut did not answer ${url} within the client timeout; the work may still be running in the app`;
	}
	if (message.includes("ECONNREFUSED") || cause.includes("ECONNREFUSED")) {
		return `Cannot connect to QCut at ${baseUrl}`;
	}
	if (!message.includes("fetch failed")) return null;
	if (CONNECT_FAILED.test(cause)) {
		return `Cannot connect to QCut at ${baseUrl} (${cause})`;
	}
	if (RESPONSE_TIMED_OUT.test(cause)) {
		return `QCut accepted the request to ${url} but did not answer within the connection's timeout (${cause}); the work may still be running in the app`;
	}
	if (CONNECTION_DROPPED.test(cause)) {
		return `QCut closed the connection to ${url} before answering (${cause}); the work may still be running in the app`;
	}
	return `Cannot connect to QCut at ${baseUrl}${cause ? ` (${cause})` : ""}`;
}

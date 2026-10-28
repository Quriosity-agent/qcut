export const TIMELINE_BATCH_HTTP_TIMEOUT_MS = 120_000;
export const TIMELINE_BATCH_ROUTE_PATTERN =
	/^\/api\/claude\/timeline\/[^/]+\/elements\/batch$/;
// The inner deadline must answer before the socket and CLI give up waiting.
export const TIMELINE_BATCH_MAIN_TIMEOUT_MS =
	TIMELINE_BATCH_HTTP_TIMEOUT_MS - 5_000;
export const TIMELINE_BATCH_CLIENT_TIMEOUT_MS =
	TIMELINE_BATCH_HTTP_TIMEOUT_MS + 5_000;
/**
 * A single add waits longer than other editor requests: right after a media
 * import the editor can be busy for several seconds (decoding new clips), and
 * the add it has queued still runs once it is free, so a short wait reported
 * a failure for a clip that then appeared (and a retry doubled it). It stays
 * under the CLI's default 30 s request wait.
 */
export const TIMELINE_ADD_ELEMENT_TIMEOUT_MS = 25_000;

const UNKNOWN_OUTCOME_HINT =
	"Batch application outcome is unknown: some or all elements may already be applied. Export the timeline and verify it before retrying; a retry can duplicate elements.";

export function withTimelineBatchTimeoutContext({
	error,
}: {
	error: unknown;
}): unknown {
	if (
		!(error instanceof Error) ||
		!/timed out|timeout/i.test(error.message) ||
		error.message.includes(UNKNOWN_OUTCOME_HINT)
	) {
		return error;
	}
	return new Error(`${error.message} ${UNKNOWN_OUTCOME_HINT}`, {
		cause: error,
	});
}

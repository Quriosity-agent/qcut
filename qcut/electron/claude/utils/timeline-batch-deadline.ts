export const TIMELINE_BATCH_HTTP_TIMEOUT_MS = 120_000;
export const TIMELINE_BATCH_ROUTE_PATTERN =
	/^\/api\/claude\/timeline\/[^/]+\/elements\/batch$/;
// The inner deadline must answer before the socket and CLI give up waiting.
export const TIMELINE_BATCH_MAIN_TIMEOUT_MS =
	TIMELINE_BATCH_HTTP_TIMEOUT_MS - 5_000;
export const TIMELINE_BATCH_CLIENT_TIMEOUT_MS =
	TIMELINE_BATCH_HTTP_TIMEOUT_MS + 5_000;

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

import type {
	ClaudeBatchAddElementRequest,
	ClaudeBatchAddResponse,
	ClaudeElement,
} from "../types/claude-api.js";
import {
	TIMELINE_ADD_ELEMENT_TIMEOUT_MS,
	TIMELINE_BATCH_MAIN_TIMEOUT_MS,
	withTimelineBatchTimeoutContext,
} from "../claude/utils/timeline-batch-deadline.js";

export type UtilityRequestFromMain = (
	channel: string,
	data: Record<string, unknown>,
	options?: { timeoutMs?: number }
) => Promise<unknown>;

export function createUtilityTimelineMutationAccessor({
	requestFromMain,
}: {
	requestFromMain: UtilityRequestFromMain;
}): {
	requestAddElement: (
		projectId: string,
		element: Partial<ClaudeElement>,
		correlationId?: string
	) => Promise<void>;
	batchAddElements: (
		projectId: string,
		elements: ClaudeBatchAddElementRequest[],
		correlationId?: string
	) => Promise<ClaudeBatchAddResponse>;
} {
	return {
		requestAddElement: async (projectId, element, correlationId) => {
			// Main waits up to 25 s for the editor; the default 10 s here
			// would give up first and report a placement that still happens.
			await requestFromMain(
				"timeline:add-element",
				{ correlationId, element, projectId },
				{ timeoutMs: TIMELINE_ADD_ELEMENT_TIMEOUT_MS + 2000 }
			);
		},
		batchAddElements: async (projectId, elements, correlationId) => {
			try {
				return (await requestFromMain(
					"batch-add-elements",
					{ correlationId, elements, projectId },
					{ timeoutMs: TIMELINE_BATCH_MAIN_TIMEOUT_MS }
				)) as ClaudeBatchAddResponse;
			} catch (error) {
				throw withTimelineBatchTimeoutContext({ error });
			}
		},
	};
}

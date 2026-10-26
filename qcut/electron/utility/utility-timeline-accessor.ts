import type {
	ClaudeBatchAddElementRequest,
	ClaudeBatchAddResponse,
	ClaudeElement,
} from "../types/claude-api.js";
import {
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
			await requestFromMain("timeline:add-element", {
				correlationId,
				element,
				projectId,
			});
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

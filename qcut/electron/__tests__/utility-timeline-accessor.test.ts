import { describe, expect, it, vi } from "vitest";
import { createUtilityTimelineMutationAccessor } from "../utility/utility-timeline-accessor";
import {
	TIMELINE_ADD_ELEMENT_TIMEOUT_MS,
	TIMELINE_BATCH_MAIN_TIMEOUT_MS,
} from "../claude/utils/timeline-batch-deadline";

describe("utility timeline mutation accessor", () => {
	it("forwards project identity for single placement", async () => {
		const requestFromMain = vi.fn(async () => undefined);
		const accessor = createUtilityTimelineMutationAccessor({ requestFromMain });

		await accessor.requestAddElement(
			"project-1",
			{ duration: 5, startTime: 0, type: "sticker" },
			"correlation-1"
		);

		// N15: main waits up to 25 s for a busy editor (just after an import);
		// the utility hop must not give up first.
		expect(requestFromMain).toHaveBeenCalledWith(
			"timeline:add-element",
			{
				correlationId: "correlation-1",
				element: { duration: 5, startTime: 0, type: "sticker" },
				projectId: "project-1",
			},
			{ timeoutMs: TIMELINE_ADD_ELEMENT_TIMEOUT_MS + 2000 }
		);
		expect(TIMELINE_ADD_ELEMENT_TIMEOUT_MS).toBeGreaterThanOrEqual(25_000);
	});

	it("forwards project identity for batch placement", async () => {
		const response = {
			added: [{ elementId: "element-1", index: 0, success: true as const }],
			failedCount: 0,
		};
		const requestFromMain = vi.fn(async () => response);
		const accessor = createUtilityTimelineMutationAccessor({ requestFromMain });
		const elements = [
			{
				duration: 5,
				mediaId: "media-1",
				startTime: 0,
				trackId: "track-1",
				type: "media" as const,
			},
		];

		await expect(
			accessor.batchAddElements("project-1", elements, "correlation-2")
		).resolves.toEqual(response);
		expect(requestFromMain).toHaveBeenCalledWith(
			"batch-add-elements",
			{
				correlationId: "correlation-2",
				elements,
				projectId: "project-1",
			},
			{ timeoutMs: TIMELINE_BATCH_MAIN_TIMEOUT_MS }
		);
	});
});

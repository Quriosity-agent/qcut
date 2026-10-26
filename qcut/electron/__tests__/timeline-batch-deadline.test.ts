import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUtilityTimelineMutationAccessor } from "../utility/utility-timeline-accessor";
import { EditorApiClient } from "../native-pipeline/editor/editor-api-client";
import { handleTimelineEditingCommand } from "../native-pipeline/editor/editor-handlers-timeline";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types";

const elements = Array.from({ length: 32 }, (_, index) => ({
	type: "media" as const,
	trackId: "main",
	mediaId: `media-${index}`,
	startTime: "end" as const,
	duration: 1,
}));
const response = {
	added: elements.map((_, index) => ({
		index,
		elementId: `element-${index}`,
		success: true as const,
	})),
	failedCount: 0,
};

function batchOptions({ timeout }: { timeout?: number } = {}): CLIRunOptions {
	return {
		command: "editor:timeline:batch-add",
		projectId: "project-1",
		elements: JSON.stringify(elements),
		outputDir: ".",
		json: false,
		verbose: false,
		quiet: true,
		saveIntermediates: false,
		...(timeout === undefined ? {} : { timeout }),
	} as CLIRunOptions;
}

function setupDelayedFetch({ delayMs }: { delayMs: number }) {
	vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
		const controller = new AbortController();
		setTimeout(() => {
			controller.abort(new DOMException("Request timed out", "TimeoutError"));
		}, milliseconds);
		return controller.signal;
	});
	const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
		return new Promise<Response>((resolve, reject) => {
			const timer = setTimeout(() => {
				resolve(Response.json({ success: true, data: response }));
			}, delayMs);
			init?.signal?.addEventListener("abort", () => {
				clearTimeout(timer);
				reject(init.signal?.reason);
			});
		});
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("timeline batch deadlines", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("returns all 32 results when the main process takes longer than 10 seconds", async () => {
		const requestFromMain = vi.fn(
			(
				_channel: string,
				_data: Record<string, unknown>,
				options?: { timeoutMs?: number }
			) =>
				new Promise((resolve, reject) => {
					const deadline = setTimeout(() => {
						reject(
							new Error("Main process request timed out: batch-add-elements")
						);
					}, options?.timeoutMs ?? 10_000);
					setTimeout(() => {
						clearTimeout(deadline);
						resolve(response);
					}, 12_000);
				})
		);
		const accessor = createUtilityTimelineMutationAccessor({ requestFromMain });
		const pending = accessor.batchAddElements("project-1", elements).then(
			(value) => ({ value }),
			(error: unknown) => ({ error })
		);
		await vi.advanceTimersByTimeAsync(12_000);
		expect(await pending).toEqual({ value: response });
		expect(requestFromMain).toHaveBeenCalledTimes(1);
	});

	it.each([
		"Main process request timed out: batch-add-elements",
		"Timeout waiting for batch add result",
	])("does not claim the batch was unapplied after %s", async (message) => {
		const requestFromMain = vi.fn(async () => {
			throw new Error(message);
		});
		const accessor = createUtilityTimelineMutationAccessor({ requestFromMain });
		await expect(
			accessor.batchAddElements("project-1", elements)
		).rejects.toThrow(
			/outcome is unknown.*verify it before retrying.*duplicate elements/
		);
		expect(requestFromMain).toHaveBeenCalledTimes(1);
	});

	it("preserves validation failures and partial batch results", async () => {
		const invalidTrack = new Error("Track not found: missing");
		const partialResponse = {
			added: [
				{ elementId: "element-0", index: 0, success: true },
				{ index: 1, success: false, error: "Missing media" },
			],
			failedCount: 1,
		};
		const requestFromMain = vi
			.fn()
			.mockRejectedValueOnce(invalidTrack)
			.mockResolvedValueOnce(partialResponse);
		const accessor = createUtilityTimelineMutationAccessor({ requestFromMain });
		await expect(accessor.batchAddElements("project-1", elements)).rejects.toBe(
			invalidTrack
		);
		await expect(
			accessor.batchAddElements("project-1", elements)
		).resolves.toEqual(partialResponse);
		expect(requestFromMain).toHaveBeenCalledTimes(2);
	});

	it("lets a batch CLI request outlive the ordinary 30-second client timeout", async () => {
		const fetchMock = setupDelayedFetch({ delayMs: 35_000 });
		const client = new EditorApiClient({ skipCapabilityCheck: true });
		const pending = handleTimelineEditingCommand(
			client,
			batchOptions(),
			() => {}
		);
		await vi.advanceTimersByTimeAsync(35_000);
		expect(await pending).toEqual({ success: true, data: response });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("preserves an explicit shorter CLI timeout and reports an unknown application outcome", async () => {
		const fetchMock = setupDelayedFetch({ delayMs: 35_000 });
		const client = new EditorApiClient({
			skipCapabilityCheck: true,
			timeout: 1000,
		});
		const pending = handleTimelineEditingCommand(
			client,
			batchOptions({ timeout: 1 }),
			() => {}
		);
		await vi.advanceTimersByTimeAsync(1000);
		expect(await pending).toEqual({
			success: false,
			error: expect.stringMatching(/outcome.*unknown/i),
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("reports a server timeout as an unknown outcome without retrying", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json(
				{ success: false, error: "Request timeout" },
				{ status: 408 }
			)
		);
		vi.stubGlobal("fetch", fetchMock);
		const client = new EditorApiClient({ skipCapabilityCheck: true });
		const result = await handleTimelineEditingCommand(
			client,
			batchOptions(),
			() => {}
		);
		expect(result).toEqual({
			success: false,
			error: expect.stringMatching(/outcome is unknown/),
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

import { describe, expect, it, vi } from "vitest";
import type { ClaudeBatchAddElementRequest } from "../types/claude-api.js";

vi.mock("electron", () => ({
	ipcMain: { on: vi.fn(), once: vi.fn(), removeListener: vi.fn() },
	BrowserWindow: class {},
}));

const { assertBatchElementPlacement } = await import(
	"../claude/handlers/claude-timeline-operations.js"
);

function element(
	fields: Partial<ClaudeBatchAddElementRequest>
): ClaudeBatchAddElementRequest {
	return { type: "media", trackId: "main", ...fields };
}

const START_ERROR =
	'Each element must include exactly one of: startTime (seconds >= 0 or "end"), after (an element id), startFrame (whole frames >= 0)';
const DURATION_ERROR =
	"Each element must include either a duration > 0 (seconds) or durationFrames (whole frames > 0)";

describe("assertBatchElementPlacement", () => {
	it("accepts each way of giving a start", () => {
		for (const start of [
			{ startTime: 0 },
			{ startTime: 117.25 },
			{ startTime: "end" as const },
			{ after: "clip-6" },
			{ startFrame: 2814 },
		]) {
			expect(() =>
				assertBatchElementPlacement({
					element: element({ ...start, duration: 2 }),
				})
			).not.toThrow();
		}
	});

	it("accepts a length in seconds or in frames", () => {
		expect(() =>
			assertBatchElementPlacement({
				element: element({ startTime: "end", durationFrames: 385 }),
			})
		).not.toThrow();
	});

	it("rejects a missing, negative, unknown or doubled start", () => {
		for (const start of [
			{},
			{ startTime: -1 },
			{ startTime: Number.NaN },
			{ startTime: "later" as unknown as number },
			{ startFrame: 1.5 },
			{ after: "" },
			{ startTime: 3, after: "clip-6" },
		]) {
			expect(() =>
				assertBatchElementPlacement({
					element: element({ ...start, duration: 2 }),
				})
			).toThrow(START_ERROR);
		}
	});

	it("rejects a missing, zero or doubled length", () => {
		for (const length of [
			{},
			{ duration: 0 },
			{ durationFrames: 0 },
			{ durationFrames: 2.5 },
			{ duration: 1, durationFrames: 24 },
		]) {
			expect(() =>
				assertBatchElementPlacement({
					element: element({ startTime: 0, ...length }),
				})
			).toThrow(DURATION_ERROR);
		}
	});
});

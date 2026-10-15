import { describe, expect, it } from "vitest";
import { TIMELINE_COLOR_LABELS } from "../../apps/web/src/lib/timeline/timeline-color-labels";
import { CLAUDE_TIMELINE_COLOR_LABELS } from "../types/claude-api.js";
import { readColorLabelField } from "../claude/http/timeline-color-request.js";

describe("timeline colour labels on the electron side", () => {
	it("match the editor's colour list exactly", () => {
		expect([...CLAUDE_TIMELINE_COLOR_LABELS]).toEqual(
			TIMELINE_COLOR_LABELS.map((label) => label.value)
		);
	});

	it("read a request colour, a clear, or nothing", () => {
		expect(readColorLabelField({ value: "red", field: "colorLabel" })).toBe(
			"red"
		);
		for (const clear of [null, "", "none"]) {
			expect(
				readColorLabelField({ value: clear, field: "colorLabel" })
			).toBeNull();
		}
		expect(
			readColorLabelField({ value: undefined, field: "colorLabel" })
		).toBeUndefined();
		expect(() =>
			readColorLabelField({ value: "teal", field: "colorLabel" })
		).toThrow("colorLabel must be one of");
	});
});

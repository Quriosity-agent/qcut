import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import { hitTestEditorPoint } from "../handlers/agent-pointer-hit-test.js";

function createWindow({ result }: { result: unknown }) {
	const executeJavaScript = vi.fn(async () => result);
	const win = {
		webContents: { executeJavaScript },
	} as unknown as BrowserWindow;
	return { win, executeJavaScript };
}

describe("hitTestEditorPoint", () => {
	it("asks the renderer what sits under the point and returns its description", async () => {
		const result = {
			action: "hit-test",
			x: 388,
			y: 879,
			hit: true,
			element: {
				tagName: "div",
				role: null,
				name: "sample-video.mp4",
				value: null,
				testId: "timeline-element",
				ref: null,
				disabled: false,
				bounds: { x: 380, y: 830, width: 240, height: 60 },
			},
			ancestors: [{ tagName: "div", testId: "timeline-track" }],
		};
		const { win, executeJavaScript } = createWindow({ result });

		await expect(hitTestEditorPoint(win, { x: 388, y: 879 })).resolves.toEqual(
			result
		);
		const script = String(executeJavaScript.mock.calls[0]?.[0]);
		expect(script).toContain("document.elementFromPoint(x, y)");
		expect(script).toContain("const x = 388;");
		expect(script).toContain("const y = 879;");
		expect(script).toContain("data-testid");
	});

	it("rejects renderer results that are not hit-test envelopes", async () => {
		const { win } = createWindow({ result: { action: "snapshot" } });

		await expect(hitTestEditorPoint(win, { x: 1, y: 2 })).rejects.toThrow(
			"invalid pointer hit-test result"
		);
	});
});

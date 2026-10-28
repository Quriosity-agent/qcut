import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { handleEditorCommand } from "../native-pipeline/cli/cli-handlers-editor.js";
import {
	BASE_URL,
	clearRoutes,
	installFetchMock,
	makeOpts,
	mockRoute,
	noopProgress,
	originalFetch,
} from "./editor-cli-test-setup";

// N18 (2026-10-28 trailer report): `editor:undo` printed ok while the
// timeline did not change.
describe("editor:undo and editor:redo", () => {
	beforeAll(() => {
		installFetchMock(BASE_URL);
	});

	afterEach(() => {
		clearRoutes();
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	function mockHealth() {
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok" },
		});
	}

	it("returns the step it took back and what that changed", async () => {
		mockHealth();
		const answer = {
			applied: true,
			undoCount: 2,
			redoCount: 1,
			label: "Edit",
			changes: { added: 1, removed: 0, moved: 0, elements: [] },
		};
		mockRoute("POST", "/api/claude/undo", { success: true, data: answer });

		const result = await handleEditorCommand(
			makeOpts({ command: "editor:undo" }),
			noopProgress
		);

		expect(result).toEqual({ success: true, data: answer });
	});

	it("fails when there was nothing to undo", async () => {
		mockHealth();
		mockRoute("POST", "/api/claude/undo", {
			success: true,
			data: { applied: false, undoCount: 0, redoCount: 3 },
		});

		const result = await handleEditorCommand(
			makeOpts({ command: "editor:undo" }),
			noopProgress
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe("Nothing to undo: the undo history is empty");
	});

	it("fails, naming the open transaction, when the editor refused the redo", async () => {
		mockHealth();
		mockRoute("POST", "/api/claude/redo", {
			success: true,
			data: { applied: false, undoCount: 4, redoCount: 2 },
		});

		const result = await handleEditorCommand(
			makeOpts({ command: "editor:redo" }),
			noopProgress
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe(
			"The editor did not redo: a transaction is open in it"
		);
	});
});

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

describe("editor:navigator:open", () => {
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

	it("fails with the editor's reason when the project did not open", async () => {
		mockHealth();
		mockRoute("POST", "/api/claude/navigator/open", {
			success: true,
			data: {
				navigated: false,
				projectId: "p1",
				error: "The editor did not finish opening project p1 within 20s",
			},
		});

		const result = await handleEditorCommand(
			makeOpts({ command: "editor:navigator:open", projectId: "p1" }),
			noopProgress
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe(
			"The editor did not finish opening project p1 within 20s"
		);
	});

	it("succeeds when the editor reports the project open", async () => {
		mockHealth();
		mockRoute("POST", "/api/claude/navigator/open", {
			success: true,
			data: { navigated: true, projectId: "p1" },
		});

		const result = await handleEditorCommand(
			makeOpts({ command: "editor:navigator:open", projectId: "p1" }),
			noopProgress
		);

		expect(result.success).toBe(true);
	});
});

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

	/** 问题 4 (2026-11-14): --wait-ready answered `opened: false` beside `navigated: true`. */
	it("reports the project opened and ready after --wait-ready", async () => {
		mockHealth();
		mockRoute("POST", "/api/claude/navigator/open", {
			success: true,
			data: { navigated: true, projectId: "p1" },
		});
		mockRoute("GET", "/api/claude/navigator/projects", {
			success: true,
			data: { activeProjectId: "p1", projects: [] },
		});
		mockRoute("GET", "/api/claude/media/p1", { success: true, data: [] });
		mockRoute("GET", "/api/claude/timeline/p1", {
			success: true,
			data: { tracks: [] },
		});

		const result = await handleEditorCommand(
			makeOpts({
				command: "editor:navigator:open",
				projectId: "p1",
				waitReady: true,
			}),
			noopProgress
		);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			navigation: { navigated: true, projectId: "p1" },
			readiness: {
				projectId: "p1",
				ready: true,
				opened: true,
				elapsedMs: expect.any(Number),
			},
		});
	});
});

/** 问题 4 (2026-11-14): `project info` without an id said "Missing --project-id". */
describe("editor:project:info without --project-id", () => {
	beforeAll(() => {
		installFetchMock(BASE_URL);
	});

	afterEach(() => {
		clearRoutes();
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	function mockProject({
		activeProjectId,
	}: {
		activeProjectId: string | null;
	}) {
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok" },
		});
		mockRoute("GET", "/api/claude/navigator/projects", {
			success: true,
			data: {
				activeProjectId,
				projects: [
					{
						id: "p1",
						name: "Opening",
						createdAt: "2026-11-10T07:27:49.638Z",
						updatedAt: "2026-11-14T10:00:00.000Z",
					},
					{
						id: "p2",
						name: "Rough cut",
						createdAt: "2026-11-08T12:45:22.599Z",
						updatedAt: "2026-11-09T15:54:14.754Z",
					},
				],
			},
		});
		for (const id of ["p1", "p2"]) {
			mockRoute("GET", `/api/claude/project/${id}/settings`, {
				success: true,
				data: { name: id === "p1" ? "Opening" : "Rough cut", fps: 24 },
			});
			mockRoute("GET", `/api/claude/project/${id}/stats`, {
				success: true,
				data: { trackCount: 3, elementCount: 12, totalDuration: 281.8 },
			});
		}
	}

	it("describes the project the editor has open", async () => {
		mockProject({ activeProjectId: "p1" });
		const result = await handleEditorCommand(
			makeOpts({ command: "editor:project:info" }),
			noopProgress
		);
		expect(result.success).toBe(true);
		expect(result.data).toMatchObject({
			projectId: "p1",
			name: "Opening",
			isActive: true,
			counts: { tracks: 3, elements: 12 },
		});
	});

	it("says whether a project named by id is the open one", async () => {
		mockProject({ activeProjectId: "p1" });
		const result = await handleEditorCommand(
			makeOpts({ command: "editor:project:info", projectId: "p2" }),
			noopProgress
		);
		expect(result.data).toMatchObject({ projectId: "p2", isActive: false });
	});

	it("asks for an id only when no project is open", async () => {
		mockProject({ activeProjectId: null });
		const result = await handleEditorCommand(
			makeOpts({ command: "editor:project:info" }),
			noopProgress
		);
		expect(result.success).toBe(false);
		expect(result.error).toBe(
			"No project is open in the editor; pass --project-id (see `qcut editor project list`)"
		);
	});
});

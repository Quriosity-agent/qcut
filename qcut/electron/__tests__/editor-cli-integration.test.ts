import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { handleEditorCommand } from "../native-pipeline/cli-handlers-editor.js";
import { handleMediaProjectCommand } from "../native-pipeline/editor-handlers-media.js";
import { handleTimelineEditingCommand } from "../native-pipeline/editor-handlers-timeline.js";
import { handleAnalysisCommand } from "../native-pipeline/editor-handlers-analysis.js";
import { handleGenerateExportCommand } from "../native-pipeline/editor-handlers-generate.js";
import { EditorApiClient } from "../native-pipeline/editor-api-client.js";
import type { CLIRunOptions, CLIResult } from "../native-pipeline/cli-runner.js";

// ---------------------------------------------------------------------------
// Mock HTTP server
// ---------------------------------------------------------------------------

const routes = new Map<
	string,
	{ status: number; body: unknown; capturedBody?: string }
>();
let lastCapturedUrl = "";
let lastCapturedBody: string | null = null;
let lastCapturedMethod = "";

function mockRoute(method: string, path: string, body: unknown, status = 200) {
	routes.set(`${method} ${path}`, { status, body });
}

function clearRoutes() {
	routes.clear();
	lastCapturedUrl = "";
	lastCapturedBody = null;
	lastCapturedMethod = "";
}

const originalFetch = globalThis.fetch;
const BASE_URL = "http://127.0.0.1:19880";

function installFetchMock(baseUrl: string) {
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		const method = init?.method ?? "GET";
		const pathname = url.replace(baseUrl, "").split("?")[0];
		const key = `${method} ${pathname}`;

		lastCapturedUrl = url;
		lastCapturedBody = (init?.body as string) ?? null;
		lastCapturedMethod = method;

		const route = routes.get(key);
		if (!route) {
			return new Response(
				JSON.stringify({
					success: false,
					error: `Not found: ${key}`,
					timestamp: Date.now(),
				}),
				{ status: 404, headers: { "Content-Type": "application/json" } },
			);
		}

		return new Response(JSON.stringify(route.body), {
			status: route.status,
			headers: { "Content-Type": "application/json" },
		});
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOpts(overrides: Partial<CLIRunOptions>): CLIRunOptions {
	return {
		command: "editor:health",
		outputDir: "./output",
		json: false,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		host: "127.0.0.1",
		port: "19880",
		...overrides,
	} as CLIRunOptions;
}

const noopProgress = () => {};

// ---------------------------------------------------------------------------
// 1. Dispatcher integration tests (handleEditorCommand)
// ---------------------------------------------------------------------------

describe("handleEditorCommand dispatcher", () => {
	beforeAll(() => {
		installFetchMock(BASE_URL);
	});

	afterEach(() => {
		clearRoutes();
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	it("editor:health skips health check and returns data", async () => {
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok", version: "2.0.0", uptime: 500 },
		});
		const result = await handleEditorCommand(
			makeOpts({ command: "editor:health" }),
			noopProgress,
		);
		expect(result.success).toBe(true);
		expect((result.data as { status: string }).status).toBe("ok");
	});

	it("returns error when QCut is not running (health check fails)", async () => {
		// No health route mocked — will return 404 with success:false
		const result = await handleEditorCommand(
			makeOpts({ command: "editor:media:list", projectId: "p1" }),
			noopProgress,
		);
		expect(result.success).toBe(false);
		expect(result.error).toContain("QCut editor not running");
		expect(result.error).toContain("bun run electron:dev");
	});

	it("routes editor:media:* to media handler", async () => {
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok" },
		});
		mockRoute("GET", "/api/claude/media/proj1", {
			success: true,
			data: [{ id: "m1" }],
		});
		const result = await handleEditorCommand(
			makeOpts({ command: "editor:media:list", projectId: "proj1" }),
			noopProgress,
		);
		expect(result.success).toBe(true);
	});

	it("routes editor:project:* to project handler", async () => {
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok" },
		});
		mockRoute("GET", "/api/claude/project/proj1/stats", {
			success: true,
			data: { totalDuration: 120, trackCount: 3 },
		});
		const result = await handleEditorCommand(
			makeOpts({ command: "editor:project:stats", projectId: "proj1" }),
			noopProgress,
		);
		expect(result.success).toBe(true);
	});

	it("routes editor:timeline:* to timeline handler", async () => {
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok" },
		});
		mockRoute("GET", "/api/claude/timeline/p1", {
			success: true,
			data: { tracks: [] },
		});
		const result = await handleEditorCommand(
			makeOpts({ command: "editor:timeline:export", projectId: "p1" }),
			noopProgress,
		);
		expect(result.success).toBe(true);
	});

	it("routes editor:analyze:* to analysis handler", async () => {
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok" },
		});
		mockRoute("GET", "/api/claude/analyze/models", {
			success: true,
			data: { models: ["gpt-4v"] },
		});
		const result = await handleEditorCommand(
			makeOpts({ command: "editor:analyze:models" }),
			noopProgress,
		);
		expect(result.success).toBe(true);
	});

	it("routes editor:generate:* to generate handler", async () => {
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok" },
		});
		mockRoute("GET", "/api/claude/generate/models", {
			success: true,
			data: { models: [] },
		});
		const result = await handleEditorCommand(
			makeOpts({ command: "editor:generate:models" }),
			noopProgress,
		);
		expect(result.success).toBe(true);
	});

	it("routes editor:export:* to export handler", async () => {
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok" },
		});
		mockRoute("GET", "/api/claude/export/presets", {
			success: true,
			data: { presets: [] },
		});
		const result = await handleEditorCommand(
			makeOpts({ command: "editor:export:presets" }),
			noopProgress,
		);
		expect(result.success).toBe(true);
	});

	it("routes editor:diagnostics:* to diagnostics handler", async () => {
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok" },
		});
		mockRoute("POST", "/api/claude/diagnostics/analyze", {
			success: true,
			data: { errorType: "RenderError" },
		});
		const result = await handleEditorCommand(
			makeOpts({
				command: "editor:diagnostics:analyze",
				message: "render failed",
			}),
			noopProgress,
		);
		expect(result.success).toBe(true);
	});

	it("routes editor:mcp:* to MCP handler", async () => {
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok" },
		});
		mockRoute("POST", "/api/claude/mcp/app", {
			success: true,
			data: { forwarded: true },
		});
		const result = await handleEditorCommand(
			makeOpts({
				command: "editor:mcp:forward-html",
				html: "<div>test</div>",
			}),
			noopProgress,
		);
		expect(result.success).toBe(true);
	});

	it("returns error for unknown module", async () => {
		mockRoute("GET", "/api/claude/health", {
			success: true,
			data: { status: "ok" },
		});
		const result = await handleEditorCommand(
			makeOpts({ command: "editor:foobar:action" }),
			noopProgress,
		);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Unknown editor module: foobar");
	});
});

// ---------------------------------------------------------------------------
// 2. Untested media handlers
// ---------------------------------------------------------------------------

describe("Media handlers — uncovered actions", () => {
	let client: EditorApiClient;

	beforeAll(() => {
		installFetchMock(BASE_URL);
		client = new EditorApiClient({ baseUrl: BASE_URL });
	});

	afterEach(() => {
		clearRoutes();
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	describe("media:info", () => {
		it("requires project-id and media-id", async () => {
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({ command: "editor:media:info" }),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--project-id");

			const result2 = await handleMediaProjectCommand(
				client,
				makeOpts({ command: "editor:media:info", projectId: "p1" }),
				noopProgress,
			);
			expect(result2.success).toBe(false);
			expect(result2.error).toContain("--media-id");
		});

		it("calls correct GET endpoint", async () => {
			mockRoute("GET", "/api/claude/media/p1/m1", {
				success: true,
				data: { id: "m1", name: "video.mp4", type: "video", duration: 30 },
			});
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:media:info",
					projectId: "p1",
					mediaId: "m1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(true);
			expect((result.data as { name: string }).name).toBe("video.mp4");
		});
	});

	describe("media:import-url", () => {
		it("requires project-id and url", async () => {
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({ command: "editor:media:import-url", projectId: "p1" }),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--url");
		});

		it("sends URL to correct endpoint", async () => {
			mockRoute("POST", "/api/claude/media/p1/import-from-url", {
				success: true,
				data: { imported: true, mediaId: "m2" },
			});
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:media:import-url",
					projectId: "p1",
					imageUrl: "https://example.com/video.mp4",
				}),
				noopProgress,
			);
			expect(result.success).toBe(true);
		});

		it("includes filename when provided", async () => {
			mockRoute("POST", "/api/claude/media/p1/import-from-url", {
				success: true,
				data: { imported: true },
			});
			await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:media:import-url",
					projectId: "p1",
					imageUrl: "https://example.com/video.mp4",
					filename: "my-video.mp4",
				}),
				noopProgress,
			);
			const body = JSON.parse(lastCapturedBody!);
			expect(body.filename).toBe("my-video.mp4");
		});
	});

	describe("media:extract-frame", () => {
		it("requires project-id, media-id, and timestamp", async () => {
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:media:extract-frame",
					projectId: "p1",
					mediaId: "m1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--timestamp");
		});

		it("sends POST with correct body", async () => {
			mockRoute("POST", "/api/claude/media/p1/m1/extract-frame", {
				success: true,
				data: { framePath: "/tmp/frame.png" },
			});
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:media:extract-frame",
					projectId: "p1",
					mediaId: "m1",
					startTime: 5.5,
				}),
				noopProgress,
			);
			expect(result.success).toBe(true);
		});
	});

	describe("media:rename", () => {
		it("requires project-id, media-id, and new-name", async () => {
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:media:rename",
					projectId: "p1",
					mediaId: "m1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--new-name");
		});

		it("sends PATCH with new name", async () => {
			mockRoute("PATCH", "/api/claude/media/p1/m1/rename", {
				success: true,
				data: { renamed: true },
			});
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:media:rename",
					projectId: "p1",
					mediaId: "m1",
					newName: "new-video-name.mp4",
				}),
				noopProgress,
			);
			expect(result.success).toBe(true);
			const body = JSON.parse(lastCapturedBody!);
			expect(body.newName).toBe("new-video-name.mp4");
		});
	});

	describe("media:delete", () => {
		it("requires project-id and media-id", async () => {
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({ command: "editor:media:delete", projectId: "p1" }),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--media-id");
		});

		it("sends DELETE to correct endpoint", async () => {
			mockRoute("DELETE", "/api/claude/media/p1/m1", {
				success: true,
				data: { deleted: true },
			});
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:media:delete",
					projectId: "p1",
					mediaId: "m1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(true);
			expect(lastCapturedMethod).toBe("DELETE");
		});
	});

	describe("unknown media action", () => {
		it("returns error for unknown action", async () => {
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:media:nonexistent",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown media action");
		});
	});
});

// ---------------------------------------------------------------------------
// 3. Untested project handlers
// ---------------------------------------------------------------------------

describe("Project handlers — uncovered actions", () => {
	let client: EditorApiClient;

	beforeAll(() => {
		installFetchMock(BASE_URL);
		client = new EditorApiClient({ baseUrl: BASE_URL });
	});

	afterEach(() => {
		clearRoutes();
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	describe("project:summary", () => {
		it("requires project-id", async () => {
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({ command: "editor:project:summary" }),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--project-id");
		});

		it("calls GET on summary endpoint", async () => {
			mockRoute("GET", "/api/claude/project/p1/summary", {
				success: true,
				data: { name: "My Project", totalDuration: 120 },
			});
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:project:summary",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(true);
			expect((result.data as { name: string }).name).toBe("My Project");
		});
	});

	describe("project:report", () => {
		it("requires project-id", async () => {
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({ command: "editor:project:report" }),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--project-id");
		});

		it("sends POST to report endpoint", async () => {
			mockRoute("POST", "/api/claude/project/p1/report", {
				success: true,
				data: { reportPath: "/tmp/report.md" },
			});
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:project:report",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(true);
		});
	});

	describe("project:update-settings missing data", () => {
		it("requires --data flag", async () => {
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:project:update-settings",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--data");
		});
	});

	describe("unknown project action", () => {
		it("returns error for unknown action", async () => {
			const result = await handleMediaProjectCommand(
				client,
				makeOpts({
					command: "editor:project:nonexistent",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown project action");
		});
	});
});

// ---------------------------------------------------------------------------
// 4. Untested timeline handlers
// ---------------------------------------------------------------------------

describe("Timeline handlers — uncovered actions", () => {
	let client: EditorApiClient;

	beforeAll(() => {
		installFetchMock(BASE_URL);
		client = new EditorApiClient({ baseUrl: BASE_URL });
	});

	afterEach(() => {
		clearRoutes();
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	describe("delete-element", () => {
		it("requires project-id and element-id", async () => {
			const result = await handleTimelineEditingCommand(
				client,
				makeOpts({
					command: "editor:timeline:delete-element",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--element-id");
		});

		it("sends DELETE to correct endpoint", async () => {
			mockRoute("DELETE", "/api/claude/timeline/p1/elements/e1", {
				success: true,
				data: { deleted: true },
			});
			const result = await handleTimelineEditingCommand(
				client,
				makeOpts({
					command: "editor:timeline:delete-element",
					projectId: "p1",
					elementId: "e1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(true);
			expect(lastCapturedMethod).toBe("DELETE");
		});
	});

	describe("batch-update", () => {
		it("requires --updates", async () => {
			const result = await handleTimelineEditingCommand(
				client,
				makeOpts({
					command: "editor:timeline:batch-update",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--updates");
		});

		it("rejects >50 updates", async () => {
			const updates = Array.from({ length: 51 }, (_, i) => ({
				elementId: `e${i}`,
				changes: { startTime: i },
			}));
			const result = await handleTimelineEditingCommand(
				client,
				makeOpts({
					command: "editor:timeline:batch-update",
					projectId: "p1",
					updates: JSON.stringify(updates),
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Batch limit");
		});

		it("sends PATCH with updates array", async () => {
			mockRoute("PATCH", "/api/claude/timeline/p1/elements/batch", {
				success: true,
				data: { updated: 2 },
			});
			const updates = [
				{ elementId: "e1", changes: { startTime: 0 } },
				{ elementId: "e2", changes: { startTime: 5 } },
			];
			const result = await handleTimelineEditingCommand(
				client,
				makeOpts({
					command: "editor:timeline:batch-update",
					projectId: "p1",
					updates: JSON.stringify(updates),
				}),
				noopProgress,
			);
			expect(result.success).toBe(true);
			const body = JSON.parse(lastCapturedBody!);
			expect(body.updates).toHaveLength(2);
		});
	});

	describe("select", () => {
		it("requires --elements", async () => {
			const result = await handleTimelineEditingCommand(
				client,
				makeOpts({
					command: "editor:timeline:select",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--elements");
		});

		it("sends POST with elements array", async () => {
			mockRoute("POST", "/api/claude/timeline/p1/selection", {
				success: true,
				data: { selected: 2 },
			});
			const result = await handleTimelineEditingCommand(
				client,
				makeOpts({
					command: "editor:timeline:select",
					projectId: "p1",
					elements:
						'[{"trackId":"t1","elementId":"e1"},{"trackId":"t1","elementId":"e2"}]',
				}),
				noopProgress,
			);
			expect(result.success).toBe(true);
			const body = JSON.parse(lastCapturedBody!);
			expect(body.elements).toHaveLength(2);
		});
	});

	describe("unknown timeline action", () => {
		it("returns error for unknown action", async () => {
			const result = await handleTimelineEditingCommand(
				client,
				makeOpts({
					command: "editor:timeline:nonexistent",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown timeline action");
		});
	});

	describe("unknown editing action", () => {
		it("returns error for unknown action", async () => {
			const result = await handleTimelineEditingCommand(
				client,
				makeOpts({
					command: "editor:editing:nonexistent",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown editing action");
		});
	});
});

// ---------------------------------------------------------------------------
// 5. Untested editing handlers
// ---------------------------------------------------------------------------

describe("Editing handlers — uncovered actions", () => {
	let client: EditorApiClient;

	beforeAll(() => {
		installFetchMock(BASE_URL);
		client = new EditorApiClient({ baseUrl: BASE_URL });
	});

	afterEach(() => {
		clearRoutes();
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	describe("auto-edit-status", () => {
		it("requires project-id and job-id", async () => {
			const result = await handleTimelineEditingCommand(
				client,
				makeOpts({
					command: "editor:editing:auto-edit-status",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--job-id");
		});

		it("calls GET on auto-edit job endpoint", async () => {
			mockRoute("GET", "/api/claude/timeline/p1/auto-edit/jobs/j1", {
				success: true,
				data: { status: "completed", progress: 100, edits: 5 },
			});
			const result = await handleTimelineEditingCommand(
				client,
				makeOpts({
					command: "editor:editing:auto-edit-status",
					projectId: "p1",
					jobId: "j1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(true);
			expect((result.data as { status: string }).status).toBe("completed");
		});
	});

	describe("delete-range with ripple flags", () => {
		it("sends ripple and crossTrackRipple in body", async () => {
			mockRoute("DELETE", "/api/claude/timeline/p1/range", {
				success: true,
				data: { deleted: 3 },
			});
			await handleTimelineEditingCommand(
				client,
				makeOpts({
					command: "editor:editing:delete-range",
					projectId: "p1",
					startTime: 1,
					endTime: 5,
					ripple: true,
					crossTrackRipple: true,
				}),
				noopProgress,
			);
			const body = JSON.parse(lastCapturedBody!);
			expect(body.ripple).toBe(true);
			expect(body.crossTrackRipple).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// 6. Untested generate/export handlers
// ---------------------------------------------------------------------------

describe("Generate handlers — uncovered actions", () => {
	let client: EditorApiClient;

	beforeAll(() => {
		installFetchMock(BASE_URL);
		client = new EditorApiClient({ baseUrl: BASE_URL });
	});

	afterEach(() => {
		clearRoutes();
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	describe("generate:list-jobs", () => {
		it("requires project-id", async () => {
			const result = await handleGenerateExportCommand(
				client,
				makeOpts({ command: "editor:generate:list-jobs" }),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--project-id");
		});

		it("calls GET on jobs endpoint", async () => {
			mockRoute("GET", "/api/claude/generate/p1/jobs", {
				success: true,
				data: { jobs: [{ jobId: "gj1", status: "completed" }] },
			});
			const result = await handleGenerateExportCommand(
				client,
				makeOpts({
					command: "editor:generate:list-jobs",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(true);
		});
	});

	describe("generate:start sends all optional fields", () => {
		it("includes imageUrl, duration, aspectRatio in body", async () => {
			mockRoute("POST", "/api/claude/generate/p1/start", {
				success: true,
				data: { jobId: "gj3" },
			});
			await handleGenerateExportCommand(
				client,
				makeOpts({
					command: "editor:generate:start",
					projectId: "p1",
					model: "kling_pro",
					text: "A sunset",
					imageUrl: "https://example.com/ref.jpg",
					duration: "5",
					aspectRatio: "16:9",
				}),
				noopProgress,
			);
			const body = JSON.parse(lastCapturedBody!);
			expect(body.model).toBe("kling_pro");
			expect(body.prompt).toBe("A sunset");
			expect(body.imageUrl).toBe("https://example.com/ref.jpg");
			expect(body.duration).toBe(5);
			expect(body.aspectRatio).toBe("16:9");
		});
	});

	describe("generate:start requires prompt or text", () => {
		it("fails when neither --prompt nor --text provided", async () => {
			const result = await handleGenerateExportCommand(
				client,
				makeOpts({
					command: "editor:generate:start",
					projectId: "p1",
					model: "flux_dev",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--prompt");
		});
	});

	describe("export:status requires job-id", () => {
		it("requires job-id", async () => {
			const result = await handleGenerateExportCommand(
				client,
				makeOpts({
					command: "editor:export:status",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--job-id");
		});
	});

	describe("unknown generate/export/diagnostics/mcp action", () => {
		it("unknown generate action", async () => {
			const result = await handleGenerateExportCommand(
				client,
				makeOpts({ command: "editor:generate:nonexistent" }),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown generate action");
		});

		it("unknown export action", async () => {
			const result = await handleGenerateExportCommand(
				client,
				makeOpts({ command: "editor:export:nonexistent" }),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown export action");
		});

		it("unknown diagnostics action", async () => {
			const result = await handleGenerateExportCommand(
				client,
				makeOpts({ command: "editor:diagnostics:nonexistent" }),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown diagnostics action");
		});

		it("unknown mcp action", async () => {
			const result = await handleGenerateExportCommand(
				client,
				makeOpts({ command: "editor:mcp:nonexistent" }),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown mcp action");
		});

		it("unknown module falls through", async () => {
			const result = await handleGenerateExportCommand(
				client,
				makeOpts({ command: "editor:unknown:action" }),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown module");
		});
	});
});

// ---------------------------------------------------------------------------
// 7. Analysis edge cases
// ---------------------------------------------------------------------------

describe("Analysis handlers — edge cases", () => {
	let client: EditorApiClient;

	beforeAll(() => {
		installFetchMock(BASE_URL);
		client = new EditorApiClient({ baseUrl: BASE_URL });
	});

	afterEach(() => {
		clearRoutes();
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	describe("analyze:video requires source", () => {
		it("fails when source is missing", async () => {
			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:analyze:video",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--source");
		});
	});

	describe("analyze:frames requires media-id", () => {
		it("fails without media-id", async () => {
			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:analyze:frames",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--media-id");
		});
	});

	describe("unknown analyze action", () => {
		it("returns error for unknown action", async () => {
			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:analyze:nonexistent",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown analyze action");
		});
	});

	describe("unknown transcribe action", () => {
		it("returns error for unknown action", async () => {
			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:transcribe:nonexistent",
					projectId: "p1",
				}),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown transcribe action");
		});
	});

	describe("unknown module in analysis handler", () => {
		it("returns error for unknown module", async () => {
			const result = await handleAnalysisCommand(
				client,
				makeOpts({ command: "editor:unknown:action" }),
				noopProgress,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown module");
		});
	});
});

// ---------------------------------------------------------------------------
// 8. EditorApiClient — error handling edge cases
// ---------------------------------------------------------------------------

describe("EditorApiClient — error edge cases", () => {
	let client: EditorApiClient;

	beforeAll(() => {
		installFetchMock(BASE_URL);
		client = new EditorApiClient({ baseUrl: BASE_URL });
	});

	afterEach(() => {
		clearRoutes();
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	it("patch sends correct method", async () => {
		mockRoute("PATCH", "/api/claude/test/patch", {
			success: true,
			data: { patched: true },
		});
		const result = await client.patch("/api/claude/test/patch", {
			key: "val",
		});
		expect(result).toEqual({ patched: true });
		expect(lastCapturedMethod).toBe("PATCH");
	});

	it("delete sends correct method", async () => {
		mockRoute("DELETE", "/api/claude/test/delete", {
			success: true,
			data: { deleted: true },
		});
		const result = await client.delete("/api/claude/test/delete");
		expect(result).toEqual({ deleted: true });
		expect(lastCapturedMethod).toBe("DELETE");
	});

	it("delete sends body when provided", async () => {
		mockRoute("DELETE", "/api/claude/test/delete-body", {
			success: true,
			data: { deleted: true },
		});
		await client.delete("/api/claude/test/delete-body", {
			ids: ["a", "b"],
		});
		const body = JSON.parse(lastCapturedBody!);
		expect(body.ids).toEqual(["a", "b"]);
	});

	it("pollJob handles cancelled status", async () => {
		const origFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return new Response(
				JSON.stringify({
					success: true,
					data: { status: "cancelled" },
				}),
				{ headers: { "Content-Type": "application/json" } },
			);
		};

		await expect(
			client.pollJob("/api/claude/jobs/cancelled1", { interval: 10 }),
		).rejects.toThrow("cancelled");

		globalThis.fetch = origFetch;
		installFetchMock(BASE_URL);
	});
});

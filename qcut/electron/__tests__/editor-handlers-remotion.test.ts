// Location: electron/__tests__/editor-handlers-remotion.test.ts
//
// Tests for Remotion CLI handlers (Task 2 of remotion-first-class-timeline-plan.md)

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { handleRemotionCommand } from "../native-pipeline/editor/editor-handlers-remotion.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner.js";

// ---------------------------------------------------------------------------
// Mock HTTP server using global fetch mock
// ---------------------------------------------------------------------------

const routes = new Map<string, { status: number; body: unknown }>();

function mockRoute(method: string, path: string, body: unknown, status = 200) {
	routes.set(`${method} ${path}`, { status, body });
}

function clearRoutes() {
	routes.clear();
}

const originalFetch = globalThis.fetch;
const BASE_URL = "http://127.0.0.1:19878";

function installFetchMock(baseUrl: string) {
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		const method = init?.method ?? "GET";
		const pathname = url.replace(baseUrl, "").split("?")[0];
		const key = `${method} ${pathname}`;

		const route = routes.get(key);
		if (!route) {
			return new Response(
				JSON.stringify({
					success: false,
					error: `Not found: ${key}`,
					timestamp: Date.now(),
				}),
				{ status: 404, headers: { "Content-Type": "application/json" } }
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
		command: "editor:remotion:list",
		outputDir: "./output",
		json: false,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		...overrides,
	} as CLIRunOptions;
}

const MOCK_TIMELINE = {
	success: true,
	data: {
		tracks: [
			{
				id: "media-1",
				type: "media",
				elements: [
					{
						id: "el-m1",
						type: "media",
						mediaId: "img-1",
						name: "Photo",
						startTime: 0,
						duration: 5,
						trimStart: 0,
						trimEnd: 0,
					},
				],
			},
			{
				id: "remotion-1",
				type: "remotion",
				elements: [
					{
						id: "el-r1",
						type: "remotion",
						componentId: "GoodManners",
						componentPath: "/output/GoodManners/src/GoodManners.tsx",
						props: { title: "Manners" },
						startTime: 0,
						duration: 12,
						trimStart: 0,
						trimEnd: 0,
						renderMode: "live",
					},
					{
						id: "el-r2",
						type: "remotion",
						componentId: "GoodManners",
						props: { title: "Part 2" },
						startTime: 12,
						duration: 6,
						trimStart: 3,
						trimEnd: 0,
						renderMode: "cached",
					},
				],
			},
		],
	},
	timestamp: Date.now(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Remotion CLI handlers", () => {
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

	describe("editor:remotion:list", () => {
		it("lists remotion elements from timeline", async () => {
			mockRoute("GET", "/api/claude/timeline/proj-1", MOCK_TIMELINE);

			const result = await handleRemotionCommand(
				client,
				makeOpts({
					command: "editor:remotion:list",
					projectId: "proj-1",
				})
			);

			expect(result.success).toBe(true);
			const data = result.data as { count: number; elements: unknown[] };
			expect(data.count).toBe(2);
			expect(data.elements).toHaveLength(2);
		});

		it("returns empty list when no remotion elements", async () => {
			mockRoute("GET", "/api/claude/timeline/proj-2", {
				success: true,
				data: {
					tracks: [
						{
							id: "media-1",
							type: "media",
							elements: [
								{
									id: "el-1",
									type: "media",
									startTime: 0,
									duration: 5,
									trimStart: 0,
									trimEnd: 0,
								},
							],
						},
					],
				},
				timestamp: Date.now(),
			});

			const result = await handleRemotionCommand(
				client,
				makeOpts({
					command: "editor:remotion:list",
					projectId: "proj-2",
				})
			);

			expect(result.success).toBe(true);
			const data = result.data as { count: number; elements: unknown[] };
			expect(data.count).toBe(0);
		});

		it("fails without project-id", async () => {
			const result = await handleRemotionCommand(
				client,
				makeOpts({ command: "editor:remotion:list" })
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--project-id");
		});
	});

	describe("editor:remotion:inspect", () => {
		it("returns element details", async () => {
			mockRoute("GET", "/api/claude/timeline/proj-1", MOCK_TIMELINE);

			const result = await handleRemotionCommand(
				client,
				makeOpts({
					command: "editor:remotion:inspect",
					projectId: "proj-1",
					elementId: "el-r1",
				})
			);

			expect(result.success).toBe(true);
			const data = result.data as {
				elementId: string;
				componentId: string;
				props: Record<string, unknown>;
			};
			expect(data.elementId).toBe("el-r1");
			expect(data.componentId).toBe("GoodManners");
			expect(data.props).toEqual({ title: "Manners" });
		});

		it("fails for non-existent element", async () => {
			mockRoute("GET", "/api/claude/timeline/proj-1", MOCK_TIMELINE);

			const result = await handleRemotionCommand(
				client,
				makeOpts({
					command: "editor:remotion:inspect",
					projectId: "proj-1",
					elementId: "nonexistent",
				})
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("not found");
		});
	});

	describe("editor:remotion:update-props", () => {
		it("sends PATCH with props", async () => {
			mockRoute(
				"PATCH",
				"/api/claude/timeline/proj-1/elements/el-r1",
				{ success: true, data: { updated: true } }
			);

			const result = await handleRemotionCommand(
				client,
				makeOpts({
					command: "editor:remotion:update-props",
					projectId: "proj-1",
					elementId: "el-r1",
					data: '{"title": "Updated Manners"}',
				})
			);

			expect(result.success).toBe(true);
		});

		it("fails without element-id", async () => {
			const result = await handleRemotionCommand(
				client,
				makeOpts({
					command: "editor:remotion:update-props",
					projectId: "proj-1",
				})
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--element-id");
		});

		it("fails without data", async () => {
			const result = await handleRemotionCommand(
				client,
				makeOpts({
					command: "editor:remotion:update-props",
					projectId: "proj-1",
					elementId: "el-r1",
				})
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--data");
		});
	});

	describe("editor:remotion:export", () => {
		it("sends POST with remotion engine type", async () => {
			mockRoute(
				"POST",
				"/api/claude/export/proj-1/start",
				{ success: true, data: { jobId: "export-1", status: "queued" } }
			);

			const result = await handleRemotionCommand(
				client,
				makeOpts({
					command: "editor:remotion:export",
					projectId: "proj-1",
				})
			);

			expect(result.success).toBe(true);
		});
	});

	describe("unknown action", () => {
		it("returns error for unknown action", async () => {
			const result = await handleRemotionCommand(
				client,
				makeOpts({ command: "editor:remotion:unknown" })
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown remotion action");
		});
	});
});

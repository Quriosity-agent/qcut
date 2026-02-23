import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EditorApiClient } from "../native-pipeline/editor-api-client.js";
import {
	handleAnalysisCommand,
	parseSource,
} from "../native-pipeline/editor-handlers-analysis.js";
import type { CLIRunOptions } from "../native-pipeline/cli-runner.js";

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

function makeOpts(overrides: Partial<CLIRunOptions>): CLIRunOptions {
	return {
		command: "editor:analyze:video",
		outputDir: "./output",
		json: false,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		...overrides,
	} as CLIRunOptions;
}

const noopProgress = () => {};

// ---------------------------------------------------------------------------
// parseSource unit tests
// ---------------------------------------------------------------------------

describe("parseSource", () => {
	it('parses "media:abc123"', () => {
		const result = parseSource("media:abc123");
		expect(result).toEqual({ type: "media", mediaId: "abc123" });
	});

	it('parses "path:/tmp/video.mp4"', () => {
		const result = parseSource("path:/tmp/video.mp4");
		expect(result).toEqual({ type: "path", filePath: "/tmp/video.mp4" });
	});

	it('parses "timeline:elem1"', () => {
		const result = parseSource("timeline:elem1");
		expect(result).toEqual({ type: "timeline", elementId: "elem1" });
	});

	it("falls back to path for bare paths", () => {
		const result = parseSource("/tmp/video.mp4");
		expect(result).toEqual({ type: "path", filePath: "/tmp/video.mp4" });
	});
});

// ---------------------------------------------------------------------------
// Analyze handlers
// ---------------------------------------------------------------------------

describe("Analyze handlers", () => {
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

	describe("analyze:video", () => {
		it("requires project-id and source", async () => {
			const result = await handleAnalysisCommand(
				client,
				makeOpts({ command: "editor:analyze:video" }),
				noopProgress
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--project-id");
		});

		it("sends source and analysisType in body", async () => {
			let capturedBody: string | null = null;
			const origFetch = globalThis.fetch;
			globalThis.fetch = async (
				_input: RequestInfo | URL,
				init?: RequestInit
			) => {
				capturedBody = init?.body as string;
				return new Response(
					JSON.stringify({ success: true, data: { analysis: "done" } }),
					{ headers: { "Content-Type": "application/json" } }
				);
			};

			await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:analyze:video",
					projectId: "p1",
					source: "media:m1",
					analysisType: "describe",
				}),
				noopProgress
			);

			const body = JSON.parse(capturedBody!);
			expect(body.source).toEqual({ type: "media", mediaId: "m1" });
			expect(body.analysisType).toBe("describe");

			globalThis.fetch = origFetch;
			installFetchMock(BASE_URL);
		});
	});

	describe("analyze:models", () => {
		it("calls GET on models endpoint", async () => {
			mockRoute("GET", "/api/claude/analyze/models", {
				success: true,
				data: { models: [] },
			});
			const result = await handleAnalysisCommand(
				client,
				makeOpts({ command: "editor:analyze:models" }),
				noopProgress
			);
			expect(result.success).toBe(true);
		});
	});

	describe("analyze:scenes", () => {
		it("requires media-id", async () => {
			const result = await handleAnalysisCommand(
				client,
				makeOpts({ command: "editor:analyze:scenes", projectId: "p1" }),
				noopProgress
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--media-id");
		});

		it("sends threshold in body when provided", async () => {
			let capturedBody: string | null = null;
			const origFetch = globalThis.fetch;
			globalThis.fetch = async (
				_input: RequestInfo | URL,
				init?: RequestInit
			) => {
				capturedBody = init?.body as string;
				return new Response(
					JSON.stringify({ success: true, data: { scenes: [] } }),
					{ headers: { "Content-Type": "application/json" } }
				);
			};

			await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:analyze:scenes",
					projectId: "p1",
					mediaId: "m1",
					threshold: 0.5,
				}),
				noopProgress
			);

			expect(JSON.parse(capturedBody!).threshold).toBe(0.5);

			globalThis.fetch = origFetch;
			installFetchMock(BASE_URL);
		});
	});

	describe("analyze:frames", () => {
		it("parses comma-separated timestamps", async () => {
			let capturedBody: string | null = null;
			const origFetch = globalThis.fetch;
			globalThis.fetch = async (
				_input: RequestInfo | URL,
				init?: RequestInit
			) => {
				capturedBody = init?.body as string;
				return new Response(
					JSON.stringify({ success: true, data: { frames: [] } }),
					{ headers: { "Content-Type": "application/json" } }
				);
			};

			await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:analyze:frames",
					projectId: "p1",
					mediaId: "m1",
					timestamps: "0,5,10",
				}),
				noopProgress
			);

			expect(JSON.parse(capturedBody!).timestamps).toEqual([0, 5, 10]);

			globalThis.fetch = origFetch;
			installFetchMock(BASE_URL);
		});

		it("filters NaN from timestamps", async () => {
			let capturedBody: string | null = null;
			const origFetch = globalThis.fetch;
			globalThis.fetch = async (
				_input: RequestInfo | URL,
				init?: RequestInit
			) => {
				capturedBody = init?.body as string;
				return new Response(
					JSON.stringify({ success: true, data: { frames: [] } }),
					{ headers: { "Content-Type": "application/json" } }
				);
			};

			await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:analyze:frames",
					projectId: "p1",
					mediaId: "m1",
					timestamps: "0,invalid,10",
				}),
				noopProgress
			);

			expect(JSON.parse(capturedBody!).timestamps).toEqual([0, 10]);

			globalThis.fetch = origFetch;
			installFetchMock(BASE_URL);
		});
	});

	describe("analyze:fillers", () => {
		it("requires project-id", async () => {
			const result = await handleAnalysisCommand(
				client,
				makeOpts({ command: "editor:analyze:fillers" }),
				noopProgress
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--project-id");
		});

		it("sends mediaId when provided", async () => {
			mockRoute("POST", "/api/claude/analyze/p1/fillers", {
				success: true,
				data: { fillers: [], silences: [] },
			});
			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:analyze:fillers",
					projectId: "p1",
					mediaId: "m1",
				}),
				noopProgress
			);
			expect(result.success).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// Transcribe handlers
// ---------------------------------------------------------------------------

describe("Transcribe handlers", () => {
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

	describe("transcribe:run", () => {
		it("sends sync POST", async () => {
			mockRoute("POST", "/api/claude/transcribe/p1", {
				success: true,
				data: { words: [], duration: 10 },
			});
			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:transcribe:run",
					projectId: "p1",
					mediaId: "m1",
				}),
				noopProgress
			);
			expect(result.success).toBe(true);
		});

		it("requires media-id", async () => {
			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:transcribe:run",
					projectId: "p1",
				}),
				noopProgress
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--media-id");
		});
	});

	describe("transcribe:start", () => {
		it("without --poll returns jobId", async () => {
			mockRoute("POST", "/api/claude/transcribe/p1/start", {
				success: true,
				data: { jobId: "tj1" },
			});
			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:transcribe:start",
					projectId: "p1",
					mediaId: "m1",
				}),
				noopProgress
			);
			expect(result.success).toBe(true);
			expect((result.data as { jobId: string }).jobId).toBe("tj1");
		});

		it("with --poll calls pollJob", async () => {
			let callCount = 0;
			const origFetch = globalThis.fetch;
			globalThis.fetch = async (
				input: RequestInfo | URL,
				init?: RequestInit
			) => {
				const url = input.toString();
				const method = init?.method ?? "GET";
				callCount++;

				if (method === "POST" && url.includes("/start")) {
					return new Response(
						JSON.stringify({ success: true, data: { jobId: "tj2" } }),
						{ headers: { "Content-Type": "application/json" } }
					);
				}

				if (method === "GET" && url.includes("/jobs/tj2")) {
					return new Response(
						JSON.stringify({
							success: true,
							data:
								callCount >= 4
									? { status: "completed", progress: 100, result: {} }
									: { status: "running", progress: 50 },
						}),
						{ headers: { "Content-Type": "application/json" } }
					);
				}

				return new Response(
					JSON.stringify({ success: false, error: "unexpected" }),
					{ status: 404, headers: { "Content-Type": "application/json" } }
				);
			};

			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:transcribe:start",
					projectId: "p1",
					mediaId: "m1",
					poll: true,
					pollInterval: 0.01,
				}),
				noopProgress
			);

			expect(result.success).toBe(true);
			expect(callCount).toBeGreaterThanOrEqual(3);

			globalThis.fetch = origFetch;
			installFetchMock(BASE_URL);
		});
	});

	describe("transcribe:status", () => {
		it("requires job-id", async () => {
			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:transcribe:status",
					projectId: "p1",
				}),
				noopProgress
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("--job-id");
		});

		it("calls GET on job endpoint", async () => {
			mockRoute("GET", "/api/claude/transcribe/p1/jobs/j1", {
				success: true,
				data: { status: "running", progress: 40 },
			});
			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:transcribe:status",
					projectId: "p1",
					jobId: "j1",
				}),
				noopProgress
			);
			expect(result.success).toBe(true);
		});
	});

	describe("transcribe:list-jobs", () => {
		it("calls GET on jobs endpoint", async () => {
			mockRoute("GET", "/api/claude/transcribe/p1/jobs", {
				success: true,
				data: { jobs: [] },
			});
			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:transcribe:list-jobs",
					projectId: "p1",
				}),
				noopProgress
			);
			expect(result.success).toBe(true);
		});
	});

	describe("transcribe:cancel", () => {
		it("sends POST to cancel endpoint", async () => {
			mockRoute("POST", "/api/claude/transcribe/p1/jobs/j1/cancel", {
				success: true,
				data: { cancelled: true },
			});
			const result = await handleAnalysisCommand(
				client,
				makeOpts({
					command: "editor:transcribe:cancel",
					projectId: "p1",
					jobId: "j1",
				}),
				noopProgress
			);
			expect(result.success).toBe(true);
		});
	});
});

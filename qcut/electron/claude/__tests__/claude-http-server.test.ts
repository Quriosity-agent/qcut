/**
 * Integration tests for the Claude HTTP Server.
 * Uses a real HTTP server on an ephemeral port, with mocked Electron and handler functions.
 */

import {
	describe,
	it,
	expect,
	vi,
	beforeAll,
	afterAll,
	beforeEach,
} from "vitest";
import * as http from "node:http";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the server module
// ---------------------------------------------------------------------------

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/mock/Documents"),
		getVersion: vi.fn(() => "1.0.0-test"),
	},
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
	},
	BrowserWindow: {
		getAllWindows: vi.fn(() => []),
		fromWebContents: vi.fn(() => null),
	},
}));

vi.mock("electron-log", () => ({
	default: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		log: vi.fn(),
	},
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
}));

// Mock the handler functions so we don't need real file system
vi.mock("../claude-media-handler.js", () => ({
	listMediaFiles: vi.fn(async () => []),
	getMediaInfo: vi.fn(async () => null),
	importMediaFile: vi.fn(async () => null),
	deleteMediaFile: vi.fn(async () => false),
	renameMediaFile: vi.fn(async () => false),
}));

vi.mock("../claude-timeline-handler.js", () => ({
	requestTimelineFromRenderer: vi.fn(),
	requestSplitFromRenderer: vi.fn(),
	requestSelectionFromRenderer: vi.fn(),
	batchAddElements: vi.fn(async () => ({ added: [], failedCount: 0 })),
	batchUpdateElements: vi.fn(async () => ({
		updatedCount: 0,
		failedCount: 0,
		results: [],
	})),
	batchDeleteElements: vi.fn(async () => ({
		deletedCount: 0,
		failedCount: 0,
		results: [],
	})),
	deleteTimelineRange: vi.fn(async () => ({
		deletedElements: 0,
		splitElements: 0,
		totalRemovedDuration: 0,
	})),
	arrangeTimeline: vi.fn(async () => ({ arranged: [] })),
	timelineToMarkdown: vi.fn(() => "# Timeline"),
	markdownToTimeline: vi.fn(() => ({
		name: "Test",
		duration: 0,
		width: 1920,
		height: 1080,
		fps: 30,
		tracks: [],
	})),
	validateTimeline: vi.fn(),
}));

vi.mock("../claude-project-handler.js", () => ({
	getProjectSettings: vi.fn(async () => ({
		name: "Test",
		width: 1920,
		height: 1080,
		fps: 30,
		aspectRatio: "16:9",
		backgroundColor: "#000",
		exportFormat: "mp4",
		exportQuality: "high",
	})),
	updateProjectSettings: vi.fn(async () => {}),
	getProjectStats: vi.fn(async () => ({
		totalDuration: 0,
		mediaCount: { video: 0, audio: 0, image: 0 },
		trackCount: 0,
		elementCount: 0,
		lastModified: Date.now(),
		fileSize: 0,
	})),
	getEmptyStats: vi.fn(() => ({
		totalDuration: 0,
		mediaCount: { video: 0, audio: 0, image: 0 },
		trackCount: 0,
		elementCount: 0,
		lastModified: Date.now(),
		fileSize: 0,
	})),
}));

vi.mock("../claude-export-handler.js", () => ({
	getExportPresets: vi.fn(() => [
		{
			id: "youtube-1080p",
			name: "YouTube 1080p",
			platform: "youtube",
			width: 1920,
			height: 1080,
			fps: 30,
			bitrate: "8Mbps",
			format: "mp4",
		},
	]),
	getExportRecommendation: vi.fn(() => ({
		preset: {
			id: "youtube-1080p",
			name: "YouTube 1080p",
			platform: "youtube",
			width: 1920,
			height: 1080,
			fps: 30,
			bitrate: "8Mbps",
			format: "mp4",
		},
		warnings: [],
		suggestions: [],
	})),
}));

vi.mock("../claude-diagnostics-handler.js", () => ({
	analyzeError: vi.fn(() => ({
		errorType: "unknown",
		severity: "medium",
		possibleCauses: [],
		suggestedFixes: [],
		canAutoFix: false,
		systemInfo: {
			platform: "test",
			arch: "x64",
			osVersion: "1.0",
			appVersion: "1.0",
			nodeVersion: "20",
			electronVersion: "30",
			memory: { total: 1, free: 1, used: 0 },
			cpuCount: 4,
		},
	})),
	getSystemInfo: vi.fn(() => ({})),
}));

vi.mock(
	"../claude-suggest-handler.js",
	() => ({
		suggestCuts: vi.fn(async () => ({ suggestions: [] })),
	}),
	{ virtual: true }
);

vi.mock("../claude-range-handler.js", () => ({
	executeDeleteRange: vi.fn(async () => ({
		deletedElements: 0,
		splitElements: 0,
		totalRemovedDuration: 0,
	})),
	validateRangeDeleteRequest: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the server and mocked electron after mocks
// ---------------------------------------------------------------------------

import {
	startClaudeHTTPServer,
	stopClaudeHTTPServer,
} from "../claude-http-server";
import { BrowserWindow } from "electron";
import * as timelineHandler from "../claude-timeline-handler.js";
import * as rangeHandler from "../claude-range-handler.js";
import { HttpError } from "../utils/http-router";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let serverPort: number;

function fetch(
	path: string,
	options: {
		method?: string;
		body?: string;
		headers?: Record<string, string>;
	} = {}
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port: serverPort,
				path,
				method: options.method || "GET",
				headers: {
					"Content-Type": "application/json",
					...(options.body
						? { "Content-Length": Buffer.byteLength(options.body) }
						: {}),
					...options.headers,
				},
			},
			(res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					try {
						resolve({
							status: res.statusCode || 0,
							body: JSON.parse(data),
							headers: res.headers,
						});
					} catch {
						resolve({
							status: res.statusCode || 0,
							body: data,
							headers: res.headers,
						});
					}
				});
			}
		);
		req.on("error", reject);
		if (options.body) req.write(options.body);
		req.end();
	});
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

// Use a random ephemeral port to avoid conflicts
beforeAll(async () => {
	serverPort = 0; // Will be assigned by OS
	// We need to start on port 0 and find the assigned port
	// Since startClaudeHTTPServer uses a fixed port, we set the env var
	serverPort = 18_765 + Math.floor(Math.random() * 1000);
	process.env.QCUT_API_PORT = String(serverPort);
	delete process.env.QCUT_API_TOKEN;

	startClaudeHTTPServer(serverPort);

	// Wait for server to be ready
	await new Promise((resolve) => setTimeout(resolve, 100));
});

afterAll(() => {
	stopClaudeHTTPServer();
	delete process.env.QCUT_API_PORT;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Claude HTTP Server", () => {
	it("POST /api/claude/timeline/:projectId/elements/:elementId/split returns split result", async () => {
		const mockWindow = {
			webContents: { send: vi.fn() },
		} as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);
		vi.mocked(timelineHandler.requestSplitFromRenderer).mockResolvedValueOnce({
			secondElementId: "element_split_2",
		});

		const res = await fetch(
			"/api/claude/timeline/proj_123/elements/element_abc/split",
			{
				method: "POST",
				body: JSON.stringify({ splitTime: 3.5 }),
			}
		);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.secondElementId).toBe("element_split_2");
		expect(timelineHandler.requestSplitFromRenderer).toHaveBeenCalledWith(
			mockWindow,
			"element_abc",
			3.5,
			"split"
		);
	});

	it("POST /api/claude/timeline/:projectId/elements/:elementId/split validates splitTime", async () => {
		const res = await fetch(
			"/api/claude/timeline/proj_123/elements/element_abc/split",
			{
				method: "POST",
				body: JSON.stringify({ mode: "split" }),
			}
		);

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
		expect(res.body.error).toContain("splitTime");
	});

	it("POST /api/claude/timeline/:projectId/elements/:elementId/split validates mode", async () => {
		const mockWindow = {
			webContents: { send: vi.fn() },
		} as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);

		const res = await fetch(
			"/api/claude/timeline/proj_123/elements/element_abc/split",
			{
				method: "POST",
				body: JSON.stringify({ splitTime: 3.5, mode: "invalid_mode" }),
			}
		);

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
		expect(res.body.error).toContain("Invalid mode");
	});

	it("POST /api/claude/timeline/:projectId/elements/:elementId/move dispatches move event", async () => {
		const send = vi.fn();
		const mockWindow = { webContents: { send } } as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);

		const res = await fetch(
			"/api/claude/timeline/proj_123/elements/element_abc/move",
			{
				method: "POST",
				body: JSON.stringify({ toTrackId: "track_2", newStartTime: 5 }),
			}
		);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.moved).toBe(true);
		expect(send).toHaveBeenCalledWith("claude:timeline:moveElement", {
			elementId: "element_abc",
			toTrackId: "track_2",
			newStartTime: 5,
		});
	});

	it("POST /api/claude/timeline/:projectId/elements/batch calls batch add handler", async () => {
		const mockWindow = {
			webContents: { send: vi.fn() },
		} as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);
		vi.mocked(timelineHandler.batchAddElements).mockResolvedValueOnce({
			added: [{ index: 0, success: true, elementId: "el_1" }],
			failedCount: 0,
		});

		const res = await fetch("/api/claude/timeline/proj_123/elements/batch", {
			method: "POST",
			body: JSON.stringify({
				elements: [
					{
						type: "media",
						trackId: "track_1",
						startTime: 0,
						duration: 5,
						mediaId: "media_1",
					},
				],
			}),
		});

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.failedCount).toBe(0);
		expect(timelineHandler.batchAddElements).toHaveBeenCalledWith(
			mockWindow,
			"proj_123",
			expect.any(Array)
		);
	});

	it("PATCH /api/claude/timeline/:projectId/elements/batch calls batch update handler", async () => {
		const mockWindow = {
			webContents: { send: vi.fn() },
		} as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);
		vi.mocked(timelineHandler.batchUpdateElements).mockResolvedValueOnce({
			updatedCount: 1,
			failedCount: 0,
			results: [{ index: 0, success: true }],
		});

		const res = await fetch("/api/claude/timeline/proj_123/elements/batch", {
			method: "PATCH",
			body: JSON.stringify({
				updates: [{ elementId: "el_1", startTime: 3 }],
			}),
		});

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.updatedCount).toBe(1);
		expect(timelineHandler.batchUpdateElements).toHaveBeenCalledWith(
			mockWindow,
			[{ elementId: "el_1", startTime: 3 }]
		);
	});

	it("DELETE /api/claude/timeline/:projectId/elements/batch calls batch delete handler", async () => {
		const mockWindow = {
			webContents: { send: vi.fn() },
		} as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);
		vi.mocked(timelineHandler.batchDeleteElements).mockResolvedValueOnce({
			deletedCount: 1,
			failedCount: 0,
			results: [{ index: 0, success: true }],
		});

		const res = await fetch("/api/claude/timeline/proj_123/elements/batch", {
			method: "DELETE",
			body: JSON.stringify({
				elements: [{ trackId: "track_1", elementId: "el_1" }],
				ripple: true,
			}),
		});

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.deletedCount).toBe(1);
		expect(timelineHandler.batchDeleteElements).toHaveBeenCalledWith(
			mockWindow,
			[{ trackId: "track_1", elementId: "el_1" }],
			true
		);
	});

	it("DELETE /api/claude/timeline/:projectId/range forwards crossTrackRipple", async () => {
		const mockWindow = {
			webContents: { send: vi.fn() },
		} as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);
		vi.mocked(rangeHandler.executeDeleteRange).mockResolvedValueOnce({
			deletedElements: 2,
			splitElements: 1,
			totalRemovedDuration: 5,
		});

		const res = await fetch("/api/claude/timeline/proj_123/range", {
			method: "DELETE",
			body: JSON.stringify({
				startTime: 10,
				endTime: 15,
				ripple: true,
				crossTrackRipple: true,
			}),
		});

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.totalRemovedDuration).toBe(5);
		expect(rangeHandler.executeDeleteRange).toHaveBeenCalledWith(
			mockWindow,
			expect.objectContaining({
				startTime: 10,
				endTime: 15,
				ripple: true,
				crossTrackRipple: true,
			})
		);
	});

	it("POST /api/claude/timeline/:projectId/arrange calls arrange handler", async () => {
		const mockWindow = {
			webContents: { send: vi.fn() },
		} as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);
		vi.mocked(timelineHandler.arrangeTimeline).mockResolvedValueOnce({
			arranged: [{ elementId: "el_1", newStartTime: 0 }],
		});

		const res = await fetch("/api/claude/timeline/proj_123/arrange", {
			method: "POST",
			body: JSON.stringify({
				trackId: "track_1",
				mode: "sequential",
				gap: 0.5,
				startOffset: 0,
			}),
		});

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.arranged.length).toBe(1);
		expect(timelineHandler.arrangeTimeline).toHaveBeenCalledWith(
			mockWindow,
			expect.objectContaining({
				trackId: "track_1",
				mode: "sequential",
			})
		);
	});

	it("POST /api/claude/timeline/:projectId/selection dispatches selection update", async () => {
		const send = vi.fn();
		const mockWindow = { webContents: { send } } as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);
		const elements = [{ trackId: "track_1", elementId: "element_abc" }];

		const res = await fetch("/api/claude/timeline/proj_123/selection", {
			method: "POST",
			body: JSON.stringify({ elements }),
		});

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.selected).toBe(1);
		expect(send).toHaveBeenCalledWith("claude:timeline:selectElements", {
			elements,
		});
	});

	it("GET /api/claude/timeline/:projectId/selection returns renderer selection", async () => {
		const mockWindow = {
			webContents: { send: vi.fn() },
		} as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);
		vi.mocked(
			timelineHandler.requestSelectionFromRenderer
		).mockResolvedValueOnce([{ trackId: "track_1", elementId: "element_abc" }]);

		const res = await fetch("/api/claude/timeline/proj_123/selection");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.elements).toEqual([
			{ trackId: "track_1", elementId: "element_abc" },
		]);
		expect(timelineHandler.requestSelectionFromRenderer).toHaveBeenCalledWith(
			mockWindow
		);
	});

	it("GET /api/claude/timeline/:projectId/selection returns 504 on renderer timeout", async () => {
		const mockWindow = {
			webContents: { send: vi.fn() },
		} as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);
		vi.mocked(
			timelineHandler.requestSelectionFromRenderer
		).mockRejectedValueOnce(new HttpError(504, "Renderer timed out"));

		const res = await fetch("/api/claude/timeline/proj_123/selection");

		expect(res.status).toBe(504);
		expect(res.body.success).toBe(false);
		expect(res.body.error).toContain("Renderer timed out");
	});

	it("DELETE /api/claude/timeline/:projectId/selection clears selection", async () => {
		const send = vi.fn();
		const mockWindow = { webContents: { send } } as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);

		const res = await fetch("/api/claude/timeline/proj_123/selection", {
			method: "DELETE",
		});

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.cleared).toBe(true);
		expect(send).toHaveBeenCalledWith("claude:timeline:clearSelection");
	});

	it("POST /api/claude/timeline/:projectId/import rejects malformed markdown", async () => {
		const send = vi.fn();
		const mockWindow = { webContents: { send } } as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([mockWindow]);
		vi.mocked(timelineHandler.markdownToTimeline).mockImplementationOnce(() => {
			throw new Error("Invalid timeline markdown: No tracks found");
		});

		const res = await fetch("/api/claude/timeline/proj_123/import", {
			method: "POST",
			body: JSON.stringify({
				format: "md",
				data: "# Not a timeline\n\nSome text.",
			}),
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
		expect(res.body.error).toContain("No tracks found");
	});

	it("GET /api/claude/health returns status ok", async () => {
		const res = await fetch("/api/claude/health");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.status).toBe("ok");
		expect(res.body.data.version).toBe("1.0.0-test");
		expect(res.body.data.uptime).toBeTypeOf("number");
		expect(res.headers["access-control-allow-origin"]).toBe("*");
	});

	it("responds to CORS preflight OPTIONS requests", async () => {
		const res = await fetch("/api/claude/project/proj_123/settings", {
			method: "OPTIONS",
		});

		expect(res.status).toBe(204);
		expect(res.headers["access-control-allow-methods"]).toContain("OPTIONS");
	});

	it("GET /api/claude/media/:projectId returns media list", async () => {
		const res = await fetch("/api/claude/media/proj_123");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Array.isArray(res.body.data)).toBe(true);
	});

	it("POST /api/claude/media/:projectId/import validates source", async () => {
		// Missing source
		const res = await fetch("/api/claude/media/proj_123/import", {
			method: "POST",
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
		expect(res.body.error).toContain("source");
	});

	it("GET /api/claude/export/presets returns preset list", async () => {
		const res = await fetch("/api/claude/export/presets");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Array.isArray(res.body.data)).toBe(true);
		expect(res.body.data.length).toBeGreaterThan(0);
	});

	it("GET /api/claude/project/:projectId/settings returns settings", async () => {
		const res = await fetch("/api/claude/project/proj_123/settings");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.name).toBe("Test");
		expect(res.body.data.width).toBe(1920);
	});

	it("GET /api/claude/project/:projectId/stats returns empty stats when no window", async () => {
		const res = await fetch("/api/claude/project/proj_123/stats");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.totalDuration).toBe(0);
	});

	it("GET /api/claude/export/:projectId/recommend/:target returns recommendation", async () => {
		const res = await fetch("/api/claude/export/proj_123/recommend/tiktok");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.preset).toBeDefined();
	});

	it("POST /api/claude/diagnostics/analyze requires message", async () => {
		const res = await fetch("/api/claude/diagnostics/analyze", {
			method: "POST",
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(400);
		expect(res.body.error).toContain("message");
	});

	it("POST /api/claude/diagnostics/analyze with valid input", async () => {
		const res = await fetch("/api/claude/diagnostics/analyze", {
			method: "POST",
			body: JSON.stringify({
				message: "ENOENT: no such file",
				context: "media import",
				timestamp: Date.now(),
			}),
		});

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.errorType).toBeDefined();
	});

	it("POST /api/claude/mcp/app validates html payload", async () => {
		const res = await fetch("/api/claude/mcp/app", {
			method: "POST",
			body: JSON.stringify({ toolName: "configure-media" }),
		});

		expect(res.status).toBe(400);
		expect(res.body.error).toContain("html");
	});

	it("POST /api/claude/mcp/app accepts valid payload", async () => {
		const res = await fetch("/api/claude/mcp/app", {
			method: "POST",
			body: JSON.stringify({
				toolName: "configure-media",
				html: "<html><body>Test</body></html>",
			}),
		});

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.forwarded).toBe(false);
	});

	it("returns 404 for unknown routes", async () => {
		const res = await fetch("/api/claude/nonexistent");

		expect(res.status).toBe(404);
		expect(res.body.success).toBe(false);
	});

	it("returns 503 for timeline routes when no renderer window", async () => {
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([]);
		const res = await fetch("/api/claude/timeline/proj_123");

		expect(res.status).toBe(503);
		expect(res.body.success).toBe(false);
		expect(res.body.error).toContain("No active");
	});

	it("all responses include timestamp", async () => {
		const res = await fetch("/api/claude/health");

		expect(res.body.timestamp).toBeTypeOf("number");
		expect(res.body.timestamp).toBeGreaterThan(0);
	});
});

describe("Claude HTTP Server - Auth", () => {
	beforeEach(() => {
		// Token is cleared in beforeAll, set per-test here
	});

	it("accepts requests without token when QCUT_API_TOKEN is not set", async () => {
		delete process.env.QCUT_API_TOKEN;
		const res = await fetch("/api/claude/health");
		expect(res.status).toBe(200);
	});

	it("rejects requests without auth token when QCUT_API_TOKEN is set", async () => {
		process.env.QCUT_API_TOKEN = "test-secret-token";
		try {
			const res = await fetch("/api/claude/health");
			expect(res.status).toBe(401);
			expect(res.body.error).toBe("Unauthorized");
		} finally {
			delete process.env.QCUT_API_TOKEN;
		}
	});

	it("accepts requests with valid auth token", async () => {
		process.env.QCUT_API_TOKEN = "test-secret-token";
		try {
			const res = await fetch("/api/claude/health", {
				headers: { Authorization: "Bearer test-secret-token" },
			});
			expect(res.status).toBe(200);
		} finally {
			delete process.env.QCUT_API_TOKEN;
		}
	});

	it("rejects requests with wrong auth token", async () => {
		process.env.QCUT_API_TOKEN = "test-secret-token";
		try {
			const res = await fetch("/api/claude/health", {
				headers: { Authorization: "Bearer wrong-token" },
			});
			expect(res.status).toBe(401);
		} finally {
			delete process.env.QCUT_API_TOKEN;
		}
	});
});

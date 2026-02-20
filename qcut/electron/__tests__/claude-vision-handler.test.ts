/**
 * Tests for claude-vision-handler.ts
 * Validates frame analysis response parsing and request flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn((name: string) => {
			if (name === "documents") return "/mock/Documents";
			if (name === "temp") return "/mock/temp";
			return "/mock/unknown";
		}),
		getVersion: vi.fn(() => "0.0.1-test"),
		isPackaged: false,
	},
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
	},
	BrowserWindow: {
		getAllWindows: vi.fn(() => []),
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

const { mockExistsSync } = vi.hoisted(() => ({
	mockExistsSync: vi.fn(() => true),
}));

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs")>();
	return {
		...actual,
		default: {
			...actual,
			existsSync: mockExistsSync,
			mkdirSync: vi.fn(),
		},
		existsSync: mockExistsSync,
		mkdirSync: vi.fn(),
	};
});

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs")>();
	return {
		...actual,
		default: {
			...actual,
			existsSync: mockExistsSync,
			mkdirSync: vi.fn(),
		},
		existsSync: mockExistsSync,
		mkdirSync: vi.fn(),
	};
});

vi.mock("../claude/claude-media-handler", () => ({
	getMediaInfo: vi.fn(async (_projectId: string, mediaId: string) => {
		if (mediaId === "valid-video") {
			return {
				id: "valid-video",
				name: "test.mp4",
				type: "video",
				path: "/mock/Documents/QCut/Projects/test/media/test.mp4",
				size: 10_000,
				duration: 30,
				createdAt: Date.now(),
				modifiedAt: Date.now(),
			};
		}
		if (mediaId === "audio-file") {
			return {
				id: "audio-file",
				name: "test.mp3",
				type: "audio",
				path: "/mock/path/test.mp3",
				size: 5000,
				createdAt: Date.now(),
				modifiedAt: Date.now(),
			};
		}
		return null;
	}),
}));

const { mockGetDecryptedApiKeys } = vi.hoisted(() => ({
	mockGetDecryptedApiKeys: vi.fn(async () => ({
		falApiKey: "",
		geminiApiKey: "",
		anthropicApiKey: "test-anthropic-key",
	})),
}));

vi.mock("../api-key-handler", () => ({
	getDecryptedApiKeys: mockGetDecryptedApiKeys,
}));

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
vi.stubGlobal("fetch", mockFetch);

const { mockReadFile } = vi.hoisted(() => ({
	mockReadFile: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
	default: { readFile: mockReadFile },
	readFile: mockReadFile,
}));

vi.mock("../ffmpeg/utils", () => ({
	getFFmpegPath: vi.fn(() => "/usr/bin/ffmpeg"),
}));

// Mock child_process.spawn so extractFrame succeeds without real FFmpeg
const { mockSpawn } = vi.hoisted(() => {
	const { EventEmitter } = require("node:events");
	const mockSpawn = vi.fn(() => {
		const proc = new EventEmitter();
		proc.kill = vi.fn();
		process.nextTick(() => proc.emit("close", 0));
		return proc;
	});
	return { mockSpawn };
});

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		default: { ...actual, spawn: mockSpawn },
		spawn: mockSpawn,
	};
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import {
	analyzeFrames,
	parseFrameAnalysisResponse,
	resolveTimestamps,
} from "../claude/claude-vision-handler";

describe("parseFrameAnalysisResponse", () => {
	const framePaths = [
		{ timestamp: 0, path: "/tmp/frame-0.jpg" },
		{ timestamp: 5, path: "/tmp/frame-5.jpg" },
	];

	it("parses valid JSON array response", () => {
		const response = JSON.stringify([
			{
				objects: ["person", "desk"],
				text: ["SLIDE 1"],
				description: "A person at a desk",
				mood: "calm",
				composition: "centered",
			},
			{
				objects: ["chart"],
				text: [],
				description: "A bar chart",
				mood: "neutral",
				composition: "rule-of-thirds",
			},
		]);

		const result = parseFrameAnalysisResponse(response, framePaths);
		expect(result).toHaveLength(2);
		expect(result[0].timestamp).toBe(0);
		expect(result[0].objects).toEqual(["person", "desk"]);
		expect(result[0].text).toEqual(["SLIDE 1"]);
		expect(result[0].description).toBe("A person at a desk");
		expect(result[1].timestamp).toBe(5);
		expect(result[1].mood).toBe("neutral");
	});

	it("handles code block wrapped response", () => {
		const response =
			'```json\n[{"objects": ["cat"], "text": [], "description": "A cat", "mood": "calm", "composition": "centered"}]\n```';
		const result = parseFrameAnalysisResponse(response, [
			{ timestamp: 0, path: "/tmp/frame.jpg" },
		]);
		expect(result).toHaveLength(1);
		expect(result[0].objects).toEqual(["cat"]);
	});

	it("returns empty array for malformed response", () => {
		const result = parseFrameAnalysisResponse("not json", framePaths);
		expect(result).toEqual([]);
	});

	it("handles missing fields gracefully", () => {
		const response = JSON.stringify([{}]);
		const result = parseFrameAnalysisResponse(response, [
			{ timestamp: 2, path: "/tmp/frame.jpg" },
		]);
		expect(result).toHaveLength(1);
		expect(result[0].timestamp).toBe(2);
		expect(result[0].objects).toEqual([]);
		expect(result[0].text).toEqual([]);
		expect(result[0].description).toBe("");
		expect(result[0].mood).toBe("neutral");
		expect(result[0].composition).toBe("unknown");
	});

	it("respects 20-image batch limit via timestamp resolution", () => {
		// Create 25 frame paths
		const manyFramePaths = Array.from({ length: 25 }, (_, i) => ({
			timestamp: i,
			path: `/tmp/frame-${i}.jpg`,
		}));

		// The handler limits to MAX_FRAMES_PER_REQUEST = 20, but response parsing
		// should handle any array length
		const response = JSON.stringify(
			manyFramePaths.map((_, i) => ({
				objects: [`object${i}`],
				text: [],
				description: `Frame ${i}`,
				mood: "neutral",
				composition: "centered",
			}))
		);

		const result = parseFrameAnalysisResponse(response, manyFramePaths);
		expect(result).toHaveLength(25);
		expect(result[0].timestamp).toBe(0);
		expect(result[24].timestamp).toBe(24);
	});
});

describe("analyzeFrames", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExistsSync.mockReturnValue(true);
		// Reset mocks with one-time overrides to prevent leakage between tests
		mockFetch.mockReset();
		mockReadFile.mockReset();
		mockGetDecryptedApiKeys.mockReset();
		mockGetDecryptedApiKeys.mockResolvedValue({
			falApiKey: "",
			geminiApiKey: "",
			anthropicApiKey: "test-anthropic-key",
		});
	});

	it("rejects invalid media ID", async () => {
		await expect(
			analyzeFrames("test-project", {
				mediaId: "nonexistent",
			})
		).rejects.toThrow("Media not found");
	});

	it("rejects non-video/non-image media", async () => {
		await expect(
			analyzeFrames("test-project", {
				mediaId: "audio-file",
			})
		).rejects.toThrow("not a video or image");
	});

	it("rejects when media file is missing on disk", async () => {
		mockExistsSync.mockReturnValue(false);
		await expect(
			analyzeFrames("test-project", {
				mediaId: "valid-video",
			})
		).rejects.toThrow("missing on disk");
	});

	it("throws descriptive error when no API keys configured", async () => {
		mockGetDecryptedApiKeys.mockResolvedValueOnce({
			falApiKey: "",
			geminiApiKey: "",
			anthropicApiKey: "",
			openRouterApiKey: "",
		});

		mockExistsSync.mockReturnValue(true);
		mockReadFile.mockResolvedValue(Buffer.from("fake-jpeg-data"));

		await expect(
			analyzeFrames("test-project", {
				mediaId: "valid-video",
				timestamps: [0],
			})
		).rejects.toThrow("No vision provider available");
	});

	it("falls back to OpenRouter when Anthropic key is missing", async () => {
		mockGetDecryptedApiKeys.mockResolvedValueOnce({
			falApiKey: "",
			geminiApiKey: "",
			anthropicApiKey: "",
			openRouterApiKey: "test-openrouter-key",
		});

		mockExistsSync.mockReturnValue(true);
		mockReadFile.mockResolvedValue(Buffer.from("fake-jpeg-data"));

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				choices: [
					{
						message: {
							content: JSON.stringify([
								{
									objects: ["tree"],
									text: [],
									description: "A tree",
									mood: "calm",
									composition: "centered",
								},
							]),
						},
					},
				],
			}),
		});

		const result = await analyzeFrames("test-project", {
			mediaId: "valid-video",
			timestamps: [0],
		});

		expect(result.frames).toHaveLength(1);
		expect(result.frames[0].objects).toEqual(["tree"]);
		// Verify OpenRouter endpoint was called
		expect(mockFetch).toHaveBeenCalledWith(
			"https://openrouter.ai/api/v1/chat/completions",
			expect.objectContaining({ method: "POST" })
		);
	});

	it("falls back to OpenRouter when Anthropic API fails", async () => {
		mockGetDecryptedApiKeys.mockResolvedValueOnce({
			falApiKey: "",
			geminiApiKey: "",
			anthropicApiKey: "test-anthropic-key",
			openRouterApiKey: "test-openrouter-key",
		});

		mockExistsSync.mockReturnValue(true);
		mockReadFile.mockResolvedValue(Buffer.from("fake-jpeg-data"));

		// First call (Anthropic) fails
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			text: async () => "Internal Server Error",
		});

		// Second call (OpenRouter) succeeds
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				choices: [
					{
						message: {
							content: JSON.stringify([
								{
									objects: ["car"],
									text: [],
									description: "A car",
									mood: "neutral",
									composition: "rule-of-thirds",
								},
							]),
						},
					},
				],
			}),
		});

		const result = await analyzeFrames("test-project", {
			mediaId: "valid-video",
			timestamps: [0],
		});

		expect(result.frames).toHaveLength(1);
		expect(result.frames[0].objects).toEqual(["car"]);
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("returns analyzed frames from mocked Claude Vision API", async () => {
		// Mock frame extraction: existsSync returns true for media + frames
		mockExistsSync.mockReturnValue(true);

		// Mock readFile for frame images
		mockReadFile.mockResolvedValue(Buffer.from("fake-jpeg-data"));

		// Mock Claude Vision API response
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				content: [
					{
						type: "text",
						text: JSON.stringify([
							{
								objects: ["person", "desk"],
								text: ["TITLE"],
								description: "Person at desk",
								mood: "calm",
								composition: "centered",
							},
						]),
					},
				],
			}),
		});

		const result = await analyzeFrames("test-project", {
			mediaId: "valid-video",
			timestamps: [0],
		});

		expect(result.frames).toHaveLength(1);
		expect(result.frames[0].objects).toEqual(["person", "desk"]);
		expect(result.frames[0].description).toBe("Person at desk");
		expect(result.totalFramesAnalyzed).toBe(1);
	});

	it("handles API error when only Anthropic key configured", async () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFile.mockResolvedValue(Buffer.from("fake-jpeg-data"));

		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			text: async () => "Unauthorized",
		});

		await expect(
			analyzeFrames("test-project", {
				mediaId: "valid-video",
				timestamps: [0],
			})
		).rejects.toThrow("No vision provider available");
	});

	it("handles API timeout when only Anthropic key configured", async () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFile.mockResolvedValue(Buffer.from("fake-jpeg-data"));

		mockFetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

		await expect(
			analyzeFrames("test-project", {
				mediaId: "valid-video",
				timestamps: [0],
			})
		).rejects.toThrow("No vision provider available");
	});
});

// ---------------------------------------------------------------------------
// resolveTimestamps unit tests
// ---------------------------------------------------------------------------

describe("resolveTimestamps", () => {
	it("returns explicit timestamps unchanged", () => {
		const result = resolveTimestamps(
			{ mediaId: "x", timestamps: [1, 5, 10] },
			60
		);
		expect(result).toEqual([1, 5, 10]);
	});

	it("caps explicit timestamps at 20", () => {
		const timestamps = Array.from({ length: 25 }, (_, i) => i);
		const result = resolveTimestamps({ mediaId: "x", timestamps }, 60);
		expect(result).toHaveLength(20);
		expect(result[0]).toBe(0);
		expect(result[19]).toBe(19);
	});

	it("generates timestamps from interval and duration", () => {
		const result = resolveTimestamps({ mediaId: "x", interval: 5 }, 20);
		expect(result).toEqual([0, 5, 10, 15]);
	});

	it("caps interval timestamps at 20", () => {
		const result = resolveTimestamps({ mediaId: "x", interval: 1 }, 100);
		expect(result).toHaveLength(20);
	});

	it("clamps interval to minimum 1 second", () => {
		const result = resolveTimestamps({ mediaId: "x", interval: 0.1 }, 5);
		// interval clamped to 1, so: 0, 1, 2, 3, 4
		expect(result).toEqual([0, 1, 2, 3, 4]);
	});

	it("returns [0] when no timestamps, interval, or duration", () => {
		const result = resolveTimestamps({ mediaId: "x" });
		expect(result).toEqual([0]);
	});

	it("returns [0] when interval provided but no duration", () => {
		const result = resolveTimestamps({ mediaId: "x", interval: 5 });
		expect(result).toEqual([0]);
	});
});

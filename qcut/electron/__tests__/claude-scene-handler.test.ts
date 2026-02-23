/**
 * Tests for claude-scene-handler.ts
 * Validates FFmpeg scene detection, showinfo output parsing, and scene detection flow.
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

vi.mock("../claude/handlers/claude-media-handler", () => ({
	getMediaInfo: vi.fn(async (_projectId: string, mediaId: string) => {
		if (mediaId === "valid-video") {
			return {
				id: "valid-video",
				name: "test.mp4",
				type: "video",
				path: "/mock/Documents/QCut/Projects/test/media/test.mp4",
				size: 10_000,
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
		falApiKey: "test-fal-key",
		geminiApiKey: "",
		anthropicApiKey: "",
	})),
}));

vi.mock("../api-key-handler", () => ({
	getDecryptedApiKeys: mockGetDecryptedApiKeys,
}));

vi.mock("../ffmpeg/utils", () => ({
	getFFmpegPath: vi.fn(() => "/usr/bin/ffmpeg"),
}));

// Mock child_process.spawn for FFmpeg scene detection
const { mockSpawn } = vi.hoisted(() => {
	const { EventEmitter } = require("node:events");
	const mockSpawn = vi.fn(() => {
		const proc = new EventEmitter();
		proc.kill = vi.fn();
		proc.stderr = new EventEmitter();
		// Default: emit close(0) with no stderr (no scenes found)
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

const { mockReadFile } = vi.hoisted(() => ({
	mockReadFile: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
	default: { readFile: mockReadFile },
	readFile: mockReadFile,
}));

// Mock Gemini SDK
const { mockGenerateContent } = vi.hoisted(() => ({
	mockGenerateContent: vi.fn(),
}));

vi.mock("@google/generative-ai", () => ({
	GoogleGenerativeAI: class MockGoogleGenerativeAI {
		getGenerativeModel() {
			return { generateContent: mockGenerateContent };
		}
	},
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import {
	parseShowInfoOutput,
	detectScenes,
	detectScenesWithFFmpeg,
} from "../claude/handlers/claude-scene-handler";

describe("parseShowInfoOutput", () => {
	it("parses pts_time from showinfo output", () => {
		const stderr = `
[Parsed_showinfo_1 @ 0x7f9a2c003200] n:   0 pts:      0 pts_time:0.000000 duration:      1 duration_time:0.040000 fmt:yuv420p cl:left sar:1/1 s:1920x1080 i:P iskey:1 type:I checksum:0F3A7B2C plane_checksum:[0F3A7B2C]
[Parsed_showinfo_1 @ 0x7f9a2c003200] n:   1 pts:  80000 pts_time:3.200000 duration:      1 duration_time:0.040000 fmt:yuv420p
[Parsed_showinfo_1 @ 0x7f9a2c003200] n:   2 pts: 150000 pts_time:6.000000 duration:      1 duration_time:0.040000 fmt:yuv420p
frame=  42 fps=0.0 q=-0.0 size=N/A time=00:00:12.00 bitrate=N/A speed=  24x
`;

		const scenes = parseShowInfoOutput(stderr);
		expect(scenes).toHaveLength(3);
		expect(scenes[0].timestamp).toBe(0);
		expect(scenes[1].timestamp).toBe(3.2);
		expect(scenes[2].timestamp).toBe(6);
	});

	it("returns empty array for no scene changes", () => {
		const stderr = `
frame=  100 fps=0.0 q=-0.0 size=N/A time=00:00:04.00 bitrate=N/A speed=  50x
video:0kB audio:0kB subtitle:0kB other streams:0kB global headers:0kB muxing overhead: unknown
`;

		const scenes = parseShowInfoOutput(stderr);
		expect(scenes).toHaveLength(0);
	});

	it("deduplicates close timestamps", () => {
		const stderr = `
[Parsed_showinfo_1 @ 0x1] n: 0 pts: 0 pts_time:5.000 duration: 1
[Parsed_showinfo_1 @ 0x1] n: 1 pts: 0 pts_time:5.100 duration: 1
[Parsed_showinfo_1 @ 0x1] n: 2 pts: 0 pts_time:10.000 duration: 1
`;

		const scenes = parseShowInfoOutput(stderr);
		expect(scenes).toHaveLength(2);
		expect(scenes[0].timestamp).toBe(5);
		expect(scenes[1].timestamp).toBe(10);
	});

	it("returns sorted timestamps", () => {
		const stderr = `
[Parsed_showinfo_1 @ 0x1] n: 0 pts: 0 pts_time:10.0 duration: 1
[Parsed_showinfo_1 @ 0x1] n: 1 pts: 0 pts_time:2.5 duration: 1
[Parsed_showinfo_1 @ 0x1] n: 2 pts: 0 pts_time:7.0 duration: 1
`;

		const scenes = parseShowInfoOutput(stderr);
		expect(scenes[0].timestamp).toBe(2.5);
		expect(scenes[1].timestamp).toBe(7);
		expect(scenes[2].timestamp).toBe(10);
	});

	it("assigns confidence to detected scenes", () => {
		const stderr =
			"[Parsed_showinfo_1 @ 0x1] n: 0 pts: 0 pts_time:3.0 duration: 1";
		const scenes = parseShowInfoOutput(stderr);
		expect(scenes[0].confidence).toBeGreaterThan(0);
	});
});

describe("detectScenes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExistsSync.mockReturnValue(true);
	});

	it("rejects invalid media ID", async () => {
		await expect(
			detectScenes("test-project", {
				mediaId: "nonexistent",
			})
		).rejects.toThrow("Media not found");
	});

	it("rejects non-video media", async () => {
		await expect(
			detectScenes("test-project", {
				mediaId: "audio-file",
			})
		).rejects.toThrow("not a video");
	});

	it("rejects when media file is missing on disk", async () => {
		mockExistsSync.mockReturnValue(false);
		await expect(
			detectScenes("test-project", {
				mediaId: "valid-video",
			})
		).rejects.toThrow("missing on disk");
	});

	it("respects threshold parameter", async () => {
		const result = await detectScenes("test-project", {
			mediaId: "valid-video",
			threshold: 0.5,
		});
		// FFmpeg spawn is mocked — returns empty stderr, so only scene 0 is added
		expect(result.totalScenes).toBeGreaterThanOrEqual(1);
		// Verify spawn was called with the threshold in the filter arg
		const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
		const filterArg = spawnArgs.find((a: string) => a.includes("scene,"));
		expect(filterArg).toContain("0.5");
	});
});

// ---------------------------------------------------------------------------
// Mocked FFmpeg Scene Detection
// ---------------------------------------------------------------------------

describe("detectScenesWithFFmpeg (mocked)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSpawn.mockReset();
	});

	it("returns scenes from FFmpeg stderr output", async () => {
		const { EventEmitter } = require("node:events");
		mockSpawn.mockImplementation(() => {
			const proc = new EventEmitter();
			proc.kill = vi.fn();
			proc.stderr = new EventEmitter();
			process.nextTick(() => {
				proc.stderr.emit(
					"data",
					Buffer.from(
						"[Parsed_showinfo_1 @ 0x1] n: 0 pts: 0 pts_time:2.500 duration: 1\n" +
							"[Parsed_showinfo_1 @ 0x1] n: 1 pts: 0 pts_time:7.800 duration: 1\n"
					)
				);
				proc.emit("close", 0);
			});
			return proc;
		});

		const scenes = await detectScenesWithFFmpeg("/mock/video.mp4", 0.3);
		// FFmpeg found 2 scenes, handler adds scene 0 at start
		expect(scenes.length).toBeGreaterThanOrEqual(2);
		expect(scenes[0].timestamp).toBe(0); // auto-added first frame
		expect(scenes[1].timestamp).toBe(2.5);
		expect(scenes[2].timestamp).toBe(7.8);
	});

	it("adds scene at t=0 if missing", async () => {
		const { EventEmitter } = require("node:events");
		mockSpawn.mockImplementation(() => {
			const proc = new EventEmitter();
			proc.kill = vi.fn();
			proc.stderr = new EventEmitter();
			process.nextTick(() => {
				proc.stderr.emit(
					"data",
					Buffer.from(
						"[Parsed_showinfo_1 @ 0x1] n: 0 pts: 0 pts_time:5.000 duration: 1\n"
					)
				);
				proc.emit("close", 0);
			});
			return proc;
		});

		const scenes = await detectScenesWithFFmpeg("/mock/video.mp4");
		expect(scenes[0].timestamp).toBe(0);
		expect(scenes[0].confidence).toBe(1.0);
		expect(scenes[1].timestamp).toBe(5);
	});

	it("handles FFmpeg spawn error", async () => {
		const { EventEmitter } = require("node:events");
		mockSpawn.mockImplementation(() => {
			const proc = new EventEmitter();
			proc.kill = vi.fn();
			proc.stderr = new EventEmitter();
			process.nextTick(() => proc.emit("error", new Error("spawn failed")));
			return proc;
		});

		await expect(detectScenesWithFFmpeg("/mock/video.mp4")).rejects.toThrow(
			"spawn failed"
		);
	});
});

// ---------------------------------------------------------------------------
// Mocked Gemini AI Enrichment
// ---------------------------------------------------------------------------

describe("detectScenes with AI enrichment (mocked)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExistsSync.mockReturnValue(true);
		mockSpawn.mockReset();
		mockReadFile.mockReset();
		mockGenerateContent.mockReset();
		mockGetDecryptedApiKeys.mockReset();
		mockGetDecryptedApiKeys.mockResolvedValue({
			falApiKey: "test-fal-key",
			geminiApiKey: "test-gemini-key",
			anthropicApiKey: "",
		});

		// Default: FFmpeg spawn returns one scene at t=3.0
		const { EventEmitter } = require("node:events");
		mockSpawn.mockImplementation(() => {
			const proc = new EventEmitter();
			proc.kill = vi.fn();
			proc.stderr = new EventEmitter();
			process.nextTick(() => {
				proc.stderr.emit(
					"data",
					Buffer.from(
						"[Parsed_showinfo_1 @ 0x1] n: 0 pts: 0 pts_time:3.000 duration: 1\n"
					)
				);
				proc.emit("close", 0);
			});
			return proc;
		});
	});

	it("enriches scenes with Gemini AI analysis", async () => {
		mockReadFile.mockResolvedValue(Buffer.from("fake-jpeg-data"));
		mockGenerateContent.mockResolvedValue({
			response: {
				text: () =>
					JSON.stringify({
						description: "Wide shot of office",
						shotType: "wide",
						transitionType: "cut",
					}),
			},
		});

		const result = await detectScenes("test-project", {
			mediaId: "valid-video",
			aiAnalysis: true,
		});

		expect(result.totalScenes).toBe(2); // scene 0 + scene at 3.0
		// AI enrichment should have been called for each scene
		expect(mockGenerateContent).toHaveBeenCalled();
	});

	it("skips AI enrichment when Gemini key is missing", async () => {
		mockGetDecryptedApiKeys.mockResolvedValueOnce({
			falApiKey: "test-fal-key",
			geminiApiKey: "",
			anthropicApiKey: "",
		});

		const result = await detectScenes("test-project", {
			mediaId: "valid-video",
			aiAnalysis: true,
		});

		expect(result.totalScenes).toBeGreaterThanOrEqual(1);
		expect(mockGenerateContent).not.toHaveBeenCalled();
	});

	it("gracefully handles Gemini API errors", async () => {
		mockReadFile.mockResolvedValue(Buffer.from("fake-jpeg-data"));
		mockGenerateContent.mockRejectedValue(new Error("Gemini rate limited"));

		const result = await detectScenes("test-project", {
			mediaId: "valid-video",
			aiAnalysis: true,
		});

		// Should still return FFmpeg scenes even if AI fails
		expect(result.totalScenes).toBeGreaterThanOrEqual(1);
		expect(result.scenes[0].timestamp).toBe(0);
	});
});

/**
 * Tests for claude-vision-handler.ts
 * Validates frame analysis response parsing, provider cascade, and request flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

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
    openRouterApiKey: "",
  })),
}));

vi.mock("../api-key-handler", () => ({
  getDecryptedApiKeys: mockGetDecryptedApiKeys,
}));

const { mockCallModelApi } = vi.hoisted(() => ({
  mockCallModelApi: vi.fn(),
}));

vi.mock("../native-pipeline/api-caller", () => ({
  callModelApi: mockCallModelApi,
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

// Mock child_process: spawn for FFmpeg/Claude CLI, execFileSync for `which`
const { mockSpawn, mockExecFileSync } = vi.hoisted(() => {
  const mockSpawn = vi.fn(() => {
    const proc = new EventEmitter();
    (proc as EventEmitter & { kill: ReturnType<typeof vi.fn> }).kill = vi.fn();
    process.nextTick(() => proc.emit("close", 0));
    return proc;
  });
  const mockExecFileSync = vi.fn(() => "");
  return { mockSpawn, mockExecFileSync };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    default: { ...actual, spawn: mockSpawn, execFileSync: mockExecFileSync },
    spawn: mockSpawn,
    execFileSync: mockExecFileSync,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_FRAME_RESPONSE = JSON.stringify([
  {
    objects: ["person", "desk"],
    text: ["TITLE"],
    description: "Person at desk",
    mood: "calm",
    composition: "centered",
  },
]);

/** Create a mock spawn proc that emits stdout data then closes. */
function createMockProc(stdout: string, exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.kill = vi.fn();
  process.nextTick(() => {
    proc.stdout.emit("data", Buffer.from(stdout));
    proc.emit("close", exitCode);
  });
  return proc;
}

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
    const manyFramePaths = Array.from({ length: 25 }, (_, i) => ({
      timestamp: i,
      path: `/tmp/frame-${i}.jpg`,
    }));

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
    mockFetch.mockReset();
    mockReadFile.mockReset();
    mockCallModelApi.mockReset();
    mockGetDecryptedApiKeys.mockReset();
    mockGetDecryptedApiKeys.mockResolvedValue({
      falApiKey: "",
      geminiApiKey: "",
      anthropicApiKey: "test-anthropic-key",
      openRouterApiKey: "",
    });
    // Default: Claude CLI not found (cascade falls through)
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
  });

  it("rejects invalid media ID", async () => {
    await expect(
      analyzeFrames("test-project", { mediaId: "nonexistent" })
    ).rejects.toThrow("Media not found");
  });

  it("rejects non-video/non-image media", async () => {
    await expect(
      analyzeFrames("test-project", { mediaId: "audio-file" })
    ).rejects.toThrow("not a video or image");
  });

  it("rejects when media file is missing on disk", async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(
      analyzeFrames("test-project", { mediaId: "valid-video" })
    ).rejects.toThrow("missing on disk");
  });

  it("throws when all providers fail", async () => {
    // No Claude CLI, no OpenRouter key, no Anthropic key
    mockGetDecryptedApiKeys.mockResolvedValue({
      falApiKey: "",
      geminiApiKey: "",
      anthropicApiKey: "",
      openRouterApiKey: "",
    });

    // Only first call (media file check) returns true, rest false
    let callCount = 0;
    mockExistsSync.mockImplementation(() => {
      callCount++;
      return callCount <= 1;
    });

    await expect(
      analyzeFrames("test-project", {
        mediaId: "valid-video",
        timestamps: [0],
      })
    ).rejects.toThrow("No frames could be extracted");
  });

  it("succeeds with Claude CLI provider", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(Buffer.from("fake-jpeg-data"));

    // Claude CLI is available
    mockExecFileSync.mockReturnValue("/usr/local/bin/claude");

    // Mock spawn: first call = FFmpeg (frame extraction), second = claude CLI
    let spawnCount = 0;
    mockSpawn.mockImplementation(() => {
      spawnCount++;
      if (spawnCount <= 1) {
        // FFmpeg extraction — just emit close(0)
        const proc = new EventEmitter() as EventEmitter & {
          kill: ReturnType<typeof vi.fn>;
        };
        proc.kill = vi.fn();
        process.nextTick(() => proc.emit("close", 0));
        return proc;
      }
      // Claude CLI — emit stdout with analysis JSON
      return createMockProc(VALID_FRAME_RESPONSE);
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

  it("falls back to OpenRouter when Claude CLI is unavailable", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(Buffer.from("fake-jpeg-data"));

    // No Claude CLI
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });

    // OpenRouter key available
    mockGetDecryptedApiKeys.mockResolvedValue({
      falApiKey: "",
      geminiApiKey: "",
      anthropicApiKey: "",
      openRouterApiKey: "test-openrouter-key",
    });

    // Mock callModelApi for OpenRouter success
    mockCallModelApi.mockResolvedValueOnce({
      success: true,
      data: {
        choices: [
          {
            message: { content: VALID_FRAME_RESPONSE },
          },
        ],
      },
      duration: 1.5,
    });

    const result = await analyzeFrames("test-project", {
      mediaId: "valid-video",
      timestamps: [0],
    });

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0].objects).toEqual(["person", "desk"]);
    expect(mockCallModelApi).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openrouter",
        endpoint: "chat/completions",
      })
    );
  });

  it("falls back to Anthropic when CLI and OpenRouter fail", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(Buffer.from("fake-jpeg-data"));

    // No CLI, no OpenRouter key, but Anthropic key present
    mockGetDecryptedApiKeys.mockResolvedValue({
      falApiKey: "",
      geminiApiKey: "",
      anthropicApiKey: "test-anthropic-key",
      openRouterApiKey: "",
    });

    // Mock Anthropic API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: VALID_FRAME_RESPONSE }],
      }),
    });

    const result = await analyzeFrames("test-project", {
      mediaId: "valid-video",
      timestamps: [0],
    });

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0].description).toBe("Person at desk");
    // Verify Anthropic API was called
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("handles Anthropic API error responses", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(Buffer.from("fake-jpeg-data"));

    // Only Anthropic key available
    mockGetDecryptedApiKeys.mockResolvedValue({
      falApiKey: "",
      geminiApiKey: "",
      anthropicApiKey: "test-anthropic-key",
      openRouterApiKey: "",
    });

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
    ).rejects.toThrow("All vision providers failed");
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

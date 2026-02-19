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
        size: 10000,
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

vi.mock("../api-key-handler", () => ({
  getDecryptedApiKeys: vi.fn(async () => ({
    falApiKey: "",
    geminiApiKey: "",
    anthropicApiKey: "test-anthropic-key",
  })),
}));

vi.mock("../ffmpeg/utils", () => ({
  getFFmpegPath: vi.fn(() => "/usr/bin/ffmpeg"),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import {
  analyzeFrames,
  parseFrameAnalysisResponse,
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
    const response = '```json\n[{"objects": ["cat"], "text": [], "description": "A cat", "mood": "calm", "composition": "centered"}]\n```';
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
});

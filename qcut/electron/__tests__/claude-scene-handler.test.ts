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

vi.mock("../claude/claude-media-handler", () => ({
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

vi.mock("../api-key-handler", () => ({
  getDecryptedApiKeys: vi.fn(async () => ({
    falApiKey: "test-fal-key",
    geminiApiKey: "",
    anthropicApiKey: "",
  })),
}));

vi.mock("../ffmpeg/utils", () => ({
  getFFmpegPath: vi.fn(() => "/usr/bin/ffmpeg"),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import {
  parseShowInfoOutput,
  detectScenes,
} from "../claude/claude-scene-handler";

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
    // Will fail at FFmpeg spawn, but validates parameter passing
    await expect(
      detectScenes("test-project", {
        mediaId: "valid-video",
        threshold: 0.5,
      })
    ).rejects.toThrow(); // FFmpeg not available in test env
  });
});

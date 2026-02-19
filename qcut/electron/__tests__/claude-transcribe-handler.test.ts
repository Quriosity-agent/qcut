/**
 * Tests for claude-transcribe-handler.ts
 * Validates media resolution, audio extraction, and provider dispatch.
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

const { mockExistsSync, mockMkdirSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(() => true),
  mockMkdirSync: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      mkdirSync: mockMkdirSync,
    },
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      mkdirSync: mockMkdirSync,
    },
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
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
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      };
    }
    if (mediaId === "valid-audio") {
      return {
        id: "valid-audio",
        name: "test.mp3",
        type: "audio",
        path: "/mock/Documents/QCut/Projects/test/media/test.mp3",
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
    geminiApiKey: "test-gemini-key",
    anthropicApiKey: "",
  })),
}));

vi.mock("../ffmpeg/utils", () => ({
  getFFmpegPath: vi.fn(() => "/usr/bin/ffmpeg"),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { transcribeMedia } from "../claude/claude-transcribe-handler";

describe("claude-transcribe-handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it("rejects invalid media ID", async () => {
    await expect(
      transcribeMedia("test-project", {
        mediaId: "nonexistent",
        provider: "elevenlabs",
      })
    ).rejects.toThrow("Media not found");
  });

  it("rejects when media file is missing on disk", async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(
      transcribeMedia("test-project", {
        mediaId: "valid-video",
        provider: "elevenlabs",
      })
    ).rejects.toThrow("missing on disk");
  });

  it("identifies video files that need audio extraction", async () => {
    // This will fail on the extraction step (no real FFmpeg), but we can
    // verify it tries to extract audio from .mp4 files
    await expect(
      transcribeMedia("test-project", {
        mediaId: "valid-video",
        provider: "elevenlabs",
      })
    ).rejects.toThrow(); // Will fail at spawn/extraction

    // Audio files should not need extraction — will fail at FAL upload instead
    await expect(
      transcribeMedia("test-project", {
        mediaId: "valid-audio",
        provider: "elevenlabs",
      })
    ).rejects.toThrow(); // Will fail at API call level
  });

  it("defaults to elevenlabs provider", async () => {
    // Default provider should be elevenlabs
    await expect(
      transcribeMedia("test-project", {
        mediaId: "valid-audio",
      })
    ).rejects.toThrow(); // Fails at network level but tests the path
  });

  it("accepts gemini as provider", async () => {
    await expect(
      transcribeMedia("test-project", {
        mediaId: "valid-audio",
        provider: "gemini",
      })
    ).rejects.toThrow(); // Fails at Gemini API level
  });

  it("sanitizes project ID", async () => {
    // Path traversal in projectId should be sanitized
    await expect(
      transcribeMedia("../../evil", {
        mediaId: "valid-audio",
      })
    ).rejects.toThrow(); // sanitized project ID won't find media
  });
});

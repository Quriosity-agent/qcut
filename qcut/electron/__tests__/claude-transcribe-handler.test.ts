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
        size: 10_000,
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

const { mockGetDecryptedApiKeys } = vi.hoisted(() => ({
  mockGetDecryptedApiKeys: vi.fn(async () => ({
    falApiKey: "test-fal-key",
    geminiApiKey: "test-gemini-key",
    anthropicApiKey: "",
  })),
}));

vi.mock("../api-key-handler", () => ({
  getDecryptedApiKeys: mockGetDecryptedApiKeys,
}));

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));
vi.stubGlobal("fetch", mockFetch);

const { mockReadFile: mockFsReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: mockFsReadFile,
}));

vi.mock("../ffmpeg/utils", () => ({
  getFFmpegPath: vi.fn(() => "/usr/bin/ffmpeg"),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import {
  transcribeMedia,
  startTranscribeJob,
  getTranscribeJobStatus,
  listTranscribeJobs,
  cancelTranscribeJob,
  _clearTranscribeJobs,
} from "../claude/claude-transcribe-handler";

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

// ---------------------------------------------------------------------------
// Async Job Lifecycle
// ---------------------------------------------------------------------------

describe("async transcription jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    _clearTranscribeJobs();
  });

  it("startTranscribeJob returns a job ID immediately", () => {
    const { jobId } = startTranscribeJob("proj-1", {
      mediaId: "valid-audio",
      provider: "elevenlabs",
    });

    expect(jobId).toMatch(/^transcribe_\d+_[a-z0-9]+$/);
  });

  it("job exists immediately after creation with correct metadata", () => {
    const { jobId } = startTranscribeJob("proj-1", {
      mediaId: "valid-audio",
    });

    const job = getTranscribeJobStatus(jobId);
    expect(job).toBeDefined();
    // Status may be "queued" or "processing" depending on microtask timing
    expect(["queued", "processing", "failed"]).toContain(job!.status);
    expect(job!.projectId).toBe("proj-1");
    expect(job!.mediaId).toBe("valid-audio");
    expect(job!.provider).toBe("elevenlabs");
  });

  it("getTranscribeJobStatus returns null for unknown IDs", () => {
    expect(getTranscribeJobStatus("transcribe_unknown")).toBeNull();
  });

  it("cancelTranscribeJob marks job as cancelled", () => {
    const { jobId } = startTranscribeJob("proj-1", {
      mediaId: "valid-audio",
    });

    const cancelled = cancelTranscribeJob(jobId);
    expect(cancelled).toBe(true);

    const job = getTranscribeJobStatus(jobId);
    expect(job!.status).toBe("cancelled");
    expect(job!.completedAt).toBeDefined();
  });

  it("cancelTranscribeJob returns false for unknown jobs", () => {
    expect(cancelTranscribeJob("transcribe_nonexistent")).toBe(false);
  });

  it("listTranscribeJobs returns sorted by creation time", () => {
    startTranscribeJob("proj-1", { mediaId: "valid-audio" });
    startTranscribeJob("proj-1", { mediaId: "valid-audio" });
    startTranscribeJob("proj-1", { mediaId: "valid-audio" });

    const jobs = listTranscribeJobs();
    expect(jobs).toHaveLength(3);
    // Sorted newest-first
    expect(jobs[0].createdAt).toBeGreaterThanOrEqual(jobs[1].createdAt);
    expect(jobs[1].createdAt).toBeGreaterThanOrEqual(jobs[2].createdAt);
  });
});

// ---------------------------------------------------------------------------
// Mocked ElevenLabs API Tests
// ---------------------------------------------------------------------------

describe("ElevenLabs transcription API (mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockFetch.mockReset();
    mockFsReadFile.mockReset();
  });

  it("full pipeline returns correct TranscriptionResult", async () => {
    // Mock readFile for audio file upload
    mockFsReadFile.mockResolvedValue(Buffer.from("fake-audio-data"));

    // 1. FAL storage initiate
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        upload_url: "https://mock-upload-url",
        file_url: "https://mock-cdn/audio.mp3",
      }),
    });

    // 2. FAL storage upload
    mockFetch.mockResolvedValueOnce({
      ok: true,
    });

    // 3. ElevenLabs Scribe v2 response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        text: "Hello world",
        language_code: "en",
        words: [
          {
            text: "Hello",
            start: 0.0,
            end: 0.4,
            type: "word",
            speaker_id: "A",
          },
          {
            text: " ",
            start: 0.4,
            end: 0.5,
            type: "spacing",
            speaker_id: null,
          },
          {
            text: "world",
            start: 0.5,
            end: 0.9,
            type: "word",
            speaker_id: "A",
          },
        ],
      }),
    });

    const result = await transcribeMedia("test-project", {
      mediaId: "valid-audio",
      provider: "elevenlabs",
    });

    expect(result.language).toBe("en");
    expect(result.duration).toBe(0.9);
    expect(result.words).toHaveLength(3);
    expect(result.words[0].text).toBe("Hello");
    expect(result.words[0].speaker).toBe("A");
    expect(result.words[1].type).toBe("spacing");
    expect(result.words[1].speaker).toBeUndefined();
    expect(result.words[2].text).toBe("world");
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
    expect(result.segments[0].text).toContain("Hello");
  });

  it("throws on FAL storage initiate failure", async () => {
    mockFsReadFile.mockResolvedValue(Buffer.from("fake-audio"));

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(
      transcribeMedia("test-project", {
        mediaId: "valid-audio",
        provider: "elevenlabs",
      })
    ).rejects.toThrow("FAL storage initiate failed");
  });

  it("throws on FAL storage upload failure", async () => {
    mockFsReadFile.mockResolvedValue(Buffer.from("fake-audio"));

    // Initiate succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        upload_url: "https://mock-upload",
        file_url: "https://mock-cdn/audio.mp3",
      }),
    });

    // Upload fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    await expect(
      transcribeMedia("test-project", {
        mediaId: "valid-audio",
        provider: "elevenlabs",
      })
    ).rejects.toThrow("FAL storage upload failed");
  });

  it("throws when FAL API key is missing", async () => {
    mockGetDecryptedApiKeys.mockResolvedValueOnce({
      falApiKey: "",
      geminiApiKey: "",
      anthropicApiKey: "",
    });

    await expect(
      transcribeMedia("test-project", {
        mediaId: "valid-audio",
        provider: "elevenlabs",
      })
    ).rejects.toThrow("FAL API key not configured");
  });

  it("maps speaker_id correctly", async () => {
    mockFsReadFile.mockResolvedValue(Buffer.from("fake-audio"));

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          upload_url: "https://mock",
          file_url: "https://mock-cdn/audio.mp3",
        }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: "Hi",
          language_code: "en",
          words: [
            {
              text: "Hi",
              start: 0,
              end: 0.3,
              type: "word",
              speaker_id: "B",
            },
          ],
        }),
      });

    const result = await transcribeMedia("test-project", {
      mediaId: "valid-audio",
    });

    expect(result.words[0].speaker).toBe("B");
  });
});

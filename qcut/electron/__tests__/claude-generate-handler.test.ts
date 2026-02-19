/**
 * Tests for Claude Generate-and-Add Handler
 * Covers job lifecycle, model validation, and status tracking.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted for factory compatibility)
// ---------------------------------------------------------------------------

const { mockExecute, mockIsAvailable, mockGetStatus, mockCancel } =
  vi.hoisted(() => ({
    mockExecute: vi.fn(),
    mockIsAvailable: vi.fn().mockResolvedValue(true),
    mockGetStatus: vi.fn().mockResolvedValue({
      available: true,
      version: "1.0.0-native",
      source: "native",
      compatible: true,
      features: {},
    }),
    mockCancel: vi.fn().mockReturnValue(true),
  }));

vi.mock("../native-pipeline/index.js", () => ({
  NativePipelineManager: vi.fn().mockImplementation(() => ({
    execute: mockExecute,
    isAvailable: mockIsAvailable,
    getStatus: mockGetStatus,
    cancel: mockCancel,
  })),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === "documents") return "/mock/Documents";
      if (name === "temp") return "/mock/tmp";
      return "/mock/unknown";
    }),
    getVersion: vi.fn(() => "0.0.1-test"),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), once: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: { send: vi.fn() },
      },
    ]),
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  startGenerateJob,
  getJobStatus,
  listJobs,
  cancelJob,
  listGenerateModels,
  estimateGenerateCost,
} from "../claude/claude-generate-handler";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startGenerateJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAvailable.mockResolvedValue(true);
    // Default: execute resolves quickly
    mockExecute.mockResolvedValue({
      success: true,
      outputPath: "/mock/output/video.mp4",
      mediaId: "media_abc",
      importedPath: "/mock/imported/video.mp4",
      duration: 12.5,
      cost: 0.15,
    });
  });

  it("returns a job ID immediately", async () => {
    const result = await startGenerateJob("proj_1", {
      model: "kling_v3_pro",
      prompt: "A sunset over the ocean",
    });

    expect(result.jobId).toBeDefined();
    expect(result.jobId).toMatch(/^gen_/);
  });

  it("creates a job with valid status", async () => {
    const { jobId } = await startGenerateJob("proj_1", {
      model: "kling_v3_pro",
      prompt: "Test prompt",
    });

    const job = getJobStatus(jobId);
    expect(job).toBeDefined();
    expect(job!.model).toBe("kling_v3_pro");
    // Job may already be completed since mock resolves instantly
    expect(["queued", "processing", "completed"]).toContain(job!.status);
  });

  it("calls execute with correct options", async () => {
    await startGenerateJob("proj_1", {
      model: "kling_v3_pro",
      prompt: "A sunset",
      duration: 5,
      aspectRatio: "16:9",
    });

    // Wait for background execution
    await vi.waitFor(() => {
      expect(mockExecute).toHaveBeenCalledOnce();
    });

    const call = mockExecute.mock.calls[0];
    const options = call[0];
    expect(options.command).toBe("create-video");
    expect(options.args.model).toBe("kling_v3_pro");
    expect(options.args.text).toBe("A sunset");
    expect(options.args.duration).toBe(5);
    expect(options.args.aspect_ratio).toBe("16:9");
    expect(options.projectId).toBe("proj_1");
    expect(options.autoImport).toBe(true);
  });

  it("passes imageUrl for image-to-video generation", async () => {
    await startGenerateJob("proj_1", {
      model: "kling_v3_pro",
      prompt: "Camera pans",
      imageUrl: "https://example.com/ref.png",
    });

    await vi.waitFor(() => {
      expect(mockExecute).toHaveBeenCalledOnce();
    });

    const options = mockExecute.mock.calls[0][0];
    expect(options.args["image-url"]).toBe("https://example.com/ref.png");
  });

  it("throws when pipeline is not available", async () => {
    mockIsAvailable.mockResolvedValueOnce(false);
    mockGetStatus.mockResolvedValueOnce({
      available: false,
      error: "No API keys configured",
    });

    await expect(
      startGenerateJob("proj_1", {
        model: "kling_v3_pro",
        prompt: "Test",
      })
    ).rejects.toThrow("No API keys configured");
  });
});

describe("getJobStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAvailable.mockResolvedValue(true);
    mockExecute.mockResolvedValue({
      success: true,
      outputPath: "/mock/output.mp4",
    });
  });

  it("returns null for unknown job ID", () => {
    const job = getJobStatus("nonexistent_job_id");
    expect(job).toBeNull();
  });

  it("returns job status after creation", async () => {
    const { jobId } = await startGenerateJob("proj_1", {
      model: "test_model",
      prompt: "Test",
    });

    const job = getJobStatus(jobId);
    expect(job).toBeDefined();
    expect(job!.jobId).toBe(jobId);
  });

  it("reflects completion after execute resolves", async () => {
    const { jobId } = await startGenerateJob("proj_1", {
      model: "test_model",
      prompt: "Test",
    });

    // Wait for background generation to complete
    await vi.waitFor(() => {
      const job = getJobStatus(jobId);
      return job?.status === "completed";
    });

    const job = getJobStatus(jobId);
    expect(job!.status).toBe("completed");
    expect(job!.progress).toBe(100);
    expect(job!.result?.success).toBe(true);
    expect(job!.completedAt).toBeDefined();
  });

  it("reflects failure after execute fails", async () => {
    mockExecute.mockResolvedValueOnce({
      success: false,
      error: "Model not found",
    });

    const { jobId } = await startGenerateJob("proj_1", {
      model: "bad_model",
      prompt: "Test",
    });

    await vi.waitFor(() => {
      const job = getJobStatus(jobId);
      return job?.status === "failed";
    });

    const job = getJobStatus(jobId);
    expect(job!.status).toBe("failed");
    expect(job!.message).toContain("Model not found");
  });
});

describe("listJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAvailable.mockResolvedValue(true);
    mockExecute.mockResolvedValue({ success: true });
  });

  it("lists all created jobs", async () => {
    await startGenerateJob("proj_1", { model: "m1", prompt: "p1" });
    await startGenerateJob("proj_1", { model: "m2", prompt: "p2" });

    const allJobs = listJobs();
    expect(allJobs.length).toBeGreaterThanOrEqual(2);
  });

  it("returns jobs sorted by creation time (newest first)", async () => {
    await startGenerateJob("proj_1", { model: "m1", prompt: "p1" });
    await new Promise((r) => setTimeout(r, 10));
    await startGenerateJob("proj_1", { model: "m2", prompt: "p2" });

    const allJobs = listJobs();
    expect(allJobs[0].createdAt).toBeGreaterThanOrEqual(allJobs[1].createdAt);
  });
});

describe("cancelJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAvailable.mockResolvedValue(true);
    // Make execute hang so we can cancel
    mockExecute.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 10_000))
    );
  });

  it("cancels a running job", async () => {
    const { jobId } = await startGenerateJob("proj_1", {
      model: "test",
      prompt: "Test",
    });

    const cancelled = cancelJob(jobId);
    expect(cancelled).toBe(true);
    expect(mockCancel).toHaveBeenCalledWith(jobId);
  });

  it("returns false for unknown job ID", () => {
    const cancelled = cancelJob("nonexistent");
    expect(cancelled).toBe(false);
  });
});

describe("listGenerateModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({
      success: true,
      data: { models: [], count: 0 },
      models: [],
    });
  });

  it("calls execute with list-models command", async () => {
    await listGenerateModels();

    expect(mockExecute).toHaveBeenCalledWith(
      { command: "list-models", args: {} },
      expect.any(Function)
    );
  });
});

describe("estimateGenerateCost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({
      success: true,
      cost: 0.15,
      data: { totalCost: 0.15 },
    });
  });

  it("calls execute with estimate-cost command", async () => {
    const result = await estimateGenerateCost("kling_v3_pro", { duration: 5 });

    expect(mockExecute).toHaveBeenCalledWith(
      {
        command: "estimate-cost",
        args: { model: "kling_v3_pro", duration: 5 },
      },
      expect.any(Function)
    );
    expect(result.success).toBe(true);
    expect(result.cost).toBe(0.15);
  });
});

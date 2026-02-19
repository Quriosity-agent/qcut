/**
 * Claude Generate-and-Add Handler
 *
 * Exposes the native AI pipeline over HTTP for Claude Code.
 * Wraps NativePipelineManager with job tracking so long-running
 * generation requests return immediately with a job ID.
 *
 * @module electron/claude/claude-generate-handler
 */

import { BrowserWindow } from "electron";
import {
  NativePipelineManager,
  type GenerateOptions,
  type PipelineResult,
  type PipelineProgress,
} from "../native-pipeline/index.js";
import { claudeLog } from "./utils/logger.js";

const HANDLER_NAME = "Generate";

// ============================================================================
// Job tracking
// ============================================================================

export interface GenerateJob {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  model: string;
  result?: PipelineResult;
  createdAt: number;
  completedAt?: number;
}

/** In-memory job store. Cleared on app restart. */
const jobs = new Map<string, GenerateJob>();

/** Limit stored jobs to prevent memory leaks */
const MAX_JOBS = 50;

function pruneOldJobs(): void {
  if (jobs.size <= MAX_JOBS) return;
  const entries = [...jobs.entries()].sort(
    (a, b) => a[1].createdAt - b[1].createdAt
  );
  const toRemove = entries.slice(0, entries.length - MAX_JOBS);
  for (const [id] of toRemove) {
    jobs.delete(id);
  }
}

// ============================================================================
// Pipeline manager (lazy init, shared instance)
// ============================================================================

let manager: NativePipelineManager | null = null;

function getManager(): NativePipelineManager {
  if (!manager) {
    manager = new NativePipelineManager();
  }
  return manager;
}

// ============================================================================
// Public API
// ============================================================================

export interface GenerateAndAddRequest {
  model: string;
  prompt: string;
  imageUrl?: string;
  videoUrl?: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  negativePrompt?: string;
  addToTimeline?: boolean;
  trackId?: string;
  startTime?: number;
  projectId?: string;
}

/**
 * Start a video/image generation job. Returns immediately with a job ID.
 * The generation runs in the background; poll with getJobStatus().
 */
export async function startGenerateJob(
  projectId: string,
  request: GenerateAndAddRequest
): Promise<{ jobId: string }> {
  const mgr = getManager();
  const available = await mgr.isAvailable();
  if (!available) {
    const status = await mgr.getStatus();
    throw new Error(
      status.error || "AI Pipeline not available. Configure FAL API key in Settings."
    );
  }

  const jobId = `gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const job: GenerateJob = {
    jobId,
    status: "queued",
    progress: 0,
    message: "Queued",
    model: request.model,
    createdAt: Date.now(),
  };

  jobs.set(jobId, job);
  pruneOldJobs();

  claudeLog.info(
    HANDLER_NAME,
    `Job ${jobId} created: ${request.model} for project ${projectId}`
  );

  // Determine command from model categories
  const command = resolveCommand(request);

  const options: GenerateOptions = {
    command,
    args: buildArgs(request),
    projectId,
    autoImport: true,
    sessionId: jobId,
  };

  // Fire-and-forget — run generation in background
  runGeneration(jobId, options, projectId, request).catch((err) => {
    claudeLog.error(HANDLER_NAME, `Job ${jobId} unexpected error:`, err);
  });

  return { jobId };
}

/**
 * Get the current status of a generation job.
 */
export function getJobStatus(jobId: string): GenerateJob | null {
  return jobs.get(jobId) ?? null;
}

/**
 * List all generation jobs, optionally filtered by project.
 */
export function listJobs(): GenerateJob[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Cancel a running generation job.
 */
export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status === "completed" || job.status === "failed") {
    return false;
  }

  const mgr = getManager();
  const cancelled = mgr.cancel(jobId);
  if (cancelled) {
    job.status = "cancelled";
    job.message = "Cancelled by user";
    job.completedAt = Date.now();
    claudeLog.info(HANDLER_NAME, `Job ${jobId} cancelled`);
  }
  return cancelled;
}

/**
 * List available generation models.
 */
export async function listGenerateModels(): Promise<PipelineResult> {
  const mgr = getManager();
  return mgr.execute(
    { command: "list-models", args: {} },
    () => {}
  );
}

/**
 * Estimate generation cost.
 */
export async function estimateGenerateCost(
  model: string,
  params?: { duration?: number; resolution?: string }
): Promise<PipelineResult> {
  const mgr = getManager();
  return mgr.execute(
    {
      command: "estimate-cost",
      args: { model, ...params },
    },
    () => {}
  );
}

// ============================================================================
// Internal helpers
// ============================================================================

function resolveCommand(
  request: GenerateAndAddRequest
): GenerateOptions["command"] {
  if (request.imageUrl || request.videoUrl) {
    return "create-video";
  }
  return "create-video";
}

function buildArgs(
  request: GenerateAndAddRequest
): Record<string, string | number | boolean> {
  const args: Record<string, string | number | boolean> = {
    model: request.model,
    text: request.prompt,
  };

  if (request.imageUrl) args["image-url"] = request.imageUrl;
  if (request.videoUrl) args["video-url"] = request.videoUrl;
  if (request.duration) args.duration = request.duration;
  if (request.aspectRatio) args.aspect_ratio = request.aspectRatio;
  if (request.resolution) args.resolution = request.resolution;
  if (request.negativePrompt) args.negative_prompt = request.negativePrompt;

  return args;
}

async function runGeneration(
  jobId: string,
  options: GenerateOptions,
  projectId: string,
  request: GenerateAndAddRequest
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "processing";
  job.message = "Starting generation...";

  const mgr = getManager();

  const onProgress = (progress: PipelineProgress) => {
    job.progress = progress.percent;
    job.message = progress.message;

    // Also forward to renderer for UI updates
    try {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send("ai-pipeline:progress", {
          sessionId: jobId,
          ...progress,
        });
      }
    } catch {
      // Window may not exist — ignore
    }
  };

  try {
    const result = await mgr.execute(options, onProgress);

    job.result = result;
    job.completedAt = Date.now();

    if (result.success) {
      job.status = "completed";
      job.progress = 100;
      job.message = "Generation complete";

      // If addToTimeline requested, send IPC to add element
      if (request.addToTimeline && result.mediaId) {
        try {
          const win = BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed()) {
            const elementId = `element_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            win.webContents.send("claude:timeline:addElement", {
              id: elementId,
              type: "media",
              mediaId: result.mediaId,
              trackId: request.trackId,
              startTime: request.startTime ?? 0,
            });
            claudeLog.info(
              HANDLER_NAME,
              `Job ${jobId}: Added element ${elementId} to timeline`
            );
          }
        } catch (err) {
          claudeLog.warn(
            HANDLER_NAME,
            `Job ${jobId}: Failed to add to timeline:`,
            err
          );
        }
      }

      claudeLog.info(
        HANDLER_NAME,
        `Job ${jobId} completed: ${result.outputPath ?? "no output"}`
      );
    } else {
      job.status = "failed";
      job.message = result.error || "Generation failed";
      claudeLog.error(
        HANDLER_NAME,
        `Job ${jobId} failed: ${result.error}`
      );
    }
  } catch (err) {
    job.status = "failed";
    job.message = err instanceof Error ? err.message : "Unknown error";
    job.completedAt = Date.now();
    claudeLog.error(HANDLER_NAME, `Job ${jobId} error:`, err);
  }
}

// CommonJS export for main.ts compatibility
module.exports = {
  startGenerateJob,
  getJobStatus,
  listJobs,
  cancelJob,
  listGenerateModels,
  estimateGenerateCost,
};

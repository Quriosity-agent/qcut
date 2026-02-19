/**
 * Claude HTTP Generate Routes
 * Registers AI video/image generation routes on the HTTP router.
 */

import type { Router } from "./utils/http-router.js";
import { HttpError } from "./utils/http-router.js";
import {
  startGenerateJob,
  getJobStatus,
  listJobs,
  cancelJob,
  listGenerateModels,
  estimateGenerateCost,
} from "./claude-generate-handler.js";
import { logOperation } from "./claude-operation-log.js";

/**
 * Register AI generation routes on the router.
 */
export function registerGenerateRoutes(router: Router): void {
  // Start a generation job (returns job ID immediately)
  router.post("/api/claude/generate/:projectId/start", async (req) => {
    if (!req.body?.model || !req.body?.prompt) {
      throw new HttpError(400, "Missing 'model' and 'prompt' in request body");
    }
    try {
      const result = await startGenerateJob(req.params.projectId, {
        model: req.body.model,
        prompt: req.body.prompt,
        imageUrl: req.body.imageUrl,
        videoUrl: req.body.videoUrl,
        duration: req.body.duration,
        aspectRatio: req.body.aspectRatio,
        resolution: req.body.resolution,
        negativePrompt: req.body.negativePrompt,
        addToTimeline: req.body.addToTimeline,
        trackId: req.body.trackId,
        startTime: req.body.startTime,
        projectId: req.params.projectId,
      });
      logOperation({
        stage: 1,
        action: "generate",
        details: `Started generation with model ${req.body.model}`,
        timestamp: Date.now(),
        projectId: req.params.projectId,
        metadata: { jobId: result.jobId, model: req.body.model },
      });
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        error instanceof Error ? error.message : "Generation failed"
      );
    }
  });

  // Poll job status
  router.get("/api/claude/generate/:projectId/jobs/:jobId", async (req) => {
    const job = getJobStatus(req.params.jobId);
    if (!job) {
      throw new HttpError(404, `Job not found: ${req.params.jobId}`);
    }
    return job;
  });

  // List all jobs
  router.get("/api/claude/generate/:projectId/jobs", async () => {
    return listJobs();
  });

  // Cancel a job
  router.post("/api/claude/generate/:projectId/jobs/:jobId/cancel", async (req) => {
    const cancelled = cancelJob(req.params.jobId);
    if (!cancelled) {
      throw new HttpError(400, `Job cannot be cancelled: ${req.params.jobId}`);
    }
    return { cancelled: true };
  });

  // List available generation models
  router.get("/api/claude/generate/models", async () => {
    try {
      return await listGenerateModels();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        error instanceof Error ? error.message : "Failed to list models"
      );
    }
  });

  // Estimate generation cost
  router.post("/api/claude/generate/estimate-cost", async (req) => {
    if (!req.body?.model) {
      throw new HttpError(400, "Missing 'model' in request body");
    }
    try {
      return await estimateGenerateCost(req.body.model, {
        duration: req.body.duration,
        resolution: req.body.resolution,
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        error instanceof Error ? error.message : "Cost estimation failed"
      );
    }
  });
}

// CommonJS export for compatibility
module.exports = { registerGenerateRoutes };

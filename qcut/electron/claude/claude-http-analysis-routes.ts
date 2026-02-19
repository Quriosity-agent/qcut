/**
 * Claude HTTP Analysis & Editing Routes
 * Registers video analysis, transcription, scene detection, filler analysis,
 * and Stage 3 cut/edit routes on the HTTP router.
 */

import type { Router } from "./utils/http-router.js";
import { HttpError } from "./utils/http-router.js";
import { analyzeVideo, listAnalyzeModels } from "./claude-analyze-handler.js";
import {
  transcribeMedia,
  startTranscribeJob,
  getTranscribeJobStatus,
  listTranscribeJobs,
  cancelTranscribeJob,
} from "./claude-transcribe-handler.js";
import { detectScenes } from "./claude-scene-handler.js";
import { analyzeFrames } from "./claude-vision-handler.js";
import { analyzeFillers } from "./claude-filler-handler.js";
import { executeBatchCuts } from "./claude-cuts-handler.js";
import { executeDeleteRange } from "./claude-range-handler.js";
import { autoEdit } from "./claude-auto-edit-handler.js";
import { suggestCuts } from "./claude-suggest-handler.js";
import { logOperation } from "./claude-operation-log.js";
import type { BrowserWindow } from "electron";

/**
 * Register analysis, transcription, and Stage 3 editing routes on the router.
 */
export function registerAnalysisRoutes(
  router: Router,
  getWindow: () => BrowserWindow
): void {
  // ==========================================================================
  // Video Analysis routes
  // ==========================================================================
  router.post("/api/claude/analyze/:projectId", async (req) => {
    if (!req.body?.source) {
      throw new HttpError(400, "Missing 'source' in request body");
    }
    try {
      const result = await analyzeVideo(req.params.projectId, {
        source: req.body.source,
        analysisType: req.body.analysisType,
        model: req.body.model,
        format: req.body.format,
      });
      if (!result.success) {
        throw new HttpError(500, result.error);
      }
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        error instanceof Error ? error.message : "Analysis failed"
      );
    }
  });

  router.get("/api/claude/analyze/models", async () => {
    return listAnalyzeModels();
  });

  // ==========================================================================
  // Transcription routes (Stage 2)
  // ==========================================================================
  router.post("/api/claude/transcribe/:projectId", async (req) => {
    if (!req.body?.mediaId) {
      throw new HttpError(400, "Missing 'mediaId' in request body");
    }
    try {
      const result = await transcribeMedia(req.params.projectId, {
        mediaId: req.body.mediaId,
        provider: req.body.provider,
        language: req.body.language,
        diarize: req.body.diarize,
      });
      logOperation({
        stage: 2,
        action: "transcribe",
        details: `Transcribed media ${req.body.mediaId}`,
        timestamp: Date.now(),
        projectId: req.params.projectId,
        metadata: { mediaId: req.body.mediaId, provider: req.body.provider },
      });
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        error instanceof Error ? error.message : "Transcription failed"
      );
    }
  });

  // Async transcription routes (preferred — avoids 30s HTTP timeout)
  router.post("/api/claude/transcribe/:projectId/start", async (req) => {
    if (!req.body?.mediaId) {
      throw new HttpError(400, "Missing 'mediaId' in request body");
    }
    const { jobId } = startTranscribeJob(req.params.projectId, {
      mediaId: req.body.mediaId,
      provider: req.body.provider,
      language: req.body.language,
      diarize: req.body.diarize,
    });
    return { jobId };
  });

  router.get(
    "/api/claude/transcribe/:projectId/jobs/:jobId",
    async (req) => {
      const job = getTranscribeJobStatus(req.params.jobId);
      if (!job) {
        throw new HttpError(404, `Job not found: ${req.params.jobId}`);
      }
      return job;
    }
  );

  router.get("/api/claude/transcribe/:projectId/jobs", async () => {
    return listTranscribeJobs();
  });

  router.post(
    "/api/claude/transcribe/:projectId/jobs/:jobId/cancel",
    async (req) => {
      const cancelled = cancelTranscribeJob(req.params.jobId);
      return { cancelled };
    }
  );

  // ==========================================================================
  // Scene Detection routes (Stage 2)
  // ==========================================================================
  router.post("/api/claude/analyze/:projectId/scenes", async (req) => {
    if (!req.body?.mediaId) {
      throw new HttpError(400, "Missing 'mediaId' in request body");
    }
    try {
      const result = await detectScenes(req.params.projectId, {
        mediaId: req.body.mediaId,
        threshold: req.body.threshold,
        aiAnalysis: req.body.aiAnalysis,
        model: req.body.model,
      });
      logOperation({
        stage: 2,
        action: "analyze-scenes",
        details: `Detected scenes for media ${req.body.mediaId}`,
        timestamp: Date.now(),
        projectId: req.params.projectId,
        metadata: { mediaId: req.body.mediaId, model: req.body.model },
      });
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        error instanceof Error ? error.message : "Scene detection failed"
      );
    }
  });

  // ==========================================================================
  // Frame Analysis routes (Stage 2)
  // ==========================================================================
  router.post("/api/claude/analyze/:projectId/frames", async (req) => {
    if (!req.body?.mediaId) {
      throw new HttpError(400, "Missing 'mediaId' in request body");
    }
    try {
      return await analyzeFrames(req.params.projectId, {
        mediaId: req.body.mediaId,
        timestamps: req.body.timestamps,
        interval: req.body.interval,
        prompt: req.body.prompt,
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        error instanceof Error ? error.message : "Frame analysis failed"
      );
    }
  });

  // ==========================================================================
  // Filler Detection routes (Stage 2)
  // ==========================================================================
  router.post("/api/claude/analyze/:projectId/fillers", async (req) => {
    if (!Array.isArray(req.body?.words)) {
      throw new HttpError(400, "Missing 'words' array in request body");
    }
    try {
      const result = await analyzeFillers(req.params.projectId, {
        mediaId: req.body.mediaId,
        words: req.body.words,
      });
      logOperation({
        stage: 2,
        action: "analyze-fillers",
        details: `Analyzed filler words for media ${req.body.mediaId ?? "unknown"}`,
        timestamp: Date.now(),
        projectId: req.params.projectId,
      });
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        error instanceof Error ? error.message : "Filler analysis failed"
      );
    }
  });

  // ==========================================================================
  // Batch Cut-List routes (Stage 3)
  // ==========================================================================
  router.post("/api/claude/timeline/:projectId/cuts", async (req) => {
    if (!req.body?.elementId || !Array.isArray(req.body?.cuts)) {
      throw new HttpError(
        400,
        "Missing 'elementId' and 'cuts' array in request body"
      );
    }
    const win = getWindow();
    return Promise.race([
      executeBatchCuts(win, {
        elementId: req.body.elementId,
        cuts: req.body.cuts,
        ripple: req.body.ripple,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new HttpError(504, "Renderer timed out")),
          30_000
        )
      ),
    ]);
  });

  // ==========================================================================
  // Range Delete routes (Stage 3)
  // ==========================================================================
  router.delete("/api/claude/timeline/:projectId/range", async (req) => {
    if (
      typeof req.body?.startTime !== "number" ||
      typeof req.body?.endTime !== "number"
    ) {
      throw new HttpError(
        400,
        "Missing 'startTime' and 'endTime' in request body"
      );
    }
    const win = getWindow();
    return Promise.race([
      executeDeleteRange(win, {
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        trackIds: req.body.trackIds,
        ripple: req.body.ripple,
        crossTrackRipple: req.body.crossTrackRipple,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new HttpError(504, "Renderer timed out")),
          30_000
        )
      ),
    ]);
  });

  // ==========================================================================
  // Auto-Edit routes (Stage 3)
  // ==========================================================================
  router.post("/api/claude/timeline/:projectId/auto-edit", async (req) => {
    if (!req.body?.elementId || !req.body?.mediaId) {
      throw new HttpError(
        400,
        "Missing 'elementId' and 'mediaId' in request body"
      );
    }
    const win = getWindow();
    try {
      return await autoEdit(
        req.params.projectId,
        {
          elementId: req.body.elementId,
          mediaId: req.body.mediaId,
          removeFillers: req.body.removeFillers,
          removeSilences: req.body.removeSilences,
          silenceThreshold: req.body.silenceThreshold,
          keepSilencePadding: req.body.keepSilencePadding,
          dryRun: req.body.dryRun,
          provider: req.body.provider,
          language: req.body.language,
        },
        win
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        error instanceof Error ? error.message : "Auto-edit failed"
      );
    }
  });

  // ==========================================================================
  // Cut Suggestions routes (Stage 3)
  // ==========================================================================
  router.post("/api/claude/analyze/:projectId/suggest-cuts", async (req) => {
    if (!req.body?.mediaId) {
      throw new HttpError(400, "Missing 'mediaId' in request body");
    }
    try {
      return await suggestCuts(req.params.projectId, {
        mediaId: req.body.mediaId,
        provider: req.body.provider,
        language: req.body.language,
        sceneThreshold: req.body.sceneThreshold,
        includeFillers: req.body.includeFillers,
        includeSilences: req.body.includeSilences,
        includeScenes: req.body.includeScenes,
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        error instanceof Error ? error.message : "Suggest cuts failed"
      );
    }
  });
}

// CommonJS export for compatibility
module.exports = { registerAnalysisRoutes };

/**
 * Claude HTTP Server
 * Exposes QCut's Claude API over HTTP so Claude Code can control QCut externally.
 *
 * Architecture:
 *   Claude Code ──HTTP──> localhost:8765 ──> extracted handler functions ──> QCut
 *
 * For routes that need renderer data (timeline, stats), the server communicates
 * with the renderer via IPC through the existing BrowserWindow.
 */

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { app, BrowserWindow } from "electron";
import { createRouter, HttpError } from "./utils/http-router.js";
import { claudeLog } from "./utils/logger.js";

// Extracted handler functions (shared with IPC handlers)
import {
  listMediaFiles,
  getMediaInfo,
  importMediaFile,
  deleteMediaFile,
  renameMediaFile,
  importMediaFromUrl,
  batchImportMedia,
  extractFrame,
} from "./claude-media-handler.js";
import {
  requestTimelineFromRenderer,
  requestSplitFromRenderer,
  requestSelectionFromRenderer,
  batchAddElements,
  batchUpdateElements,
  batchDeleteElements,
  arrangeTimeline,
  timelineToMarkdown,
  markdownToTimeline,
  validateTimeline,
} from "./claude-timeline-handler.js";
import {
  getProjectSettings,
  updateProjectSettings,
  getProjectStats,
  getEmptyStats,
} from "./claude-project-handler.js";
import {
  getExportPresets,
  getExportRecommendation,
  startExportJob,
  getExportJobStatus,
  listExportJobs,
} from "./claude-export-handler.js";
import { analyzeError } from "./claude-diagnostics-handler.js";
import {
  generateProjectSummary,
  generatePipelineReport,
} from "./claude-summary-handler.js";
import {
  logOperation,
  getOperationLog,
  clearOperationLog,
} from "./claude-operation-log.js";
import { generatePersonaPlex } from "./claude-personaplex-handler.js";
import { registerAnalysisRoutes } from "./claude-http-analysis-routes.js";
import { registerGenerateRoutes } from "./claude-http-generate-routes.js";


let server: Server | null = null;

/**
 * Get the first available BrowserWindow or throw 503
 */
function getWindow(): BrowserWindow {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) throw new HttpError(503, "No active QCut window");
  return win;
}

/**
 * Check bearer token auth (only enforced when QCUT_API_TOKEN is set)
 */
function checkAuth(req: IncomingMessage): boolean {
  const token = process.env.QCUT_API_TOKEN;
  if (!token) return true;
  const authHeader = req.headers.authorization;
  return authHeader === `Bearer ${token}`;
}

/** Set permissive CORS headers on the HTTP response. */
function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/** Start the local HTTP API server for Claude and MCP integrations. */
export function startClaudeHTTPServer(
  port = Number.parseInt(process.env.QCUT_API_PORT ?? "8765", 10)
): void {
  const resolvedPort = Number.isFinite(port) && port > 0 ? port : 8765;
  if (resolvedPort !== port) {
    claudeLog.warn("HTTP", "Invalid QCUT_API_PORT, falling back to 8765");
  }
  if (server) {
    claudeLog.warn("HTTP", "Server already running, skipping start");
    return;
  }

  const router = createRouter();

  // ==========================================================================
  // Health check
  // ==========================================================================
  router.get("/api/claude/health", async () => ({
    status: "ok",
    version: app.getVersion(),
    uptime: process.uptime(),
  }));

  // ==========================================================================
  // Media routes (file-system based — no renderer needed)
  // ==========================================================================
  router.get("/api/claude/media/:projectId", async (req) => {
    return listMediaFiles(req.params.projectId);
  });

  router.get("/api/claude/media/:projectId/:mediaId", async (req) => {
    return getMediaInfo(req.params.projectId, req.params.mediaId);
  });

  router.post("/api/claude/media/:projectId/import", async (req) => {
    if (!req.body?.source) {
      throw new HttpError(400, "Missing 'source' in request body");
    }
    const media = await importMediaFile(req.params.projectId, req.body.source);
    logOperation({
      stage: 1,
      action: "import",
      details: `Imported media from path: ${req.body.source}`,
      timestamp: Date.now(),
      projectId: req.params.projectId,
    });
    return media;
  });

  router.delete("/api/claude/media/:projectId/:mediaId", async (req) => {
    return deleteMediaFile(req.params.projectId, req.params.mediaId);
  });

  router.patch("/api/claude/media/:projectId/:mediaId/rename", async (req) => {
    if (!req.body?.newName) {
      throw new HttpError(400, "Missing 'newName' in request body");
    }
    return renameMediaFile(
      req.params.projectId,
      req.params.mediaId,
      req.body.newName
    );
  });

  // ---- Import from URL ----
  router.post("/api/claude/media/:projectId/import-from-url", async (req) => {
    if (!req.body?.url) {
      throw new HttpError(400, "Missing 'url' in request body");
    }
    const result = await importMediaFromUrl(
      req.params.projectId,
      req.body.url,
      req.body.filename
    );
    logOperation({
      stage: 1,
      action: "import",
      details: `Imported media from URL: ${req.body.url}`,
      timestamp: Date.now(),
      projectId: req.params.projectId,
    });
    return result;
  });

  // ---- Batch import (paths and/or URLs) ----
  router.post("/api/claude/media/:projectId/batch-import", async (req) => {
    if (!Array.isArray(req.body?.items)) {
      throw new HttpError(400, "Missing 'items' array in request body");
    }
    const result = await batchImportMedia(req.params.projectId, req.body.items);
    logOperation({
      stage: 1,
      action: "import",
      details: `Batch import processed ${req.body.items.length} item(s)`,
      timestamp: Date.now(),
      projectId: req.params.projectId,
    });
    return result;
  });

  // ---- Extract frame from video ----
  router.post(
    "/api/claude/media/:projectId/:mediaId/extract-frame",
    async (req) => {
      if (typeof req.body?.timestamp !== "number") {
        throw new HttpError(
          400,
          "Missing 'timestamp' (number) in request body"
        );
      }
      return extractFrame(
        req.params.projectId,
        req.params.mediaId,
        req.body.timestamp,
        req.body.format
      );
    }
  );

  // ==========================================================================
  // Generate-and-Add routes (AI video/image generation via native pipeline)
  // ==========================================================================

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

  // ==========================================================================
  // Timeline routes (renderer-dependent for export/import)
  // ==========================================================================
  router.get("/api/claude/timeline/:projectId", async (req) => {
    const win = getWindow();
    const timeline = await Promise.race([
      requestTimelineFromRenderer(win),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)
      ),
    ]);
    const format = req.query.format || "json";
    if (format === "md") {
      return timelineToMarkdown(timeline);
    }
    return timeline;
  });

  router.post("/api/claude/timeline/:projectId/import", async (req) => {
    if (!req.body?.data) {
      throw new HttpError(400, "Missing 'data' in request body");
    }
    const format = req.body.format || "json";
    let timeline;
    if (format === "md") {
      timeline = markdownToTimeline(req.body.data);
    } else {
      if (typeof req.body.data === "string") {
        try {
          timeline = JSON.parse(req.body.data);
        } catch {
          throw new HttpError(400, "Invalid JSON in 'data'");
        }
      } else {
        timeline = req.body.data;
      }
    }
    validateTimeline(timeline);
    const win = getWindow();
    win.webContents.send("claude:timeline:apply", timeline);
    return { imported: true };
  });

  router.post("/api/claude/timeline/:projectId/elements", async (req) => {
    if (!req.body) {
      throw new HttpError(400, "Missing element data in request body");
    }
    const win = getWindow();
    const elementId =
      req.body.id ||
      `element_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    win.webContents.send("claude:timeline:addElement", {
      ...req.body,
      id: elementId,
    });
    return { elementId };
  });

  router.post("/api/claude/timeline/:projectId/elements/batch", async (req) => {
    if (!Array.isArray(req.body?.elements)) {
      throw new HttpError(400, "Missing 'elements' array in request body");
    }
    const win = getWindow();
    try {
      return await batchAddElements(win, req.params.projectId, req.body.elements);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : "Batch add failed"
      );
    }
  });

  router.patch("/api/claude/timeline/:projectId/elements/batch", async (req) => {
    if (!Array.isArray(req.body?.updates)) {
      throw new HttpError(400, "Missing 'updates' array in request body");
    }
    const win = getWindow();
    try {
      return await batchUpdateElements(win, req.body.updates);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : "Batch update failed"
      );
    }
  });

  router.patch(
    "/api/claude/timeline/:projectId/elements/:elementId",
    async (req) => {
      const win = getWindow();
      win.webContents.send("claude:timeline:updateElement", {
        elementId: req.params.elementId,
        changes: req.body || {},
      });
      return { updated: true };
    }
  );

  router.delete(
    "/api/claude/timeline/:projectId/elements/batch",
    async (req) => {
      if (!Array.isArray(req.body?.elements)) {
        throw new HttpError(400, "Missing 'elements' array in request body");
      }
      const win = getWindow();
      try {
        return await batchDeleteElements(
          win,
          req.body.elements,
          Boolean(req.body.ripple)
        );
      } catch (error) {
        throw new HttpError(
          400,
          error instanceof Error ? error.message : "Batch delete failed"
        );
      }
    }
  );

  router.delete(
    "/api/claude/timeline/:projectId/elements/:elementId",
    async (req) => {
      const win = getWindow();
      win.webContents.send(
        "claude:timeline:removeElement",
        req.params.elementId
      );
      return { removed: true };
    }
  );

  router.post("/api/claude/timeline/:projectId/arrange", async (req) => {
    if (!req.body?.trackId || typeof req.body.trackId !== "string") {
      throw new HttpError(400, "Missing 'trackId' in request body");
    }
    if (!req.body?.mode || typeof req.body.mode !== "string") {
      throw new HttpError(400, "Missing 'mode' in request body");
    }
    if (
      req.body.mode !== "sequential" &&
      req.body.mode !== "spaced" &&
      req.body.mode !== "manual"
    ) {
      throw new HttpError(400, "Invalid mode. Use sequential, spaced, or manual");
    }
    const win = getWindow();
    try {
      return await arrangeTimeline(win, {
        trackId: req.body.trackId,
        mode: req.body.mode,
        gap: req.body.gap,
        order: req.body.order,
        startOffset: req.body.startOffset,
      });
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : "Arrange request failed"
      );
    }
  });

  // ---- Split element ----
  router.post(
    "/api/claude/timeline/:projectId/elements/:elementId/split",
    async (req) => {
      if (typeof req.body?.splitTime !== "number") {
        throw new HttpError(
          400,
          "Missing 'splitTime' (number) in request body"
        );
      }
      const win = getWindow();
      const mode = req.body.mode || "split";
      if (!["split", "keepLeft", "keepRight"].includes(mode)) {
        throw new HttpError(
          400,
          "Invalid mode. Use 'split', 'keepLeft', or 'keepRight'"
        );
      }
      return requestSplitFromRenderer(
        win,
        req.params.elementId,
        req.body.splitTime,
        mode
      );
    }
  );

  // ---- Move element ----
  router.post(
    "/api/claude/timeline/:projectId/elements/:elementId/move",
    async (req) => {
      if (!req.body?.toTrackId) {
        throw new HttpError(400, "Missing 'toTrackId' in request body");
      }
      const win = getWindow();
      win.webContents.send("claude:timeline:moveElement", {
        elementId: req.params.elementId,
        toTrackId: req.body.toTrackId,
        newStartTime: req.body.newStartTime,
      });
      return { moved: true };
    }
  );

  // ---- Selection (set, get, clear) ----
  router.post("/api/claude/timeline/:projectId/selection", async (req) => {
    if (!Array.isArray(req.body?.elements)) {
      throw new HttpError(400, "Missing 'elements' array in request body");
    }
    const win = getWindow();
    win.webContents.send("claude:timeline:selectElements", {
      elements: req.body.elements,
    });
    return { selected: req.body.elements.length };
  });

  router.get("/api/claude/timeline/:projectId/selection", async () => {
    const win = getWindow();
    const elements = await Promise.race([
      requestSelectionFromRenderer(win),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)
      ),
    ]);
    return { elements };
  });

  router.delete("/api/claude/timeline/:projectId/selection", async () => {
    const win = getWindow();
    win.webContents.send("claude:timeline:clearSelection");
    return { cleared: true };
  });

  // ==========================================================================
  // Project routes
  // ==========================================================================
  router.get("/api/claude/project/:projectId/settings", async (req) => {
    return getProjectSettings(req.params.projectId);
  });

  router.patch("/api/claude/project/:projectId/settings", async (req) => {
    if (!req.body) {
      throw new HttpError(400, "Missing settings in request body");
    }
    await updateProjectSettings(req.params.projectId, req.body);
    return { updated: true };
  });

  router.get("/api/claude/project/:projectId/stats", async (req) => {
    try {
      const win = getWindow();
      return getProjectStats(win, req.params.projectId);
    } catch {
      return getEmptyStats();
    }
  });

  router.get("/api/claude/project/:projectId/summary", async (req) => {
    try {
      const win = getWindow();
      const timeline = await Promise.race([
        requestTimelineFromRenderer(win),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)
        ),
      ]);
      const [mediaFiles, settings] = await Promise.all([
        listMediaFiles(req.params.projectId),
        getProjectSettings(req.params.projectId),
      ]);
      const exportJobs = listExportJobs(req.params.projectId);
      return generateProjectSummary({
        timeline,
        mediaFiles,
        exportJobs,
        settings,
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        error instanceof Error ? error.message : "Failed to generate summary"
      );
    }
  });

  router.post("/api/claude/project/:projectId/report", async (req) => {
    try {
      const win = getWindow();
      const timeline = await Promise.race([
        requestTimelineFromRenderer(win),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)
        ),
      ]);
      const [mediaFiles, settings] = await Promise.all([
        listMediaFiles(req.params.projectId),
        getProjectSettings(req.params.projectId),
      ]);
      const exportJobs = listExportJobs(req.params.projectId);
      const summary = generateProjectSummary({
        timeline,
        mediaFiles,
        exportJobs,
        settings,
      });
      const steps = getOperationLog({ projectId: req.params.projectId });
      const report = await generatePipelineReport({
        steps,
        summary,
        saveToDisk: req.body?.saveToDisk === true,
        outputDir:
          typeof req.body?.outputDir === "string" ? req.body.outputDir : undefined,
        projectId: req.params.projectId,
      });

      if (req.body?.clearLog === true) {
        clearOperationLog({ projectId: req.params.projectId });
      }

      return report;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        error instanceof Error ? error.message : "Failed to generate report"
      );
    }
  });

  // ==========================================================================
  // Export routes
  // ==========================================================================
  router.get("/api/claude/export/presets", async () => {
    return getExportPresets();
  });

  router.get("/api/claude/export/:projectId/recommend/:target", async (req) => {
    return getExportRecommendation(req.params.target);
  });

  router.post("/api/claude/export/:projectId/start", async (req) => {
    try {
      const win = getWindow();
      const timeline = await Promise.race([
        requestTimelineFromRenderer(win),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)
        ),
      ]);
      const mediaFiles = await listMediaFiles(req.params.projectId);
      return await startExportJob({
        projectId: req.params.projectId,
        request: req.body || {},
        timeline,
        mediaFiles,
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        400,
        error instanceof Error ? error.message : "Failed to start export"
      );
    }
  });

  router.get("/api/claude/export/:projectId/jobs/:jobId", async (req) => {
    const job = getExportJobStatus(req.params.jobId);
    if (!job || job.projectId !== req.params.projectId) {
      throw new HttpError(404, `Job not found: ${req.params.jobId}`);
    }
    return job;
  });

  router.get("/api/claude/export/:projectId/jobs", async (req) => {
    return listExportJobs(req.params.projectId);
  });

  // ==========================================================================
  // Diagnostics routes
  // ==========================================================================
  router.post("/api/claude/diagnostics/analyze", async (req) => {
    if (!req.body?.message) {
      throw new HttpError(400, "Missing 'message' in error report");
    }
    return analyzeError(req.body);
  });

  // ==========================================================================
  // Analysis, Transcription, and Stage 3 editing routes
  // ==========================================================================
  registerAnalysisRoutes(router, getWindow);

  // ==========================================================================
  // PersonaPlex proxy (fal-ai/personaplex speech-to-speech)
  // ==========================================================================
  router.post("/api/claude/personaplex/generate", async (req) => {
    return generatePersonaPlex(req.body);
  });

  // ==========================================================================
  // MCP app preview forwarding
  // ==========================================================================
  router.post("/api/claude/mcp/app", async (req) => {
    if (
      !req.body ||
      typeof req.body.html !== "string" ||
      !req.body.html.trim()
    ) {
      throw new HttpError(400, "Missing 'html' in request body");
    }

    const toolName =
      typeof req.body.toolName === "string" ? req.body.toolName : "unknown";
    let forwarded = false;
    let error: string | undefined;
    try {
      const win = getWindow();
      win.webContents.send("mcp:app-html", {
        html: req.body.html,
        toolName,
      });
      forwarded = true;
    } catch (err) {
      forwarded = false;
      error = err instanceof Error ? err.message : "Unknown error";
    }

    return { forwarded, ...(error && { error }) };
  });

  // ==========================================================================
  // Create and start the server
  // ==========================================================================
  server = createServer((req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 30s request timeout
    req.setTimeout(30_000, () => {
      res.writeHead(408, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Request timeout",
          timestamp: Date.now(),
        })
      );
    });

    // Auth check
    if (!checkAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: "Unauthorized",
          timestamp: Date.now(),
        })
      );
      return;
    }

    router.handle(req, res);
  });

  server.listen(resolvedPort, "127.0.0.1", () => {
    claudeLog.info(
      "HTTP",
      `Server started on http://127.0.0.1:${resolvedPort}`
    );
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      claudeLog.warn(
        "HTTP",
        `Port ${resolvedPort} in use. Claude HTTP API disabled.`
      );
    } else {
      claudeLog.error("HTTP", `Server error: ${err.message}`);
    }
    server = null;
  });
}

/** Stop the running Claude HTTP server if active. */
export function stopClaudeHTTPServer(): void {
  if (server) {
    server.close();
    server = null;
    claudeLog.info("HTTP", "Server stopped");
  }
}

// CommonJS export for main.ts compatibility
module.exports = { startClaudeHTTPServer, stopClaudeHTTPServer };

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
} from "./claude-media-handler.js";
import {
  requestTimelineFromRenderer,
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
} from "./claude-export-handler.js";
import { analyzeError, getSystemInfo } from "./claude-diagnostics-handler.js";
import { getDecryptedApiKeys } from "../api-key-handler.js";

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

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

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
    return importMediaFile(req.params.projectId, req.body.source);
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

  // ==========================================================================
  // Export routes
  // ==========================================================================
  router.get("/api/claude/export/presets", async () => {
    return getExportPresets();
  });

  router.get("/api/claude/export/:projectId/recommend/:target", async (req) => {
    return getExportRecommendation(req.params.target);
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
  // PersonaPlex proxy (fal-ai/personaplex speech-to-speech)
  // ==========================================================================
  router.post("/api/claude/personaplex/generate", async (req) => {
    if (!req.body?.audio_url) {
      throw new HttpError(400, "Missing 'audio_url' in request body");
    }

    const keys = await getDecryptedApiKeys();
    const apiKey = keys.falApiKey;
    if (!apiKey) {
      throw new HttpError(
        400,
        "FAL API key not configured. Go to Settings → API Keys to set it."
      );
    }

    const requestBody: Record<string, unknown> = {
      audio_url: req.body.audio_url,
    };
    if (req.body.prompt) requestBody.prompt = req.body.prompt;
    if (req.body.voice) requestBody.voice = req.body.voice;
    if (req.body.temperature_audio != null)
      requestBody.temperature_audio = req.body.temperature_audio;
    if (req.body.temperature_text != null)
      requestBody.temperature_text = req.body.temperature_text;
    if (req.body.top_k_audio != null)
      requestBody.top_k_audio = req.body.top_k_audio;
    if (req.body.top_k_text != null)
      requestBody.top_k_text = req.body.top_k_text;
    if (req.body.seed != null) requestBody.seed = req.body.seed;
    if (req.body.output_format)
      requestBody.output_format = req.body.output_format;

    claudeLog.info("HTTP", "PersonaPlex generate request");

    const falResponse = await fetch("https://fal.run/fal-ai/personaplex", {
      signal: AbortSignal.timeout(25_000),
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      claudeLog.error(
        "HTTP",
        `PersonaPlex API error: ${falResponse.status} ${errorText}`
      );
      throw new HttpError(
        falResponse.status,
        `PersonaPlex API error: ${errorText}`
      );
    }

    let result: unknown;
    try {
      result = await falResponse.json();
    } catch {
      throw new HttpError(502, "PersonaPlex API returned invalid JSON");
    }
    claudeLog.info("HTTP", "PersonaPlex generate complete");
    return result;
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

export function stopClaudeHTTPServer(): void {
  if (server) {
    server.close();
    server = null;
    claudeLog.info("HTTP", "Server stopped");
  }
}

// CommonJS export for main.ts compatibility
module.exports = { startClaudeHTTPServer, stopClaudeHTTPServer };

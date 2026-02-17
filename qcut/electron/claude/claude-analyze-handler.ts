/**
 * Claude Video Analysis Handler
 * Runs AICP video analysis on videos from timeline, media panel, or file paths.
 * Returns structured markdown/JSON for LLM consumption.
 */

import { ipcMain, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  getProjectPath,
  isValidSourcePath,
  sanitizeProjectId,
} from "./utils/helpers.js";
import { claudeLog } from "./utils/logger.js";
import { getMediaInfo } from "./claude-media-handler.js";
import { requestTimelineFromRenderer } from "./claude-timeline-handler.js";
import { AIPipelineManager } from "../ai-pipeline-handler.js";
import { getDecryptedApiKeys } from "../api-key-handler.js";
import type {
  AnalyzeSource,
  AnalyzeOptions,
  AnalyzeResult,
  AnalyzeModel,
  ClaudeTimeline,
} from "../types/claude-api";

const HANDLER_NAME = "Analyze";

/** Available models for video analysis */
const ANALYZE_MODELS: AnalyzeModel[] = [
  {
    key: "gemini-2.5-flash",
    provider: "fal",
    modelId: "google/gemini-2.5-flash",
    description: "Fast and cost-effective (default)",
  },
  {
    key: "gemini-2.5-pro",
    provider: "fal",
    modelId: "google/gemini-2.5-pro",
    description: "Higher quality, balanced speed",
  },
  {
    key: "gemini-3-pro",
    provider: "fal",
    modelId: "google/gemini-3-pro-preview",
    description: "Highest quality, slower",
  },
  {
    key: "gemini-direct",
    provider: "gemini",
    modelId: "gemini-2.0-flash-exp",
    description: "Direct Gemini API (requires GEMINI_API_KEY)",
  },
];

const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Resolve a video source to an absolute file path.
 */
export async function resolveVideoPath(
  projectId: string,
  source: AnalyzeSource
): Promise<string> {
  switch (source.type) {
    case "path": {
      if (!source.filePath) {
        throw new Error("Missing 'filePath' for path source");
      }
      if (!isValidSourcePath(source.filePath)) {
        throw new Error(
          "Invalid file path: must be an absolute path without null bytes"
        );
      }
      if (!existsSync(source.filePath)) {
        throw new Error(`File not found: ${source.filePath}`);
      }
      return source.filePath;
    }

    case "media": {
      if (!source.mediaId) {
        throw new Error("Missing 'mediaId' for media source");
      }
      const media = await getMediaInfo(projectId, source.mediaId);
      if (!media) {
        throw new Error(`Media not found: ${source.mediaId}`);
      }
      if (media.type !== "video") {
        throw new Error(`Media is not a video (type: ${media.type})`);
      }
      if (!existsSync(media.path)) {
        throw new Error(`Media file missing on disk: ${media.path}`);
      }
      return media.path;
    }

    case "timeline": {
      if (!source.elementId) {
        throw new Error("Missing 'elementId' for timeline source");
      }
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) {
        throw new Error("No active QCut window for timeline lookup");
      }
      const timeline: ClaudeTimeline = await Promise.race([
        requestTimelineFromRenderer(win),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout getting timeline")), 5000)
        ),
      ]);

      // Find element across all tracks
      let sourceId: string | undefined;
      for (const track of timeline.tracks) {
        const element = track.elements.find((e) => e.id === source.elementId);
        if (element) {
          sourceId = element.sourceId;
          break;
        }
      }
      if (!sourceId) {
        throw new Error(`Element not found in timeline: ${source.elementId}`);
      }

      // Resolve sourceId to media file path
      const media = await getMediaInfo(projectId, sourceId);
      if (!media) {
        throw new Error(`Source media not found for element: ${sourceId}`);
      }
      if (media.type !== "video") {
        throw new Error(
          `Timeline element is not a video (type: ${media.type})`
        );
      }
      if (!existsSync(media.path)) {
        throw new Error(`Source media file missing on disk: ${media.path}`);
      }
      return media.path;
    }

    default:
      throw new Error(`Unknown source type: ${(source as AnalyzeSource).type}`);
  }
}

/**
 * Find the aicp binary command and base args.
 * Reuses AIPipelineManager's detection logic.
 */
async function findAicpCommand(): Promise<{ cmd: string; baseArgs: string[] }> {
  const manager = new AIPipelineManager();
  const status = await manager.getStatus();
  if (!status.available) {
    throw new Error(
      "AICP binary not available. Install aicp or ensure the bundled binary is present."
    );
  }

  return manager.getCommand();
}

/**
 * Build the spawn environment with decrypted API keys.
 */
async function buildAnalyzeEnv(): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  try {
    const keys = await getDecryptedApiKeys();
    if (keys.falApiKey) {
      env.FAL_KEY = keys.falApiKey;
      env.FAL_API_KEY = keys.falApiKey;
    }
    if (keys.geminiApiKey) {
      env.GEMINI_API_KEY = keys.geminiApiKey;
    }
  } catch (error) {
    claudeLog.warn(HANDLER_NAME, "Failed to load API keys:", error);
  }
  return env;
}

/**
 * Run AICP video analysis and return results.
 */
export async function analyzeVideo(
  projectId: string,
  options: AnalyzeOptions
): Promise<AnalyzeResult> {
  const startTime = Date.now();
  const safeProjectId = sanitizeProjectId(projectId);

  try {
    // 1. Resolve video path
    const videoPath = await resolveVideoPath(safeProjectId, options.source);
    claudeLog.info(HANDLER_NAME, `Resolved video: ${videoPath}`);

    // 2. Find aicp binary
    const { cmd, baseArgs } = await findAicpCommand();

    // 3. Prepare output directory
    const outputDir = join(getProjectPath(safeProjectId), "analysis");
    mkdirSync(outputDir, { recursive: true });

    // 4. Build args
    const analysisType = options.analysisType || "timeline";
    const model = options.model || "gemini-2.5-flash";
    const format = options.format || "md";
    const args = [
      ...baseArgs,
      "analyze-video",
      "-i",
      videoPath,
      "-t",
      analysisType,
      "-m",
      model,
      "-o",
      outputDir,
      "-f",
      format === "md" || format === "json" ? format : "both",
    ];

    // 5. Build environment
    const spawnEnv = await buildAnalyzeEnv();
    if (!spawnEnv.FAL_KEY && model !== "gemini-direct") {
      return {
        success: false,
        error:
          "FAL API key not configured. Go to Settings -> API Keys to set it.",
      };
    }

    claudeLog.info(HANDLER_NAME, `Executing: ${cmd} ${args.join(" ")}`);

    // 6. Spawn and collect output
    const result = await spawnAnalysis(cmd, args, spawnEnv);
    const duration = (Date.now() - startTime) / 1000;

    if (!result.success) {
      return { success: false, error: result.error || "Analysis failed", duration };
    }

    // 7. Read output files
    const videoStem = basename(videoPath, extname(videoPath));
    const outputFiles = findOutputFiles(outputDir, videoStem);
    const { markdown, json } = readAnalysisResults(outputFiles);

    return {
      success: true,
      markdown,
      json,
      outputFiles,
      videoPath,
      duration,
      cost: json?.usage
        ? (json.usage as Record<string, number>).cost
        : undefined,
    };
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    const message = error instanceof Error ? error.message : String(error);
    claudeLog.error(HANDLER_NAME, message);
    return { success: false, error: message, duration };
  }
}

/**
 * Spawn the aicp process and wait for completion.
 */
function spawnAnalysis(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        resolve({
          success: false,
          stdout,
          stderr,
          error: `Analysis timed out after ${ANALYSIS_TIMEOUT_MS / 1000}s`,
        });
      }
    }, ANALYSIS_TIMEOUT_MS);

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);

      if (code === 0) {
        resolve({ success: true, stdout, stderr });
      } else {
        const errorLine = stderr
          .split("\n")
          .find((l) => l.includes("❌") || l.includes("Error"));
        resolve({
          success: false,
          stdout,
          stderr,
          error: errorLine || `aicp exited with code ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve({ success: false, stdout, stderr, error: err.message });
    });
  });
}

/**
 * Find analysis output files matching the video stem in the output directory.
 */
function findOutputFiles(outputDir: string, videoStem: string): string[] {
  try {
    const entries = readdirSync(outputDir);
    return entries
      .filter((name) => name.startsWith(videoStem) && !name.startsWith("."))
      .map((name) => join(outputDir, name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Read markdown and JSON results from output files.
 */
function readAnalysisResults(outputFiles: string[]): {
  markdown?: string;
  json?: Record<string, unknown>;
} {
  let markdown: string | undefined;
  let json: Record<string, unknown> | undefined;

  for (const filePath of outputFiles) {
    try {
      if (filePath.endsWith(".md")) {
        markdown = readFileSync(filePath, "utf-8");
      } else if (filePath.endsWith(".json")) {
        const content = readFileSync(filePath, "utf-8");
        json = JSON.parse(content);
      }
    } catch (error) {
      claudeLog.warn(HANDLER_NAME, `Failed to read ${filePath}:`, error);
    }
  }

  return { markdown, json };
}

/**
 * List available analysis models.
 */
export function listAnalyzeModels(): { models: AnalyzeModel[] } {
  return { models: ANALYZE_MODELS };
}

/**
 * Setup IPC handlers for video analysis.
 */
export function setupClaudeAnalyzeIPC(): void {
  ipcMain.handle(
    "claude:analyze:run",
    async (_event, projectId: string, options: AnalyzeOptions) => {
      claudeLog.info(
        HANDLER_NAME,
        `IPC analyze request for project ${projectId}`
      );
      return analyzeVideo(projectId, options);
    }
  );

  ipcMain.handle("claude:analyze:models", async () => {
    return listAnalyzeModels();
  });

  claudeLog.info(HANDLER_NAME, "IPC handlers registered");
}

// CommonJS export for compatibility
module.exports = {
  resolveVideoPath,
  analyzeVideo,
  listAnalyzeModels,
  setupClaudeAnalyzeIPC,
};

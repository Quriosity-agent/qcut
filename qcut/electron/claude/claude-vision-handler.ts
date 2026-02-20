/**
 * Vision Frame Analysis Handler
 *
 * Extracts frames from video and analyzes content using a provider cascade:
 *   1. Claude CLI (`claude -p`) — free, uses existing Claude Code subscription
 *   2. OpenRouter (Kimi 2.5) — uses existing API key
 *   3. Anthropic API — requires separate API key (legacy fallback)
 */

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { platform } from "node:os";
import { app } from "electron";
import { getMediaInfo } from "./claude-media-handler.js";
import { claudeLog } from "./utils/logger.js";
import { sanitizeProjectId } from "./utils/helpers.js";
import { getFFmpegPath } from "../ffmpeg/utils.js";
import { getDecryptedApiKeys } from "../api-key-handler.js";
import { callModelApi } from "../native-pipeline/api-caller.js";
import type {
  FrameAnalysis,
  FrameAnalysisRequest,
  FrameAnalysisResult,
  FrameAnalysisJob,
} from "../types/claude-api";

const HANDLER_NAME = "Vision";
const MAX_FRAMES_PER_REQUEST = 20;
const VISION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes per API call
const MAX_FRAME_JOBS = 20;

const DEFAULT_VISION_PROMPT = `Analyze each video frame. For each frame, provide a JSON object with:
- "objects": array of objects/subjects visible
- "text": array of any text/labels visible (OCR)
- "description": brief natural language description
- "mood": overall mood ("energetic", "calm", "dramatic", "neutral", etc.)
- "composition": composition style ("rule-of-thirds", "centered", "off-center", "symmetrical", etc.)

Return a JSON array with one object per frame, in the same order as the images provided.`;

// ---------------------------------------------------------------------------
// Provider 1: Claude CLI (`claude -p`)
// ---------------------------------------------------------------------------

function findClaudeCli(): string | null {
  try {
    const cmd = platform() === "win32" ? "where" : "which";
    return execFileSync(cmd, ["claude"], { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}

async function analyzeViaClaudeCli(
  framePaths: Array<{ timestamp: number; path: string }>,
  prompt: string
): Promise<FrameAnalysis[]> {
  const claudePath = findClaudeCli();
  if (!claudePath) {
    throw new Error("Claude CLI not found on PATH");
  }

  const frameList = framePaths
    .map((f, i) => `${i + 1}. ${f.path} (timestamp: ${f.timestamp}s)`)
    .join("\n");

  const fullPrompt = `${prompt}\n\nAnalyze these frame images (read each file):\n${frameList}`;

  return new Promise((resolve, reject) => {
    // Strip CLAUDECODE env var to avoid "nested session" rejection
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const proc = spawn(
      claudePath,
      ["-p", "--model", "haiku", "--allowedTools", "Read", fullPrompt],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env }
    );

    let stdout = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        reject(new Error("Claude CLI timed out"));
      }
    }, VISION_TIMEOUT_MS);

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(parseFrameAnalysisResponse(stdout, framePaths));
      } else {
        reject(new Error(`Claude CLI exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Provider 2: OpenRouter (Kimi 2.5 vision)
// ---------------------------------------------------------------------------

async function analyzeViaOpenRouter(
  framePaths: Array<{ timestamp: number; path: string }>,
  prompt: string
): Promise<FrameAnalysis[]> {
  const keys = await getDecryptedApiKeys();
  const apiKey = keys.openRouterApiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OpenRouter API key not configured");
  }

  // Build OpenAI-compatible vision content
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
  ];

  for (const frame of framePaths) {
    if (!existsSync(frame.path)) continue;
    const buffer = await readFile(frame.path);
    const base64 = buffer.toString("base64");
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${base64}` },
    });
  }

  const result = await callModelApi({
    endpoint: "chat/completions",
    payload: {
      model: "moonshotai/kimi-k2.5",
      messages: [{ role: "user", content }],
      max_tokens: 4096,
    },
    provider: "openrouter",
    async: false,
    timeoutMs: VISION_TIMEOUT_MS,
  });

  if (!result.success || !result.data) {
    throw new Error(`OpenRouter vision failed: ${result.error ?? "unknown"}`);
  }

  const data = result.data as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const responseText = data.choices?.[0]?.message?.content ?? "";

  return parseFrameAnalysisResponse(responseText, framePaths);
}

// ---------------------------------------------------------------------------
// Provider 3: Anthropic API (legacy fallback)
// ---------------------------------------------------------------------------

async function analyzeViaAnthropicApi(
  framePaths: Array<{ timestamp: number; path: string }>,
  prompt: string
): Promise<FrameAnalysis[]> {
  const keys = await getDecryptedApiKeys();
  const apiKey = keys.anthropicApiKey;
  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  const content: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
  ];

  for (const frame of framePaths) {
    if (!existsSync(frame.path)) continue;
    const buffer = await readFile(frame.path);
    const base64 = buffer.toString("base64");
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: base64,
      },
    });
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Claude Vision API error: ${response.status} ${errorText.slice(0, 300)}`
    );
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const textBlocks = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join("\n");

  return parseFrameAnalysisResponse(textBlocks, framePaths);
}

// ---------------------------------------------------------------------------
// Cascade orchestrator
// ---------------------------------------------------------------------------

async function analyzeFramesWithVision(
  framePaths: Array<{ timestamp: number; path: string }>,
  customPrompt?: string
): Promise<FrameAnalysis[]> {
  const prompt = customPrompt || DEFAULT_VISION_PROMPT;
  const errors: string[] = [];

  // Provider 1: Claude CLI (free)
  try {
    claudeLog.info(HANDLER_NAME, "Trying Claude CLI provider...");
    return await analyzeViaClaudeCli(framePaths, prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    claudeLog.warn(HANDLER_NAME, `Claude CLI failed: ${msg}`);
    errors.push(`claude-cli: ${msg}`);
  }

  // Provider 2: OpenRouter (uses existing key)
  try {
    claudeLog.info(HANDLER_NAME, "Trying OpenRouter provider...");
    return await analyzeViaOpenRouter(framePaths, prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    claudeLog.warn(HANDLER_NAME, `OpenRouter failed: ${msg}`);
    errors.push(`openrouter: ${msg}`);
  }

  // Provider 3: Anthropic API (requires separate key)
  try {
    claudeLog.info(HANDLER_NAME, "Trying Anthropic API provider...");
    return await analyzeViaAnthropicApi(framePaths, prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`anthropic: ${msg}`);
  }

  throw new Error(
    `All vision providers failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`
  );
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Resolve mediaId to a video file path.
 */
async function resolveVideoForVision(
  projectId: string,
  mediaId: string
): Promise<{ path: string; duration?: number }> {
  const media = await getMediaInfo(projectId, mediaId);
  if (!media) {
    throw new Error(`Media not found: ${mediaId}`);
  }
  if (media.type !== "video" && media.type !== "image") {
    throw new Error(`Media is not a video or image (type: ${media.type})`);
  }
  if (!existsSync(media.path)) {
    throw new Error(`Media file missing on disk: ${media.path}`);
  }
  return { path: media.path, duration: media.duration };
}

/**
 * Extract a frame at a specific timestamp from a video.
 */
function extractFrame(
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<void> {
  const ffmpegPath = getFFmpegPath();

  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpegPath,
      [
        "-ss",
        String(timestamp),
        "-i",
        videoPath,
        "-vframes",
        "1",
        "-q:v",
        "3",
        "-vf",
        "scale=iw*min(1280/iw\\,720/ih):ih*min(1280/iw\\,720/ih)",
        "-y",
        outputPath,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        reject(new Error("Frame extraction timed out"));
      }
    }, 15_000);

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Frame extraction failed (code ${code})`));
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Determine which timestamps to extract frames at.
 */
export function resolveTimestamps(
  request: FrameAnalysisRequest,
  videoDuration?: number
): number[] {
  if (request.timestamps && request.timestamps.length > 0) {
    return request.timestamps.slice(0, MAX_FRAMES_PER_REQUEST);
  }

  if (request.interval && videoDuration && videoDuration > 0) {
    const interval = Math.max(1, request.interval);
    const timestamps: number[] = [];
    for (
      let t = 0;
      t < videoDuration && timestamps.length < MAX_FRAMES_PER_REQUEST;
      t += interval
    ) {
      timestamps.push(Math.round(t * 1000) / 1000);
    }
    return timestamps;
  }

  return [0];
}

/**
 * Parse vision response into FrameAnalysis objects.
 */
export function parseFrameAnalysisResponse(
  responseText: string,
  framePaths: Array<{ timestamp: number; path: string }>
): FrameAnalysis[] {
  try {
    const trimmed = responseText.trim();
    let jsonText = trimmed;

    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch?.[1]) {
      jsonText = codeBlockMatch[1].trim();
    } else {
      const firstBracket = trimmed.indexOf("[");
      const lastBracket = trimmed.lastIndexOf("]");
      if (firstBracket >= 0 && lastBracket > firstBracket) {
        jsonText = trimmed.slice(firstBracket, lastBracket + 1);
      }
    }

    const parsed = JSON.parse(jsonText) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item, index) => ({
      timestamp: framePaths[index]?.timestamp ?? index,
      objects: Array.isArray(item.objects) ? (item.objects as string[]) : [],
      text: Array.isArray(item.text) ? (item.text as string[]) : [],
      description: typeof item.description === "string" ? item.description : "",
      mood: typeof item.mood === "string" ? item.mood : "neutral",
      composition:
        typeof item.composition === "string" ? item.composition : "unknown",
    }));
  } catch {
    claudeLog.warn(HANDLER_NAME, "Failed to parse vision response");
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Main frame analysis function exposed to HTTP server.
 */
export async function analyzeFrames(
  projectId: string,
  request: FrameAnalysisRequest
): Promise<FrameAnalysisResult> {
  const safeProjectId = sanitizeProjectId(projectId);

  claudeLog.info(
    HANDLER_NAME,
    `Frame analysis: project=${safeProjectId}, media=${request.mediaId}`
  );

  // 1. Resolve video
  const { path: videoPath, duration } = await resolveVideoForVision(
    safeProjectId,
    request.mediaId
  );

  // 2. Determine timestamps
  const timestamps = resolveTimestamps(request, duration);
  claudeLog.info(
    HANDLER_NAME,
    `Extracting ${timestamps.length} frames for analysis`
  );

  // 3. Extract frames
  const tempDir = join(app.getPath("temp"), "qcut-vision-frames");
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const framePaths: Array<{ timestamp: number; path: string }> = [];
  for (const ts of timestamps) {
    const framePath = join(tempDir, `frame-${ts.toFixed(3)}.jpg`);
    try {
      await extractFrame(videoPath, ts, framePath);
      if (existsSync(framePath)) {
        framePaths.push({ timestamp: ts, path: framePath });
      }
    } catch (err) {
      claudeLog.warn(HANDLER_NAME, `Failed to extract frame at ${ts}s:`, err);
    }
  }

  if (framePaths.length === 0) {
    throw new Error("No frames could be extracted from the video");
  }

  // 4. Analyze via provider cascade
  const frames = await analyzeFramesWithVision(framePaths, request.prompt);

  return {
    frames,
    totalFramesAnalyzed: frames.length,
  };
}

// ---------------------------------------------------------------------------
// Async job store
// ---------------------------------------------------------------------------

const frameAnalysisJobs = new Map<string, FrameAnalysisJob>();

function pruneOldFrameJobs(): void {
  if (frameAnalysisJobs.size <= MAX_FRAME_JOBS) return;
  const entries = [...frameAnalysisJobs.entries()].sort(
    (a, b) => a[1].createdAt - b[1].createdAt
  );
  const toRemove = entries.slice(0, entries.length - MAX_FRAME_JOBS);
  for (const [id] of toRemove) {
    frameAnalysisJobs.delete(id);
  }
}

async function runFrameAnalysis(
  jobId: string,
  projectId: string,
  request: FrameAnalysisRequest
): Promise<void> {
  const job = frameAnalysisJobs.get(jobId);
  if (!job) return;

  try {
    job.status = "processing";
    job.progress = 10;
    job.message = "Starting frame analysis...";

    const result = await analyzeFrames(projectId, request);

    // Check for external cancellation
    const current = frameAnalysisJobs.get(jobId);
    if (!current || current.status === "cancelled") return;

    job.status = "completed";
    job.progress = 100;
    job.message = `Analyzed ${result.totalFramesAnalyzed} frames`;
    job.result = result;
    job.completedAt = Date.now();
  } catch (err) {
    const current = frameAnalysisJobs.get(jobId);
    if (!current || current.status === "cancelled") return;
    job.status = "failed";
    job.message = err instanceof Error ? err.message : "Frame analysis failed";
    job.completedAt = Date.now();
    claudeLog.error(HANDLER_NAME, `Job ${jobId} failed:`, err);
  }
}

/**
 * Start a frame analysis job. Returns immediately with a job ID.
 */
export function startFrameAnalysisJob(
  projectId: string,
  request: FrameAnalysisRequest
): { jobId: string } {
  const jobId = `frames_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const job: FrameAnalysisJob = {
    jobId,
    projectId,
    mediaId: request.mediaId,
    status: "queued",
    progress: 0,
    message: "Queued",
    createdAt: Date.now(),
  };

  frameAnalysisJobs.set(jobId, job);
  pruneOldFrameJobs();

  claudeLog.info(
    HANDLER_NAME,
    `Job ${jobId} created for project ${projectId}, media ${request.mediaId}`
  );

  // Fire-and-forget
  runFrameAnalysis(jobId, projectId, request).catch((err) => {
    claudeLog.error(HANDLER_NAME, `Job ${jobId} unexpected error:`, err);
  });

  return { jobId };
}

/** Get the current status of a frame analysis job. */
export function getFrameAnalysisJobStatus(
  jobId: string
): FrameAnalysisJob | null {
  return frameAnalysisJobs.get(jobId) ?? null;
}

/** List all frame analysis jobs. */
export function listFrameAnalysisJobs(): FrameAnalysisJob[] {
  return [...frameAnalysisJobs.values()];
}

/** Cancel a running frame analysis job. */
export function cancelFrameAnalysisJob(jobId: string): boolean {
  const job = frameAnalysisJobs.get(jobId);
  if (!job) return false;
  if (job.status === "completed" || job.status === "failed") return false;
  job.status = "cancelled";
  job.message = "Cancelled by user";
  job.completedAt = Date.now();
  return true;
}

module.exports = {
  analyzeFrames,
  parseFrameAnalysisResponse,
  resolveTimestamps,
  startFrameAnalysisJob,
  getFrameAnalysisJobStatus,
  listFrameAnalysisJobs,
  cancelFrameAnalysisJob,
};

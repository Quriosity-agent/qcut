/**
 * Claude Scene Detection Handler
 * Detects scene/shot boundaries using FFmpeg scene filter (Tier 1)
 * and optionally enriches with AI analysis (Tier 2).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { getMediaInfo } from "./claude-media-handler.js";
import { claudeLog } from "../utils/logger.js";
import { sanitizeProjectId } from "../utils/helpers.js";
import { getFFmpegPath } from "../../ffmpeg/utils.js";
import { getDecryptedApiKeys } from "../../api-key-handler.js";
import type {
	SceneBoundary,
	SceneDetectionRequest,
	SceneDetectionResult,
} from "../../types/claude-api";

const HANDLER_NAME = "SceneDetect";
const SCENE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Resolve mediaId to a video file path.
 */
async function resolveVideoForScene(
	projectId: string,
	mediaId: string
): Promise<string> {
	const media = await getMediaInfo(projectId, mediaId);
	if (!media) {
		throw new Error(`Media not found: ${mediaId}`);
	}
	if (media.type !== "video") {
		throw new Error(`Media is not a video (type: ${media.type})`);
	}
	if (!existsSync(media.path)) {
		throw new Error(`Media file missing on disk: ${media.path}`);
	}
	return media.path;
}

/**
 * Tier 1: Detect scene boundaries using FFmpeg's built-in scene filter.
 * Parses showinfo output for timestamps where scene score exceeds threshold.
 */
export function detectScenesWithFFmpeg(
	videoPath: string,
	threshold = 0.3
): Promise<SceneBoundary[]> {
	const ffmpegPath = getFFmpegPath();
	const clampedThreshold = Math.max(0.05, Math.min(0.95, threshold));

	return new Promise((resolve, reject) => {
		const proc = spawn(
			ffmpegPath,
			[
				"-i",
				videoPath,
				"-filter:v",
				`select='gt(scene,${clampedThreshold})',showinfo`,
				"-vsync",
				"vfr",
				"-f",
				"null",
				"-",
			],
			{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
		);

		let stderr = "";
		let settled = false;

		const timeout = setTimeout(() => {
			if (!settled) {
				settled = true;
				try {
					proc.kill("SIGTERM");
				} catch {
					/* ignore */
				}
				reject(new Error("Scene detection timed out"));
			}
		}, SCENE_TIMEOUT_MS);

		proc.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);

			// FFmpeg returns 0 on success; scene filter output goes to stderr
			const scenes = parseShowInfoOutput(stderr);

			// Always add the first frame as scene 0
			if (scenes.length === 0 || scenes[0].timestamp > 0.1) {
				scenes.unshift({ timestamp: 0, confidence: 1.0 });
			}

			resolve(scenes);
		});

		proc.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			reject(err);
		});
	});
}

/**
 * Parse FFmpeg showinfo filter output to extract scene timestamps.
 *
 * Lines look like:
 *   [Parsed_showinfo_1 @ ...] n: 42 pts: 84000 pts_time:3.36 ...
 */
export function parseShowInfoOutput(stderr: string): SceneBoundary[] {
	const scenes: SceneBoundary[] = [];
	const lines = stderr.split("\n");

	for (const line of lines) {
		if (!line.includes("showinfo") && !line.includes("pts_time")) continue;

		const ptsTimeMatch = line.match(/pts_time:\s*([0-9.]+)/);
		if (!ptsTimeMatch) continue;

		const timestamp = Number.parseFloat(ptsTimeMatch[1]);
		if (!Number.isFinite(timestamp)) continue;

		scenes.push({
			timestamp: Math.round(timestamp * 1000) / 1000,
			confidence: 0.8, // FFmpeg scene filter doesn't expose exact score
		});
	}

	// Sort by timestamp and deduplicate close timestamps (< 0.5s apart)
	scenes.sort((a, b) => a.timestamp - b.timestamp);
	const deduped: SceneBoundary[] = [];
	for (const scene of scenes) {
		const prev = deduped[deduped.length - 1];
		if (prev && scene.timestamp - prev.timestamp < 0.5) continue;
		deduped.push(scene);
	}

	return deduped;
}

/**
 * Extract a single frame at a given timestamp for AI analysis.
 */
function extractFrameAtTimestamp(
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
				"5",
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
 * Tier 2: Enrich scene boundaries with AI descriptions using Gemini.
 * Extracts frames at each scene boundary and sends to Gemini for classification.
 */
async function enrichWithAI(
	videoPath: string,
	scenes: SceneBoundary[],
	model = "gemini-2.5-flash"
): Promise<SceneBoundary[]> {
	const keys = await getDecryptedApiKeys();
	const apiKey = keys.geminiApiKey;
	if (!apiKey) {
		claudeLog.warn(HANDLER_NAME, "No Gemini API key; skipping AI enrichment");
		return scenes;
	}

	// Load Gemini SDK
	let GoogleGenerativeAI: any;
	try {
		const module = await import("@google/generative-ai");
		GoogleGenerativeAI = module.GoogleGenerativeAI;
	} catch {
		const { join: pathJoin } = await import("node:path");
		const modulePath = pathJoin(
			process.resourcesPath,
			"node_modules/@google/generative-ai/dist/index.js"
		);
		const module = await import(modulePath);
		GoogleGenerativeAI = module.GoogleGenerativeAI;
	}

	const genAI = new GoogleGenerativeAI(apiKey);
	const geminiModel = genAI.getGenerativeModel({
		model,
		generationConfig: { responseMimeType: "application/json" },
	});

	// Extract frames (max 20 for cost control)
	const scenesToAnalyze = scenes.slice(0, 20);
	const tempDir = join(app.getPath("temp"), "qcut-scene-frames");
	if (!existsSync(tempDir)) {
		mkdirSync(tempDir, { recursive: true });
	}

	const { readFile } = await import("node:fs/promises");

	// Process in batches of 5 for parallelism
	const batchSize = 5;
	for (let i = 0; i < scenesToAnalyze.length; i += batchSize) {
		const batch = scenesToAnalyze.slice(i, i + batchSize);
		await Promise.all(
			batch.map(async (scene) => {
				const framePath = join(
					tempDir,
					`scene-${scene.timestamp.toFixed(3)}.jpg`
				);
				try {
					await extractFrameAtTimestamp(videoPath, scene.timestamp, framePath);
					if (!existsSync(framePath)) return;

					const frameBuffer = await readFile(framePath);
					const frameBase64 = frameBuffer.toString("base64");

					const result = await geminiModel.generateContent([
						`Analyze this video frame. Return JSON: {"description": "brief description", "shotType": "wide|medium|close-up|cutaway|unknown", "transitionType": "cut|dissolve|fade|unknown"}`,
						{ inlineData: { mimeType: "image/jpeg", data: frameBase64 } },
					]);

					const text = result.response.text();
					const parsed = JSON.parse(text);
					scene.description = parsed.description || undefined;
					scene.shotType = parsed.shotType || "unknown";
					scene.transitionType = parsed.transitionType || "cut";
				} catch (err) {
					claudeLog.warn(
						HANDLER_NAME,
						`AI analysis failed for scene at ${scene.timestamp}s:`,
						err
					);
				}
			})
		);
	}

	return scenes;
}

/**
 * Main scene detection function exposed to HTTP server.
 */
export async function detectScenes(
	projectId: string,
	request: SceneDetectionRequest
): Promise<SceneDetectionResult> {
	const safeProjectId = sanitizeProjectId(projectId);

	claudeLog.info(
		HANDLER_NAME,
		`Scene detection: project=${safeProjectId}, media=${request.mediaId}`
	);

	// 1. Resolve video path
	const videoPath = await resolveVideoForScene(safeProjectId, request.mediaId);

	// 2. Tier 1: FFmpeg scene detection
	const threshold = request.threshold ?? 0.3;
	let scenes = await detectScenesWithFFmpeg(videoPath, threshold);
	claudeLog.info(
		HANDLER_NAME,
		`FFmpeg detected ${scenes.length} scene boundaries`
	);

	// 3. Tier 2: Optional AI analysis
	if (request.aiAnalysis) {
		scenes = await enrichWithAI(videoPath, scenes, request.model);
	}

	// 4. Compute statistics
	const totalScenes = scenes.length;
	let averageShotDuration = 0;
	if (totalScenes > 1) {
		const totalDuration =
			scenes[totalScenes - 1].timestamp - scenes[0].timestamp;
		averageShotDuration =
			Math.round((totalDuration / (totalScenes - 1)) * 10) / 10;
	}

	return { scenes, totalScenes, averageShotDuration };
}

// CommonJS export for compatibility
module.exports = {
	detectScenes,
	detectScenesWithFFmpeg,
	parseShowInfoOutput,
};

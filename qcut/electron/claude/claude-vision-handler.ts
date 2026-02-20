/**
 * Claude Vision Frame Analysis Handler
 * Extracts frames from video and sends to Claude Vision API for content understanding.
 * Analyzes objects, text, mood, composition per frame.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { getMediaInfo } from "./claude-media-handler.js";
import { claudeLog } from "./utils/logger.js";
import { sanitizeProjectId } from "./utils/helpers.js";
import { getFFmpegPath } from "../ffmpeg/utils.js";
import { getDecryptedApiKeys } from "../api-key-handler.js";
import type {
	FrameAnalysis,
	FrameAnalysisRequest,
	FrameAnalysisResult,
} from "../types/claude-api";

const HANDLER_NAME = "Vision";
const MAX_FRAMES_PER_REQUEST = 20;
const VISION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes per API call

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

	// Default: single frame at 0s
	return [0];
}

const DEFAULT_VISION_PROMPT = `Analyze each video frame. For each frame, provide a JSON object with:
- "objects": array of objects/subjects visible
- "text": array of any text/labels visible (OCR)
- "description": brief natural language description
- "mood": overall mood ("energetic", "calm", "dramatic", "neutral", etc.)
- "composition": composition style ("rule-of-thirds", "centered", "off-center", "symmetrical", etc.)

Return a JSON array with one object per frame, in the same order as the images provided.`;

/**
 * Build the base64 image content array from frame paths.
 */
async function buildImageContent(
	framePaths: Array<{ timestamp: number; path: string }>,
	customPrompt?: string
): Promise<Array<Record<string, unknown>>> {
	const prompt = customPrompt || DEFAULT_VISION_PROMPT;
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

	return content;
}

/**
 * Call Anthropic Vision API directly.
 */
async function callAnthropicVision(
	apiKey: string,
	content: Array<Record<string, unknown>>
): Promise<string> {
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
			`Anthropic Vision API error: ${response.status} ${errorText.slice(0, 300)}`
		);
	}

	const data = (await response.json()) as {
		content?: Array<{ type: string; text?: string }>;
	};

	return (data.content || [])
		.filter((block) => block.type === "text")
		.map((block) => block.text || "")
		.join("\n");
}

/**
 * Call OpenRouter Vision API as fallback.
 */
async function callOpenRouterVision(
	apiKey: string,
	content: Array<Record<string, unknown>>
): Promise<string> {
	// Convert Anthropic content format to OpenAI-compatible format
	const messages = [
		{
			role: "user" as const,
			content: content.map((block) => {
				if (block.type === "text") {
					return { type: "text", text: block.text };
				}
				if (
					block.type === "image" &&
					(block.source as Record<string, unknown>)?.type === "base64"
				) {
					const src = block.source as Record<string, string>;
					return {
						type: "image_url",
						image_url: {
							url: `data:${src.media_type};base64,${src.data}`,
						},
					};
				}
				return block;
			}),
		},
	];

	const response = await fetch(
		"https://openrouter.ai/api/v1/chat/completions",
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: "anthropic/claude-sonnet-4",
				max_tokens: 4096,
				messages,
			}),
			signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
		}
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`OpenRouter Vision API error: ${response.status} ${errorText.slice(0, 300)}`
		);
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};

	return data.choices?.[0]?.message?.content || "";
}

/**
 * Send frames to a vision API for analysis with provider cascade.
 * Tries: Anthropic → OpenRouter → fail with descriptive error.
 */
async function analyzeFramesWithClaude(
	framePaths: Array<{ timestamp: number; path: string }>,
	customPrompt?: string
): Promise<FrameAnalysis[]> {
	const keys = await getDecryptedApiKeys();
	const content = await buildImageContent(framePaths, customPrompt);

	// Provider cascade: try Anthropic first, then OpenRouter
	const errors: string[] = [];

	if (keys.anthropicApiKey) {
		try {
			const text = await callAnthropicVision(keys.anthropicApiKey, content);
			return parseFrameAnalysisResponse(text, framePaths);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Anthropic call failed";
			claudeLog.warn(HANDLER_NAME, `Anthropic provider failed: ${msg}`);
			errors.push(`Anthropic: ${msg}`);
		}
	} else {
		errors.push("Anthropic: API key not configured");
	}

	if (keys.openRouterApiKey) {
		try {
			claudeLog.info(HANDLER_NAME, "Falling back to OpenRouter for vision...");
			const text = await callOpenRouterVision(keys.openRouterApiKey, content);
			return parseFrameAnalysisResponse(text, framePaths);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "OpenRouter call failed";
			claudeLog.warn(HANDLER_NAME, `OpenRouter provider failed: ${msg}`);
			errors.push(`OpenRouter: ${msg}`);
		}
	} else {
		errors.push("OpenRouter: API key not configured");
	}

	throw new Error(
		`No vision provider available. Configure an Anthropic or OpenRouter API key in Settings → API Keys.\nProvider errors: ${errors.join("; ")}`
	);
}

/**
 * Parse Claude's JSON response into FrameAnalysis objects.
 */
export function parseFrameAnalysisResponse(
	responseText: string,
	framePaths: Array<{ timestamp: number; path: string }>
): FrameAnalysis[] {
	try {
		// Extract JSON array from response
		const trimmed = responseText.trim();
		let jsonText = trimmed;

		// Handle code blocks
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
		claudeLog.warn(HANDLER_NAME, "Failed to parse Vision API response");
		return [];
	}
}

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

	// 4. Send to Claude Vision
	const frames = await analyzeFramesWithClaude(framePaths, request.prompt);

	return {
		frames,
		totalFramesAnalyzed: frames.length,
	};
}

// CommonJS export for compatibility
module.exports = {
	analyzeFrames,
	parseFrameAnalysisResponse,
	resolveTimestamps,
};

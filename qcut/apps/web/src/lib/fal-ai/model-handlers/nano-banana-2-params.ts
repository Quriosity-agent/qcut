/**
 * Nano Banana 2 Model Parameter Conversion
 *
 * Handles parameter conversion for the Nano Banana 2 edit model.
 * Supports resolution control, safety tolerance, and web search enhancement.
 */

import { debugLogger } from "@/lib/debug/debug-logger";
import { normalizeOutputFormat } from "@/lib/ai-video/validation/validators";

const LOG_COMPONENT = "NanoBanana2Params";

const VALID_RESOLUTIONS = new Set(["0.5K", "1K", "2K", "4K"]);
const VALID_ASPECT_RATIOS = new Set([
	"auto",
	"21:9",
	"16:9",
	"3:2",
	"4:3",
	"5:4",
	"1:1",
	"4:5",
	"3:4",
	"2:3",
	"9:16",
]);

/**
 * Converts and sanitizes Nano Banana 2 API parameters with proper validation.
 * Enforces count limits, resolution options, and normalizes format specifications.
 *
 * @param params - Raw parameters from the user
 * @returns Sanitized parameters for Nano Banana 2 API
 */
export function convertNanoBanana2Parameters(
	params: Record<string, unknown>
): Record<string, unknown> {
	// Sanitize and validate image URLs - limit to max 10 URLs
	const urls = (params.image_urls ??
		(params.imageUrl ? [params.imageUrl] : [])) as string[];
	const imageUrls = Array.isArray(urls) ? urls.slice(0, 10) : [];

	if (Array.isArray(urls) && urls.length > 10) {
		debugLogger.warn(LOG_COMPONENT, "IMAGE_URLS_TRUNCATED", {
			originalCount: urls.length,
			maxAllowed: 10,
		});
	}

	// Clamp num_images to valid range (1-4), rounding to integer
	const rawNumImages = Number(params.num_images ?? params.numImages ?? 1);
	const requestedNumImages = Number.isNaN(rawNumImages)
		? 1
		: Math.round(rawNumImages);
	const numImages = Math.max(1, Math.min(4, requestedNumImages));

	if (numImages !== requestedNumImages) {
		debugLogger.warn(LOG_COMPONENT, "NUM_IMAGES_CLAMPED", {
			requested: requestedNumImages,
			clamped: numImages,
		});
	}

	// Normalize output format
	const requestedFormat =
		(params.output_format as string | undefined) ??
		(params.outputFormat as string | undefined) ??
		"png";
	const outputFormat = normalizeOutputFormat(requestedFormat, "png");

	// Validate resolution
	const rawResolution = (params.resolution as string | undefined) ?? "1K";
	const resolution = VALID_RESOLUTIONS.has(rawResolution)
		? rawResolution
		: "1K";

	if (rawResolution !== resolution) {
		debugLogger.warn(LOG_COMPONENT, "RESOLUTION_INVALID", {
			requested: rawResolution,
			fallback: resolution,
			valid: [...VALID_RESOLUTIONS],
		});
	}

	// Validate aspect ratio
	const rawAspectRatio =
		(params.aspect_ratio as string | undefined) ??
		(params.aspectRatio as string | undefined) ??
		"auto";
	const aspectRatio = VALID_ASPECT_RATIOS.has(rawAspectRatio)
		? rawAspectRatio
		: "auto";

	if (rawAspectRatio !== aspectRatio) {
		debugLogger.warn(LOG_COMPONENT, "ASPECT_RATIO_INVALID", {
			requested: rawAspectRatio,
			fallback: aspectRatio,
		});
	}

	// Validate safety_tolerance (1-6)
	const rawSafety = Number(
		params.safety_tolerance ?? params.safetyTolerance ?? 4
	);
	const safetyTolerance = Number.isNaN(rawSafety)
		? 4
		: Math.max(1, Math.min(6, Math.round(rawSafety)));

	// Boolean parameters — use strict equality to avoid "false" string coercing to true
	const syncMode = (params.sync_mode ?? params.syncMode ?? true) === true;
	const enableWebSearch =
		(params.enable_web_search ?? params.enableWebSearch ?? false) === true;
	const limitGenerations =
		(params.limit_generations ?? params.limitGenerations ?? true) === true;

	// Sanitize prompt
	const prompt = (params.prompt || "") as string;

	// Optional seed
	const result: Record<string, unknown> = {
		image_urls: imageUrls,
		prompt,
		num_images: numImages,
		output_format: outputFormat,
		resolution,
		aspect_ratio: aspectRatio,
		safety_tolerance: safetyTolerance,
		sync_mode: syncMode,
		enable_web_search: enableWebSearch,
		limit_generations: limitGenerations,
	};

	if (params.seed !== undefined) {
		const seed = Number(params.seed);
		if (!Number.isNaN(seed)) {
			result.seed = seed;
		}
	}

	return result;
}

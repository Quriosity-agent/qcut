/**
 * Nano Banana Model Parameter Conversion
 *
 * Handles parameter conversion for Nano Banana edit models.
 * Enforces count limits and normalizes format specifications.
 */

import { debugLogger } from "@/lib/debug-logger";
import { normalizeOutputFormat } from "@/lib/ai-video/validation/validators";

const LOG_COMPONENT = "NanoBananaParams";

/**
 * Converts and sanitizes Nano Banana API parameters with proper validation.
 * Enforces count limits and normalizes format specifications.
 *
 * @param params - Raw parameters from the user
 * @returns Sanitized parameters for Nano Banana API
 *
 * @example
 * convertNanoBananaParameters({
 *   prompt: "Edit this image",
 *   image_urls: ["https://..."],
 *   output_format: "png"
 * })
 */
export function convertNanoBananaParameters(
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

	// Clamp num_images to valid range (1-4)
	const rawNumImages = Number(params.num_images ?? params.numImages ?? 1);
	const requestedNumImages = Number.isNaN(rawNumImages) ? 1 : rawNumImages;
	const numImages = Math.max(1, Math.min(4, requestedNumImages));

	if (numImages !== requestedNumImages) {
		debugLogger.warn(LOG_COMPONENT, "NUM_IMAGES_CLAMPED", {
			requested: requestedNumImages,
			clamped: numImages,
			min: 1,
			max: 4,
		});
	}

	const requestedFormat =
		(params.output_format as string | undefined) ??
		(params.outputFormat as string | undefined) ??
		"png";
	const outputFormat = normalizeOutputFormat(requestedFormat, "png");

	// Ensure sync_mode is boolean
	const syncMode = Boolean(params.sync_mode ?? params.syncMode ?? false);

	// Sanitize prompt
	const prompt = (params.prompt || "") as string;

	return {
		image_urls: imageUrls,
		prompt,
		num_images: numImages,
		output_format: outputFormat,
		sync_mode: syncMode,
	};
}

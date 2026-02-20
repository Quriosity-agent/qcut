/**
 * V4 Model Parameter Conversion
 *
 * Handles parameter conversion for SeedDream v4 and similar models.
 * Enforces documented limits to prevent invalid requests.
 */

import { debugLogger } from "@/lib/debug-logger";

const LOG_COMPONENT = "V4Params";

/**
 * Clamps a numeric value to a specified range.
 */
function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * Valid image size presets for V4 models.
 */
export const V4_VALID_IMAGE_PRESETS = [
	"square_hd",
	"square",
	"portrait_3_4",
	"portrait_9_16",
	"landscape_4_3",
	"landscape_16_9",
] as const;

/**
 * Converts and sanitizes V4 API parameters with proper validation.
 * Enforces documented limits to prevent invalid requests.
 *
 * @param params - Raw parameters from the user
 * @returns Sanitized parameters for V4 API
 *
 * @example
 * convertV4Parameters({
 *   prompt: "A beautiful sunset",
 *   image_urls: ["https://..."],
 *   image_size: "square_hd"
 * })
 */
export function convertV4Parameters(
	params: Record<string, unknown>
): Record<string, unknown> {
	// Sanitize image URLs - limit to max 10 URLs
	let imageUrls = (params.image_urls ||
		(params.imageUrl ? [params.imageUrl] : [])) as string[];
	if (Array.isArray(imageUrls) && imageUrls.length > 10) {
		debugLogger.warn(LOG_COMPONENT, "IMAGE_URLS_TRUNCATED", {
			originalCount: imageUrls.length,
			maxAllowed: 10,
		});
		imageUrls = imageUrls.slice(0, 10);
	}

	// Sanitize prompt - truncate to 5000 characters max
	let prompt = (params.prompt || "") as string;
	if (prompt.length > 5000) {
		debugLogger.warn(LOG_COMPONENT, "PROMPT_TRUNCATED", {
			originalLength: prompt.length,
			maxLength: 5000,
		});
		prompt = prompt.substring(0, 5000);
	}

	// Validate image_size - must be valid preset or numeric value between 256-4096
	let imageSize = params.image_size || params.imageSize || "square_hd";
	if (typeof imageSize === "number") {
		imageSize = clamp(imageSize, 256, 4096);
	} else if (
		typeof imageSize === "string" &&
		!V4_VALID_IMAGE_PRESETS.includes(
			imageSize as (typeof V4_VALID_IMAGE_PRESETS)[number]
		)
	) {
		debugLogger.warn(LOG_COMPONENT, "IMAGE_SIZE_INVALID", {
			requestedSize: imageSize,
			fallback: "square_hd",
		});
		imageSize = "square_hd";
	}

	// Clamp num_images to valid range (1-4)
	const numImages = clamp(
		Number(params.num_images || params.numImages || 1),
		1,
		4
	);

	// Clamp max_images to valid range (1-4)
	const maxImages = clamp(
		Number(params.max_images || params.maxImages || 1),
		1,
		4
	);

	return {
		image_urls: imageUrls,
		prompt,
		image_size: imageSize,
		max_images: maxImages,
		num_images: numImages,
		sync_mode: params.sync_mode || params.syncMode || false,
		enable_safety_checker:
			params.enable_safety_checker === true ||
			params.enableSafetyChecker === true,
		seed: params.seed,
	};
}

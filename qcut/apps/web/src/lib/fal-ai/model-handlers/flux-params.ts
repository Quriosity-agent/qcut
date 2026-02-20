/**
 * FLUX Model Parameter Conversion
 *
 * Handles parameter conversion for FLUX Pro Kontext and similar models.
 * Ensures consistency with other model parameter converters.
 */

import { debugLogger } from "@/lib/debug-logger";

const LOG_COMPONENT = "FluxParams";

/**
 * Converts and sanitizes FLUX API parameters with proper validation.
 * Ensures consistency with other model parameter converters.
 *
 * @param params - Raw parameters from the user
 * @returns Sanitized parameters for FLUX API
 *
 * @example
 * convertFluxParameters({
 *   prompt: "A beautiful portrait",
 *   image_urls: ["https://..."],
 *   guidance_scale: 3.5
 * })
 */
export function convertFluxParameters(
	params: Record<string, unknown>
): Record<string, unknown> {
	// Sanitize and validate image URLs - consistent with V4 and Nano Banana
	const urls = (params.image_urls ??
		(params.imageUrl ? [params.imageUrl] : [])) as string[];
	const imageUrls = Array.isArray(urls) ? urls.slice(0, 10) : [];

	if (Array.isArray(urls) && urls.length > 10) {
		debugLogger.warn(LOG_COMPONENT, "IMAGE_URLS_TRUNCATED", {
			originalCount: urls.length,
			maxAllowed: 10,
		});
	}

	// Clamp num_images to valid range (1-4) - consistent with other models
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

	// Clamp guidance_scale to reasonable range
	const rawGuidance = Number(
		params.guidance_scale ?? params.guidanceScale ?? 3.5
	);
	const guidanceScale = Math.max(
		1,
		Math.min(20, Number.isNaN(rawGuidance) ? 3.5 : rawGuidance)
	);

	// Clamp inference steps to reasonable range
	const rawSteps = Number(params.num_inference_steps ?? params.steps ?? 28);
	const inferenceSteps = Math.max(
		1,
		Math.min(100, Number.isNaN(rawSteps) ? 28 : rawSteps)
	);

	// Clamp safety tolerance to valid range
	const rawSafety = Number(
		params.safety_tolerance ?? params.safetyTolerance ?? 2
	);
	const safetyTolerance = Math.max(
		1,
		Math.min(6, Number.isNaN(rawSafety) ? 2 : rawSafety)
	);

	return {
		prompt: (params.prompt || "") as string,
		image_urls: imageUrls, // Use array format for consistency
		guidance_scale: guidanceScale,
		num_inference_steps: inferenceSteps,
		seed: params.seed,
		safety_tolerance: safetyTolerance,
		num_images: numImages,
	};
}

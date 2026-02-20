/**
 * V3 Model Parameter Conversion
 *
 * Handles parameter conversion for SeedEdit v3 and similar models.
 */

/**
 * Converts and normalizes parameters for V3 API models.
 * Maintains backward compatibility with existing parameter naming.
 *
 * @param params - Raw parameters from the user (snake_case or camelCase)
 * @returns Normalized parameters for V3 API
 */
export function convertV3Parameters(
	params: Record<string, unknown>
): Record<string, unknown> {
	return {
		prompt: (params.prompt as string | undefined) ?? "",
		image_url: params.image_url ?? params.imageUrl,
		guidance_scale: params.guidance_scale ?? params.guidanceScale ?? 1.0,
		num_inference_steps: params.num_inference_steps ?? params.steps ?? 20,
		seed: params.seed,
		safety_tolerance: params.safety_tolerance ?? params.safetyTolerance ?? 2,
		num_images: params.num_images ?? params.numImages ?? 1,
	};
}

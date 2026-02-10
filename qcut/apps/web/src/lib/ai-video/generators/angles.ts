/**
 * Cinematic Angles Generator
 *
 * Generates 9 camera-angle variations of a source image using
 * Seeddream 4.5 edit endpoint with angle-specific prompt suffixes.
 *
 * Images are generated in batches of ANGLE_BATCH_SIZE to respect
 * FAL.ai rate limits while maximising parallelism.
 */

import { handleAIServiceError } from "@/lib/error-handler";
import {
  CINEMATIC_ANGLES,
  ANGLE_BATCH_SIZE,
  ANGLES_MODEL,
  type CinematicAngleId,
} from "@/components/editor/media-panel/views/ai/constants/angles-config";
import { getFalApiKeyAsync, FAL_API_BASE } from "../core/fal-request";
import { uploadImageToFal } from "../core/fal-upload";

export interface AngleGenerationRequest {
  sourceImage: File;
  prompt: string;
}

export type AngleProgressCallback = (
  angleId: CinematicAngleId,
  status: "generating" | "complete" | "error",
  url?: string
) => void;

/**
 * Generate 9 cinematic camera angles from a single source image.
 *
 * @param request - Source image and optional descriptive prompt
 * @param onProgress - Per-angle progress callback
 * @returns Map of angle ID to generated image URL
 */
export async function generateCinematicAngles(
  request: AngleGenerationRequest,
  onProgress?: AngleProgressCallback
): Promise<Partial<Record<CinematicAngleId, string>>> {
  const apiKey = await getFalApiKeyAsync();
  if (!apiKey) {
    throw new Error(
      "FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
    );
  }

  // Upload source image to FAL storage
  const sourceImageUrl = await uploadImageToFal(request.sourceImage, apiKey);

  const results: Partial<Record<CinematicAngleId, string>> = {};
  const endpoint =
    ANGLES_MODEL.endpoints.image_edit ??
    "fal-ai/bytedance/seedream/v4.5/edit";

  // Process angles in batches
  for (let i = 0; i < CINEMATIC_ANGLES.length; i += ANGLE_BATCH_SIZE) {
    const batch = CINEMATIC_ANGLES.slice(i, i + ANGLE_BATCH_SIZE);

    const batchPromises = batch.map(async (angle) => {
      onProgress?.(angle.id, "generating");

      try {
        const fullPrompt = request.prompt
          ? `${request.prompt}, ${angle.prompt_suffix}, consistent style and subject`
          : `${angle.prompt_suffix}, high quality, detailed`;

        const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Key ${apiKey}`,
          },
          body: JSON.stringify({
            prompt: fullPrompt,
            image_urls: [sourceImageUrl],
            image_size: "square_hd",
            num_images: 1,
            max_images: 1,
            sync_mode: true,
            enable_safety_checker: true,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Angle generation failed for ${angle.label}: ${response.status} - ${errorText}`
          );
        }

        const data = await response.json();
        const imageUrl = data.images?.[0]?.url;

        if (imageUrl) {
          results[angle.id] = imageUrl;
          onProgress?.(angle.id, "complete", imageUrl);
        } else {
          throw new Error(`No image returned for ${angle.label}`);
        }
      } catch (err) {
        onProgress?.(angle.id, "error");
        handleAIServiceError(err, `Generate angle: ${angle.label}`, {
          operation: "generateCinematicAngles",
          angleId: angle.id,
        });
      }
    });

    await Promise.allSettled(batchPromises);
  }

  return results;
}

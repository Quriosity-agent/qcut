/**
 * Sora 2 Model Utilities
 *
 * Handles Sora 2 specific parameter conversion and response parsing.
 */

import type {
  Sora2ModelType,
  Sora2Payload,
} from "@/components/editor/media-panel/views/ai/types/ai-types";
import type {
  Sora2TextToVideoInput,
  Sora2TextToVideoProInput,
  Sora2ImageToVideoInput,
  Sora2ImageToVideoProInput,
  Sora2VideoToVideoRemixInput,
  Sora2Duration,
} from "@/types/sora2";

/**
 * Sora 2 input parameters union type
 */
export type Sora2InputParams =
  | Sora2TextToVideoInput
  | Sora2TextToVideoProInput
  | Sora2ImageToVideoInput
  | Sora2ImageToVideoProInput
  | Sora2VideoToVideoRemixInput;

/**
 * Sora 2 response parsed result
 */
export interface Sora2ParsedResponse {
  videoUrl: string;
  videoId: string;
  duration: Sora2Duration;
  resolution: string;
  aspectRatio: string;
}

/**
 * Checks if a model is a Sora 2 model
 *
 * WHY: Sora 2 models require different parameter handling and response parsing
 *
 * @param modelId - Model identifier to check
 * @returns true if model is a Sora 2 model
 */
export function isSora2Model(modelId: string): boolean {
  return modelId.startsWith("sora2_");
}

/**
 * Gets the specific Sora 2 model type
 *
 * WHY: Different Sora 2 variants support different parameters (resolution, input types)
 *
 * @param modelId - Sora 2 model identifier
 * @returns Specific model type or null if not a Sora 2 model
 */
export function getSora2ModelType(modelId: string): Sora2ModelType | null {
  switch (modelId) {
    case "sora2_text_to_video":
      return "text-to-video";
    case "sora2_text_to_video_pro":
      return "text-to-video-pro";
    case "sora2_image_to_video":
      return "image-to-video";
    case "sora2_image_to_video_pro":
      return "image-to-video-pro";
    case "sora2_video_to_video_remix":
      return "video-to-video-remix";
    default:
      return null;
  }
}

/**
 * Converts parameters for Sora 2 models
 *
 * WHY: Sora 2 API expects specific parameter formats that differ from other models
 * Business logic:
 *  - Standard models: 720p only
 *  - Pro models: 720p or 1080p
 *  - Image-to-video: Requires image_url parameter (validated at runtime)
 *  - Video-to-video: Requires video_id from previous Sora generation (validated at runtime)
 *
 * @param params - Typed parameters from UI (union of all Sora 2 input types)
 * @param modelType - Specific Sora 2 model variant
 * @returns Formatted parameters for FAL API with type discriminator
 * @throws Error if required parameters are missing for the model type
 */
export function convertSora2Parameters(
  params: Sora2InputParams,
  modelType: Sora2ModelType
): Sora2Payload {
  const base = {
    prompt: params.prompt || "",
    duration: "duration" in params ? params.duration || 4 : 4, // 4, 8, or 12
    aspect_ratio:
      "aspect_ratio" in params ? params.aspect_ratio || "16:9" : "16:9",
  };

  // Text-to-video standard - 720p only
  if (modelType === "text-to-video") {
    return {
      type: "text-to-video",
      ...base,
      resolution: "720p" as const,
    };
  }

  // Text-to-video Pro - supports 1080p
  if (modelType === "text-to-video-pro") {
    const resolution =
      "resolution" in params ? params.resolution || "1080p" : "1080p";
    return {
      type: "text-to-video-pro",
      ...base,
      resolution, // Default 1080p, can be 720p or 1080p
    };
  }

  // Image-to-video standard - auto or 720p
  if (modelType === "image-to-video") {
    if (!("image_url" in params) || !params.image_url) {
      throw new Error("Sora 2 image-to-video requires image_url parameter");
    }
    const resolution = params.resolution || "auto";
    return {
      type: "image-to-video",
      ...base,
      image_url: params.image_url,
      resolution,
    };
  }

  // Image-to-video Pro - supports 1080p
  if (modelType === "image-to-video-pro") {
    if (!("image_url" in params) || !params.image_url) {
      throw new Error("Sora 2 image-to-video-pro requires image_url parameter");
    }
    const resolution = params.resolution || "auto";
    return {
      type: "image-to-video-pro",
      ...base,
      image_url: params.image_url,
      resolution, // Can be auto, 720p, or 1080p
    };
  }

  // Video-to-Video Remix - transforms existing Sora videos
  if (modelType === "video-to-video-remix") {
    if (!("video_id" in params) || !params.video_id) {
      throw new Error(
        "Sora 2 video-to-video remix requires video_id from a previous Sora generation"
      );
    }
    return {
      type: "video-to-video-remix",
      prompt: params.prompt || "",
      video_id: params.video_id, // REQUIRED: from previous Sora generation
      // Note: No duration/aspect_ratio - preserved from source video
    };
  }

  // TypeScript exhaustiveness check - should never reach here
  const _exhaustive: never = modelType;
  throw new Error(`Unknown Sora 2 model type: ${_exhaustive}`);
}

/**
 * Parses Sora 2 API response format
 *
 * WHY: Sora 2 always returns video as an object with url and content_type properties
 * API Response format (confirmed from FAL API docs):
 *  - All models return: { video: { url: "https://...", content_type: "video/mp4", duration?, width?, height? }, video_id: "..." }
 *
 * @param response - Raw FAL API response
 * @param requestedDuration - Duration requested in the API call (required since API doesn't always return it)
 * @param requestedResolution - Resolution requested in the API call
 * @param requestedAspectRatio - Aspect ratio requested in the API call
 * @returns Parsed video result with all metadata
 * @throws Error if response format is invalid
 */
export function parseSora2Response(
  response: unknown,
  requestedDuration: Sora2Duration,
  requestedResolution = "auto",
  requestedAspectRatio = "16:9"
): Sora2ParsedResponse {
  const data = response as Record<string, unknown>;

  // Sora 2 always returns video as object with url property
  const video = data.video as Record<string, unknown> | undefined;
  if (video?.url) {
    // Extract resolution from API response if available, otherwise use requested value
    let resolution = requestedResolution;
    if (video.width && video.height) {
      // Convert dimensions to resolution string (e.g., "1920x1080" -> "1080p")
      const height = video.height as number;
      if (height >= 1080) {
        resolution = "1080p";
      } else if (height >= 720) {
        resolution = "720p";
      } else {
        resolution = `${height}p`;
      }
    }

    return {
      videoUrl: video.url as string,
      videoId: data.video_id as string,
      // Use API-provided duration if available, otherwise fall back to requested
      duration: ((video.duration as Sora2Duration) || requestedDuration),
      resolution,
      aspectRatio: requestedAspectRatio,
    };
  }

  throw new Error("Invalid Sora 2 response format: missing video.url property");
}

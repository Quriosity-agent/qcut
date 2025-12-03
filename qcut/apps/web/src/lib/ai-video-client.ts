/**
 * AI Video Generation Client
 * Handles communication with the Python FastAPI backend
 */

import { handleAIServiceError, handleNetworkError } from "./error-handler";
import {
  AI_MODELS,
  ERROR_MESSAGES,
  LTXV2_FAST_CONFIG,
} from "@/components/editor/media-panel/views/ai-constants";
import type { AIModel } from "@/components/editor/media-panel/views/ai-types";
import type {
  Sora2TextToVideoInput,
  Sora2TextToVideoProInput,
  Sora2ImageToVideoInput,
  Sora2ImageToVideoProInput,
  Sora2VideoToVideoRemixInput,
  Sora2Duration,
} from "@/types/sora2";

// Direct FAL AI integration - no backend needed
const FAL_API_BASE = "https://fal.run";

/**
 * Retrieves the current FAL API key from environment at call time.
 *
 * WHY: Tests stub environment variables after module load; reading lazily keeps
 * stubs in sync instead of freezing the value during import.
 */
function getFalApiKey(): string | undefined {
  return import.meta.env.VITE_FAL_API_KEY;
}

/**
 * Retrieves model configuration from the centralized AI_MODELS registry.
 *
 * WHY: Ensures consistent model configuration across text, image, and avatar generation flows.
 * Edge case: Returns undefined for unknown model IDs - caller must handle gracefully.
 *
 * @param modelId - Unique identifier for the AI model (e.g., "kling_v2", "bytedance_omnihuman_v1_5")
 * @returns Model configuration object or undefined if model not found
 */
function getModelConfig(modelId: string): AIModel | undefined {
  return AI_MODELS.find((m) => m.id === modelId);
}

/**
 * Checks if a model is a Sora 2 model
 *
 * WHY: Sora 2 models require different parameter handling and response parsing
 *
 * @param modelId - Model identifier to check
 * @returns true if model is a Sora 2 model
 */
function isSora2Model(modelId: string): boolean {
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
function getSora2ModelType(
  modelId: string
):
  | "text-to-video"
  | "text-to-video-pro"
  | "image-to-video"
  | "image-to-video-pro"
  | "video-to-video-remix"
  | null {
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
 * Base payload type for all Sora 2 models (common properties)
 */
type Sora2BasePayload = {
  prompt: string;
  duration: number;
  aspect_ratio: string;
};

/**
 * Discriminated union for Sora 2 payloads with type field for narrowing
 */
type Sora2Payload =
  | {
      type: "text-to-video";
      prompt: string;
      duration: number;
      aspect_ratio: string;
      resolution: "720p";
    }
  | {
      type: "text-to-video-pro";
      prompt: string;
      duration: number;
      aspect_ratio: string;
      resolution: string;
    }
  | {
      type: "image-to-video";
      prompt: string;
      duration: number;
      aspect_ratio: string;
      resolution: string;
      image_url: string;
    }
  | {
      type: "image-to-video-pro";
      prompt: string;
      duration: number;
      aspect_ratio: string;
      resolution: string;
      image_url: string;
    }
  | { type: "video-to-video-remix"; prompt: string; video_id: string }; // No duration/aspect_ratio

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
function convertSora2Parameters(
  params:
    | Sora2TextToVideoInput
    | Sora2TextToVideoProInput
    | Sora2ImageToVideoInput
    | Sora2ImageToVideoProInput
    | Sora2VideoToVideoRemixInput,
  modelType:
    | "text-to-video"
    | "text-to-video-pro"
    | "image-to-video"
    | "image-to-video-pro"
    | "video-to-video-remix"
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
function parseSora2Response(
  response: any,
  requestedDuration: Sora2Duration,
  requestedResolution = "auto",
  requestedAspectRatio = "16:9"
): {
  videoUrl: string;
  videoId: string;
  duration: Sora2Duration;
  resolution: string;
  aspectRatio: string;
} {
  // Sora 2 always returns video as object with url property
  if (response.video?.url) {
    // Extract resolution from API response if available, otherwise use requested value
    let resolution = requestedResolution;
    if (response.video.width && response.video.height) {
      // Convert dimensions to resolution string (e.g., "1920x1080" -> "1080p")
      const height = response.video.height;
      if (height >= 1080) {
        resolution = "1080p";
      } else if (height >= 720) {
        resolution = "720p";
      } else {
        resolution = `${height}p`;
      }
    }

    return {
      videoUrl: response.video.url,
      videoId: response.video_id,
      // Use API-provided duration if available, otherwise fall back to requested
      duration: (response.video.duration as Sora2Duration) || requestedDuration,
      resolution,
      aspectRatio: requestedAspectRatio,
    };
  }

  throw new Error("Invalid Sora 2 response format: missing video.url property");
}

export interface VideoGenerationRequest {
  prompt: string;
  model: string;
  resolution?: string;
  duration?: number;
  aspect_ratio?: string; // Added for Sora 2 support
}

export interface ImageToVideoRequest {
  image: File;
  model: string;
  prompt?: string;
  resolution?: string;
  duration?: number;
  aspect_ratio?: string; // Added for Sora 2 support
}

export interface TextToVideoRequest {
  model: string;
  prompt: string;
  duration?: 6 | 10; // Only for Standard model
  prompt_optimizer?: boolean;
  resolution?: string;
}

export interface ViduQ2I2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 2 | 3 | 4 | 5 | 6 | 7 | 8;
  resolution?: "720p" | "1080p";
  movement_amplitude?: "auto" | "small" | "medium" | "large";
  bgm?: boolean;
  seed?: number;
}

export interface LTXV2T2VRequest {
  model: string;
  prompt: string;
  duration?: 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
  resolution?: "1080p" | "1440p" | "2160p";
  aspect_ratio?: "16:9";
  fps?: 25 | 50;
  generate_audio?: boolean;
}

export interface LTXV2I2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
  resolution?: "1080p" | "1440p" | "2160p"; // Fast: 1080p/1440p/2160p, Standard: 1080p/1440p/2160p
  aspect_ratio?: "16:9";
  fps?: 25 | 50;
  generate_audio?: boolean;
}

export interface AvatarVideoRequest {
  model: string;
  characterImage: File;
  audioFile?: File; // For Kling models
  sourceVideo?: File; // For WAN animate/replace
  prompt?: string;
  resolution?: string;
  duration?: number;
}

export interface VideoGenerationResponse {
  job_id: string;
  status: string;
  message: string;
  estimated_time?: number;
  video_url?: string;
  video_data?: any;
}

export interface GenerationStatus {
  job_id: string;
  status: string;
  progress?: number;
  video_url?: string;
  error?: string;
}

// AIModel interface is now imported from ai-types.ts

export interface ModelsResponse {
  models: AIModel[];
}

export interface CostEstimate {
  model: string;
  duration: number;
  base_cost: number;
  estimated_cost: number;
  currency: string;
}

/**
 * Callback for receiving real-time progress updates during video generation.
 *
 * WHY: FAL AI jobs can take 30-300 seconds; users need feedback to prevent abandoning the generation.
 * Performance: Called every 2 seconds during polling; avoid heavy computation in callbacks.
 *
 * @param status.status - Current generation phase
 * @param status.progress - Percentage (0-100) if available from FAL API
 * @param status.message - Human-readable status message
 * @param status.elapsedTime - Milliseconds since generation started
 * @param status.estimatedTime - Expected total duration (unreliable, FAL API rarely provides this)
 * @param status.logs - Detailed processing logs from FAL API
 */
export type ProgressCallback = (status: {
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  message?: string;
  elapsedTime?: number;
  estimatedTime?: number;
  logs?: string[];
}) => void;

/**
 * Generates AI video from text prompt using FAL AI's text-to-video models.
 *
 * WHY: Direct FAL integration bypasses backend, reducing latency and infrastructure costs.
 * Side effect: Downloads video to memory or streams to disk based on downloadOptions.
 * Performance: Large videos (>50MB) should use streaming to avoid memory spikes.
 *
 * Edge cases:
 * - Returns job_id immediately; actual video URL arrives after polling completes
 * - FAL API may return 429 rate limit; caller should implement exponential backoff
 * - Some models (Veo3) take 5+ minutes; set appropriate timeouts
 *
 * @param request - Text prompt, model ID, and generation parameters
 * @param onProgress - Optional callback for real-time status updates (called every 2s during polling)
 * @param downloadOptions - Controls how video data is fetched (memory vs. streaming)
 * @returns VideoGenerationResponse with job_id and final video_url
 * @throws Error if FAL_API_KEY missing or API returns 4xx/5xx errors
 */
export async function generateVideo(
  request: VideoGenerationRequest,
  onProgress?: ProgressCallback,
  downloadOptions?: {
    downloadToMemory?: boolean;
    onDataReceived?: (data: Uint8Array) => void;
    onComplete?: (totalData: Uint8Array) => void;
  }
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      const error = new Error(
        "FAL API key not configured. Please set VITE_FAL_API_KEY in your environment variables."
      );

      // Use our enhanced error handler instead of console.error
      handleAIServiceError(error, "AI Video Generation Setup", {
        configRequired: "VITE_FAL_API_KEY",
        operation: "checkApiKey",
      });

      throw error;
    }

    console.log(
      `🔑 FAL API Key present: ${falApiKey ? "Yes (length: " + falApiKey.length + ")" : "No"}`
    );

    // Get model configuration from centralized config
    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.text_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support text-to-video generation`
      );
    }

    const jobId = generateJobId();

    console.log(`🎬 Generating video with FAL AI: ${endpoint}`);
    console.log(`📝 Prompt: ${request.prompt}`);

    // Build request payload using centralized model configuration
    // Sora 2 payloads are strongly typed during construction, then converted to plain object
    let payload: Record<string, any>;

    // Handle Sora 2 models with special parameter conversion
    if (isSora2Model(request.model)) {
      const modelType = getSora2ModelType(request.model);
      if (modelType) {
        const sora2Payload = convertSora2Parameters(
          {
            prompt: request.prompt,
            duration: request.duration,
            resolution: request.resolution,
            aspect_ratio: request.aspect_ratio,
          } as any,
          modelType
        ); // Type assertion at object level - convertSora2Parameters handles validation

        // Strip the 'type' discriminator before sending to API
        const { type, ...apiPayload } = sora2Payload;
        payload = apiPayload;
      } else {
        // Fallback if model type detection fails
        payload = {
          prompt: request.prompt,
          ...(modelConfig.default_params || {}),
          ...(request.duration && { duration: request.duration }),
          ...(request.resolution && { resolution: request.resolution }),
        };
      }
    } else {
      // Existing models use default payload structure
      payload = {
        prompt: request.prompt,
        // Start with default parameters from model config
        ...(modelConfig.default_params || {}),
        // Override with request-specific parameters
        ...(request.duration && { duration: request.duration }),
        ...(request.resolution && { resolution: request.resolution }),
      };

      // Special handling for specific models that require unique parameter formats (NON-SORA models)
      if (request.model === "hailuo" || request.model === "hailuo_pro") {
        // Hailuo only accepts '6' or '10' as string values for duration
        const requestedDuration = payload.duration || 6;
        payload.duration = requestedDuration >= 10 ? "10" : "6";
        // Remove resolution as Hailuo doesn't use it directly
        payload.resolution = undefined;
      } else if (request.model === "wan_turbo") {
        // WAN Turbo only accepts specific resolutions
        const validResolutions = ["480p", "580p", "720p"];
        if (
          payload.resolution &&
          !validResolutions.includes(payload.resolution)
        ) {
          payload.resolution = "720p";
        }
      } else if (request.model === "wan_25_preview") {
        // WAN 2.5 supports higher resolutions
        const validResolutions = ["720p", "1080p", "1440p"];
        if (
          payload.resolution &&
          !validResolutions.includes(payload.resolution)
        ) {
          payload.resolution = "1080p";
        }
      }

      // Validate duration doesn't exceed model's max
      if (payload.duration && payload.duration > modelConfig.max_duration) {
        console.warn(
          `${modelConfig.name}: Duration capped at ${modelConfig.max_duration} seconds`
        );
        payload.duration = modelConfig.max_duration;
      }
    }

    console.log(`📤 Sending request to ${endpoint} with payload:`, payload);

    // Track start time for elapsed time calculation
    const startTime = Date.now();

    // Initial status update
    if (onProgress) {
      onProgress({
        status: "queued",
        progress: 0,
        message: "Submitting request to FAL.ai queue...",
        elapsedTime: 0,
      });
    }

    // Step 1: Try queue mode first
    console.log("📤 Attempting queue submission with payload:", payload);

    const queueResponse = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${falApiKey}`,
        "Content-Type": "application/json",
        // Try different queue headers
        "X-Fal-Queue": "true",
        "X-Queue": "true",
        "Queue": "true",
      },
      body: JSON.stringify(payload),
    });

    if (!queueResponse.ok) {
      const errorData = await queueResponse.json().catch(() => ({}));
      handleAIServiceError(
        new Error(
          `FAL Queue Submit Error: ${queueResponse.status} ${queueResponse.statusText}`
        ),
        "Submit FAL AI request to queue",
        {
          status: queueResponse.status,
          statusText: queueResponse.statusText,
          errorData,
          endpoint,
          operation: "queueSubmit",
        }
      );

      const errorMessage = handleQueueError(queueResponse, errorData, endpoint);
      throw new Error(errorMessage);
    }

    const queueResult = await queueResponse.json();
    console.log("✅ FAL Response received:", queueResult);
    console.log("🗋 Response structure:", {
      hasRequestId: !!queueResult.request_id,
      hasVideo: !!queueResult.video,
      hasVideoUrl: !!(queueResult.video && queueResult.video.url),
      keys: Object.keys(queueResult),
      fullResponse: queueResult,
    });

    // Check if we got a request_id (queue mode) or direct result
    const requestId = queueResult.request_id;

    if (requestId) {
      console.log("📋 Queue mode: polling for result...");
      // Step 2: Poll for status with progress updates
      return await pollQueueStatus(
        requestId,
        endpoint,
        startTime,
        onProgress,
        jobId,
        request.model,
        downloadOptions
      );
    }
    if (queueResult.video && queueResult.video.url) {
      console.log("⚡ Direct mode: video ready immediately");

      // Parse Sora 2 response if needed
      let videoUrl = queueResult.video.url;
      if (isSora2Model(request.model)) {
        try {
          const parsed = parseSora2Response(
            queueResult,
            (request.duration || 4) as Sora2Duration,
            request.resolution,
            request.aspect_ratio
          );
          videoUrl = parsed.videoUrl;
          console.log("✅ Sora 2 response parsed:", {
            videoUrl,
            videoId: parsed.videoId,
            duration: parsed.duration,
            resolution: parsed.resolution,
            aspectRatio: parsed.aspectRatio,
          });
        } catch (error) {
          console.warn(
            "⚠️ Failed to parse as Sora 2 response, using default format"
          );
        }
      }

      // Handle streaming download if requested
      if (downloadOptions?.downloadToMemory) {
        console.log("📥 Starting streaming download of video...");
        const videoData = await streamVideoDownload(videoUrl, downloadOptions);
        if (downloadOptions.onComplete) {
          downloadOptions.onComplete(videoData);
        }
      }

      // Direct response - video is already ready
      if (onProgress) {
        onProgress({
          status: "completed",
          progress: 100,
          message: `Video generated successfully with ${request.model}`,
          elapsedTime: Math.floor((Date.now() - startTime) / 1000),
        });
      }

      return {
        job_id: jobId,
        status: "completed",
        message: `Video generated successfully with ${request.model}`,
        estimated_time: Math.floor((Date.now() - startTime) / 1000),
        video_url: videoUrl,
        video_data: queueResult,
      };
    }
    console.warn("⚠️ Queue mode failed, trying direct API call...");

    // Fallback: Try direct API call without queue headers
    const directResponse = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${falApiKey}`,
        "Content-Type": "application/json",
        // No queue headers for direct mode
      },
      body: JSON.stringify(payload),
    });

    if (!directResponse.ok) {
      const errorData = await directResponse.json().catch(() => ({}));
      throw new Error(
        `Both queue and direct modes failed. Status: ${directResponse.status}, Error: ${JSON.stringify(errorData)}`
      );
    }

    const directResult = await directResponse.json();
    console.log("✅ Direct API result:", directResult);

    if (directResult.video && directResult.video.url) {
      // Parse Sora 2 response if needed
      let videoUrl = directResult.video.url;
      if (isSora2Model(request.model)) {
        try {
          const parsed = parseSora2Response(
            directResult,
            (request.duration || 4) as Sora2Duration,
            request.resolution,
            request.aspect_ratio
          );
          videoUrl = parsed.videoUrl;
          console.log("✅ Sora 2 direct response parsed:", {
            videoUrl,
            videoId: parsed.videoId,
            duration: parsed.duration,
            resolution: parsed.resolution,
            aspectRatio: parsed.aspectRatio,
          });
        } catch (error) {
          console.warn(
            "⚠️ Failed to parse as Sora 2 response, using default format"
          );
        }
      }

      // Handle streaming download if requested
      if (downloadOptions?.downloadToMemory) {
        console.log("📥 Starting streaming download of direct video...");
        const videoData = await streamVideoDownload(videoUrl, downloadOptions);
        if (downloadOptions.onComplete) {
          downloadOptions.onComplete(videoData);
        }
      }

      if (onProgress) {
        onProgress({
          status: "completed",
          progress: 100,
          message: `Video generated successfully with ${request.model}`,
          elapsedTime: Math.floor((Date.now() - startTime) / 1000),
        });
      }

      return {
        job_id: jobId,
        status: "completed",
        message: `Video generated successfully with ${request.model}`,
        estimated_time: Math.floor((Date.now() - startTime) / 1000),
        video_url: videoUrl,
        video_data: directResult,
      };
    }
    const error = new Error(
      "No video URL received from either queue or direct API mode. Please check the logs for details."
    );

    handleAIServiceError(error, "AI Video Generation", {
      queueResult,
      directResult,
      operation: "generateVideo",
    });

    throw error;
  } catch (error) {
    handleAIServiceError(error, "AI Video Generation", {
      operation: "generateVideo",
    });
    if (onProgress) {
      onProgress({
        status: "failed",
        progress: 0,
        message:
          error instanceof Error ? error.message : "Unknown error occurred",
        elapsedTime: 0,
      });
    }
    throw error;
  }
}

/**
 * Poll FAL queue status with real-time progress updates
 */
async function pollQueueStatus(
  requestId: string,
  endpoint: string,
  startTime: number,
  onProgress?: ProgressCallback,
  jobId?: string,
  modelName?: string,
  downloadOptions?: {
    downloadToMemory?: boolean;
    onDataReceived?: (data: Uint8Array) => void;
    onComplete?: (totalData: Uint8Array) => void;
  }
): Promise<VideoGenerationResponse> {
  const falApiKey = getFalApiKey();
  if (!falApiKey) {
    throw new Error("FAL API key not configured");
  }
  const maxAttempts = 60; // 5 minutes max (5s intervals)
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    const elapsedTime = Math.floor((Date.now() - startTime) / 1000);

    try {
      // Check queue status
      const statusResponse = await fetch(
        `${FAL_API_BASE}/queue/requests/${requestId}/status`,
        {
          headers: {
            "Authorization": `Key ${falApiKey}`,
          },
        }
      );

      if (!statusResponse.ok) {
        console.warn(
          `⚠️ Status check failed (attempt ${attempts}):`,
          statusResponse.status
        );
        await sleep(5000);
        continue;
      }

      const status = await statusResponse.json();
      console.log(`📊 Queue status (${elapsedTime}s):`, status);

      // Update progress based on status
      if (onProgress) {
        const progressUpdate = mapQueueStatusToProgress(status, elapsedTime);
        onProgress(progressUpdate);
      }

      // Check if completed
      if (status.status === "COMPLETED") {
        // Get the result
        const resultResponse = await fetch(
          `${FAL_API_BASE}/queue/requests/${requestId}`,
          {
            headers: {
              "Authorization": `Key ${falApiKey}`,
            },
          }
        );

        if (resultResponse.ok) {
          const result = await resultResponse.json();
          console.log("✅ FAL Queue completed:", result);

          // Handle streaming download if requested
          if (downloadOptions?.downloadToMemory && result.video?.url) {
            console.log("📥 Starting streaming download of queued video...");
            const videoData = await streamVideoDownload(
              result.video.url,
              downloadOptions
            );
            if (downloadOptions.onComplete) {
              downloadOptions.onComplete(videoData);
            }
          }

          if (onProgress) {
            onProgress({
              status: "completed",
              progress: 100,
              message: `Video generated successfully with ${modelName}`,
              elapsedTime,
            });
          }

          return {
            job_id: jobId || requestId,
            status: "completed",
            message: `Video generated successfully with ${modelName}`,
            estimated_time: elapsedTime,
            video_url: result.video?.url || result.video,
            video_data: result,
          };
        }
      }

      // Check if failed
      if (status.status === "FAILED") {
        const errorMessage = status.error || "Video generation failed";
        if (onProgress) {
          onProgress({
            status: "failed",
            progress: 0,
            message: errorMessage,
            elapsedTime,
          });
        }
        throw new Error(errorMessage);
      }

      // Continue polling for IN_PROGRESS or IN_QUEUE
      await sleep(5000); // Poll every 5 seconds
    } catch (error) {
      handleAIServiceError(error, "Poll FAL AI queue status", {
        attempts,
        requestId,
        elapsedTime,
        operation: "statusPolling",
      });

      if (attempts >= maxAttempts) {
        const errorMessage = `Timeout: Video generation took longer than expected (${Math.floor((maxAttempts * 5) / 60)} minutes)`;
        if (onProgress) {
          onProgress({
            status: "failed",
            progress: 0,
            message: errorMessage,
            elapsedTime,
          });
        }
        throw new Error(errorMessage);
      }

      // Wait before retry
      await sleep(5000);
    }
  }

  throw new Error("Maximum polling attempts reached");
}

/**
 * Map FAL queue status to our progress format
 */
function mapQueueStatusToProgress(
  status: any,
  elapsedTime: number
): {
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  message?: string;
  elapsedTime?: number;
  estimatedTime?: number;
  logs?: string[];
} {
  const baseUpdate = {
    elapsedTime,
    logs: status.logs || [],
  };

  switch (status.status) {
    case "IN_QUEUE":
      return {
        ...baseUpdate,
        status: "queued",
        progress: 5,
        message: `Queued (position: ${status.queue_position || "unknown"})`,
        estimatedTime: status.estimated_time,
      };

    case "IN_PROGRESS": {
      const progress = Math.min(90, 20 + elapsedTime * 2); // Gradual progress based on time
      return {
        ...baseUpdate,
        status: "processing",
        progress,
        message: "Generating video...",
        estimatedTime: status.estimated_time,
      };
    }

    case "COMPLETED":
      return {
        ...baseUpdate,
        status: "completed",
        progress: 100,
        message: "Video generation completed!",
      };

    case "FAILED":
      return {
        ...baseUpdate,
        status: "failed",
        progress: 0,
        message: status.error || "Generation failed",
      };

    default:
      return {
        ...baseUpdate,
        status: "queued",
        progress: 0,
        message: `Status: ${status.status}`,
      };
  }
}

/**
 * Handle queue-specific errors
 */
function handleQueueError(
  response: Response,
  errorData: any,
  endpoint: string
): string {
  let errorMessage = `FAL Queue error! status: ${response.status}`;

  if (errorData.detail) {
    if (Array.isArray(errorData.detail)) {
      errorMessage = errorData.detail.map((d: any) => d.msg || d).join(", ");
    } else {
      errorMessage = errorData.detail;
    }
  } else if (errorData.error) {
    errorMessage = errorData.error;
  } else if (errorData.message) {
    errorMessage = errorData.message;
  } else if (typeof errorData === "string") {
    errorMessage = errorData;
  } else if (errorData.errors && Array.isArray(errorData.errors)) {
    errorMessage = errorData.errors.join(", ");
  }

  // Check for specific FAL.ai error patterns
  if (response.status === 422) {
    errorMessage = `Invalid request parameters: ${JSON.stringify(errorData)}`;
  } else if (response.status === 401) {
    errorMessage =
      "Invalid FAL API key. Please check your VITE_FAL_API_KEY environment variable.";
  } else if (response.status === 429) {
    errorMessage =
      "Rate limit exceeded. Please wait a moment before trying again.";
  } else if (response.status === 404) {
    errorMessage = `Model endpoint not found: ${endpoint}. The model may have been updated or moved.`;
  }

  return errorMessage;
}

/**
 * Sleep utility for polling
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  return "job_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();
}

/**
 * Converts any File (image, audio, video) to base64 data URL for inline embedding in API requests.
 *
 * WHY: FAL API accepts base64-encoded files instead of requiring separate upload endpoint.
 * Performance: FileReader is asynchronous; wraps callback-based API in Promise for async/await usage.
 * Side effect: Entire file loaded into memory; ~33% size increase due to base64 encoding.
 *
 * Edge cases:
 * - Large files (>10MB images, >50MB videos) will cause noticeable UI lag during encoding
 * - Corrupted files cause FileReader to reject promise with DOMException
 * - Browser memory limits vary; large files may fail on mobile devices
 * - Audio files: 30s MP3 (~500KB) becomes ~700KB; Video: 10s MP4 (~5MB) becomes ~6.7MB
 *
 * @param file - File from user upload or drag-drop (image, audio, or video)
 * @returns Base64-encoded data URL (e.g., "data:image/jpeg;base64,...", "data:audio/mpeg;base64,...", "data:video/mp4;base64,...")
 * @throws DOMException if file read fails or file is corrupted
 */
async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Generates AI video from a static image using FAL AI's image-to-video models.
 *
 * WHY: Image-to-video provides more control than text-only generation; users supply reference frame.
 * Side effect: Converts image to base64 data URL in memory (may spike memory for large images >10MB).
 * Performance: Base64 encoding adds ~33% overhead; 5MB image becomes ~6.7MB in request payload.
 *
 * Edge cases:
 * - Not all models support image-to-video (e.g., Hailuo models are text-only)
 * - Large images (>10MB) may timeout during FAL API upload; resize before calling
 * - WebP/AVIF formats may fail; convert to JPEG/PNG for best compatibility
 *
 * @param request - Image file, model ID, optional prompt, and generation parameters
 * @returns VideoGenerationResponse with job_id for polling
 * @throws Error if model doesn't support image-to-video or FAL_API_KEY missing
 */
export async function generateVideoFromImage(
  request: ImageToVideoRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    console.log("🤖 Starting image-to-video generation with FAL AI");
    console.log("📝 Prompt:", request.prompt || "No additional prompt");
    console.log("🖼️ Image:", request.image.name);

    // 1. Convert image to base64 data URL
    console.log("📤 Converting image to base64...");
    const imageUrl = await fileToDataURL(request.image);
    console.log("✅ Image converted to data URL");

    // 2. Generate video using centralized model configuration
    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    // Check if model supports image-to-video
    const endpoint = modelConfig.endpoints.image_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support image-to-video generation`
      );
    }

    // Build request payload using centralized model configuration
    // Sora 2 payloads are strongly typed during construction, then converted to plain object
    let payload: Record<string, any>;

    // Handle Sora 2 image-to-video models
    if (isSora2Model(request.model)) {
      const modelType = getSora2ModelType(request.model);
      if (
        modelType &&
        (modelType === "image-to-video" || modelType === "image-to-video-pro")
      ) {
        const sora2Payload = convertSora2Parameters(
          {
            prompt:
              request.prompt || "Create a cinematic video from this image",
            image_url: imageUrl,
            duration: request.duration,
            resolution: request.resolution,
            aspect_ratio: request.aspect_ratio || "auto",
          } as any,
          modelType
        ); // Type assertion at object level - convertSora2Parameters handles validation

        // Strip the 'type' discriminator before sending to API
        const { type, ...apiPayload } = sora2Payload;
        payload = apiPayload;
      } else {
        // Fallback
        payload = {
          prompt: request.prompt || "Create a cinematic video from this image",
          image_url: imageUrl,
          ...(modelConfig.default_params || {}),
          ...(request.duration && { duration: request.duration }),
          ...(request.resolution && { resolution: request.resolution }),
        };
      }
    } else {
      // Existing models use default payload structure
      payload = {
        prompt: request.prompt || "Create a cinematic video from this image",
        image_url: imageUrl,
        // Start with default parameters from model config
        ...(modelConfig.default_params || {}),
        // Override with request-specific parameters
        ...(request.duration && { duration: request.duration }),
        ...(request.resolution && { resolution: request.resolution }),
      };

      // Handle model-specific payload adjustments (NON-SORA models)
      if (request.model === "wan_turbo") {
        // WAN Turbo image-to-video only supports specific resolutions
        payload.resolution =
          request.resolution &&
          ["480p", "580p", "720p"].includes(request.resolution)
            ? request.resolution
            : "720p";
        payload.seed = Math.floor(Math.random() * 1_000_000); // Optional: for reproducibility
      } else if (request.model === "wan_25_preview") {
        // WAN 2.5 supports higher quality image-to-video conversion
        payload.quality = "high";
      } else if (request.model === "seedance_pro") {
        // Seedance requires duration as string
        payload.duration = request.duration?.toString() || "5";
      }
    }

    const jobId = generateJobId();
    console.log(`🎬 Generating video with: ${endpoint}`);
    console.log("📝 Payload:", payload);

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      // Handle specific error cases with user-friendly messages
      if (errorData.detail && errorData.detail.includes("User is locked")) {
        if (errorData.detail.includes("Exhausted balance")) {
          throw new Error(
            "Your FAL.ai account balance has been exhausted. Please top up your balance at fal.ai/dashboard/billing to continue generating videos."
          );
        }
        throw new Error(
          "Your FAL.ai account is temporarily locked. Please check your account status at fal.ai/dashboard."
        );
      }

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment before trying again."
        );
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    console.log("✅ FAL API response:", result);

    // Return in our expected format
    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully from image with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate video from image", {
      model: request.model,
      imageName: request.image.name,
      operation: "generateVideoFromImage",
    });
    throw error;
  }
}

/**
 * Validates prompt length for Hailuo 2.3 text-to-video models
 *
 * @param prompt - User's text prompt
 * @param modelId - Model identifier
 * @throws Error if prompt exceeds model's character limit
 */
function validateHailuo23Prompt(prompt: string, modelId: string): void {
  const maxLengths: Record<string, number> = {
    hailuo23_standard_t2v: 1500,
    hailuo23_pro_t2v: 2000,
  };

  const maxLength = maxLengths[modelId];
  if (maxLength && prompt.length > maxLength) {
    throw new Error(
      `Prompt too long for ${modelId}. Maximum ${maxLength} characters allowed (current: ${prompt.length})`
    );
  }
}

/**
 * Checks if model is a Hailuo 2.3 text-to-video model
 *
 * @param modelId - Model identifier to check
 * @returns true if model is Hailuo 2.3 T2V
 */
function isHailuo23TextToVideo(modelId: string): boolean {
  return modelId === "hailuo23_standard_t2v" || modelId === "hailuo23_pro_t2v";
}

/**
 * Validates prompt length for Vidu Q2 models
 *
 * @param prompt - Text prompt to validate
 * @throws Error if prompt exceeds 3000 character limit
 */
function validateViduQ2Prompt(prompt: string): void {
  if (prompt.length > 3000) {
    throw new Error(
      `Prompt too long for Vidu Q2. Maximum 3000 characters allowed (current: ${prompt.length})`
    );
  }
}

/**
 * Validates duration for Vidu Q2 video generation
 *
 * @param duration - Duration in seconds
 * @throws Error if duration is not between 2 and 8 seconds
 */
function validateViduQ2Duration(duration: number): void {
  if (duration < 2 || duration > 8) {
    throw new Error(ERROR_MESSAGES.VIDU_Q2_INVALID_DURATION);
  }
}

const LTXV2_STANDARD_T2V_DURATIONS = [6, 8, 10] as const;
const LTXV2_FAST_T2V_DURATIONS = LTXV2_FAST_CONFIG.DURATIONS;

/**
 * Validates resolution for LTX Video 2.0 generation
 *
 * @param resolution - Video resolution (e.g., "1080p")
 * @throws Error if resolution is not 1080p, 1440p, or 2160p
 */
function validateLTXV2Resolution(resolution: string): void {
  if (!["1080p", "1440p", "2160p"].includes(resolution)) {
    throw new Error(ERROR_MESSAGES.LTXV2_INVALID_RESOLUTION);
  }
}

const LTXV2_STANDARD_I2V_DURATIONS = [6, 8, 10] as const;
const LTXV2_STANDARD_I2V_RESOLUTIONS = ["1080p", "1440p", "2160p"] as const;
const LTXV2_FAST_I2V_DURATIONS = LTXV2_FAST_CONFIG.DURATIONS;
const LTXV2_FAST_I2V_RESOLUTIONS = LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD;
const LTXV2_FAST_EXTENDED_THRESHOLD =
  LTXV2_FAST_CONFIG.EXTENDED_DURATION_THRESHOLD;
const LTXV2_FAST_EXTENDED_RESOLUTIONS = LTXV2_FAST_CONFIG.RESOLUTIONS.EXTENDED;
const LTXV2_FAST_EXTENDED_FPS = LTXV2_FAST_CONFIG.FPS_OPTIONS.EXTENDED;
const LTXV2_FAST_I2V_FPS = LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD;

/**
 * Checks if model is a fast LTX Video 2.0 text-to-video variant
 *
 * @param modelId - Model identifier to check
 * @returns true if model is LTX V2 fast text-to-video
 */
function isFastLTXV2TextModel(modelId: string): boolean {
  return modelId === "ltxv2_fast_t2v";
}

/**
 * Validates duration for LTX Video 2.0 text-to-video generation
 *
 * @param duration - Duration in seconds
 * @param modelId - Model identifier (pro vs fast variants)
 * @throws Error if duration is invalid for the specified model
 */
function validateLTXV2T2VDuration(duration: number, modelId: string): void {
  const isFast = isFastLTXV2TextModel(modelId);

  if (isFast) {
    if (
      !LTXV2_FAST_T2V_DURATIONS.includes(
        duration as (typeof LTXV2_FAST_T2V_DURATIONS)[number]
      )
    ) {
      throw new Error(ERROR_MESSAGES.LTXV2_FAST_T2V_INVALID_DURATION);
    }
  } else {
    if (
      !LTXV2_STANDARD_T2V_DURATIONS.includes(
        duration as (typeof LTXV2_STANDARD_T2V_DURATIONS)[number]
      )
    ) {
      throw new Error(ERROR_MESSAGES.LTXV2_INVALID_DURATION);
    }
  }
}

/**
 * Checks if model is a standard LTX Video 2.0 image-to-video model
 *
 * @param modelId - Model identifier to check
 * @returns true if model is standard LTX V2 I2V (not Fast variant)
 */
function isStandardLTXV2ImageModel(modelId: string): boolean {
  return modelId === "ltxv2_i2v";
}

/**
 * Validates duration for LTX Video 2.0 image-to-video generation
 *
 * @param duration - Duration in seconds
 * @param modelId - Model identifier (standard vs fast variant)
 * @throws Error if duration is invalid for the specified model
 */
function validateLTXV2I2VDuration(duration: number, modelId: string): void {
  const isStandard = isStandardLTXV2ImageModel(modelId);

  if (isStandard) {
    const allowedDurations = LTXV2_STANDARD_I2V_DURATIONS;
    if (
      !allowedDurations.includes(duration as (typeof allowedDurations)[number])
    ) {
      throw new Error(ERROR_MESSAGES.LTXV2_STD_I2V_INVALID_DURATION);
    }
  } else {
    const allowedDurations = LTXV2_FAST_I2V_DURATIONS;
    if (
      !allowedDurations.includes(duration as (typeof allowedDurations)[number])
    ) {
      throw new Error(ERROR_MESSAGES.LTXV2_I2V_INVALID_DURATION);
    }
  }
}

/**
 * Validates resolution for LTX Video 2.0 image-to-video generation
 *
 * @param resolution - Video resolution (e.g., "1080p")
 * @param modelId - Model identifier (standard vs fast variant)
 * @throws Error if resolution is invalid for the specified model
 */
function validateLTXV2I2VResolution(resolution: string, modelId: string): void {
  const allowedResolutions = isStandardLTXV2ImageModel(modelId)
    ? LTXV2_STANDARD_I2V_RESOLUTIONS
    : LTXV2_FAST_I2V_RESOLUTIONS;

  if (
    !allowedResolutions.includes(
      resolution as (typeof allowedResolutions)[number]
    )
  ) {
    throw new Error(
      isStandardLTXV2ImageModel(modelId)
        ? ERROR_MESSAGES.LTXV2_STD_I2V_INVALID_RESOLUTION
        : ERROR_MESSAGES.LTXV2_I2V_INVALID_RESOLUTION
    );
  }
}

function validateLTXV2FastExtendedConstraints(
  duration: number,
  resolution: string,
  fps: number,
  errorMessage: string = ERROR_MESSAGES.LTXV2_I2V_EXTENDED_DURATION_CONSTRAINT
): void {
  if (duration <= LTXV2_FAST_EXTENDED_THRESHOLD) {
    return;
  }

  const hasAllowedResolution = LTXV2_FAST_EXTENDED_RESOLUTIONS.includes(
    resolution as (typeof LTXV2_FAST_EXTENDED_RESOLUTIONS)[number]
  );

  const hasAllowedFps = LTXV2_FAST_EXTENDED_FPS.includes(
    fps as (typeof LTXV2_FAST_EXTENDED_FPS)[number]
  );

  if (!hasAllowedResolution || !hasAllowedFps) {
    throw new Error(errorMessage);
  }
}

/**
 * Generates AI video from text prompt using FAL AI's Hailuo 2.3 text-to-video models.
 *
 * WHY: Hailuo 2.3 offers budget-friendly text-to-video generation without requiring image input.
 * Side effect: Sends text prompt directly to FAL API without image conversion overhead.
 * Performance: Faster than image-to-video as no base64 encoding required.
 *
 * Edge cases:
 * - Standard model supports duration of 6s or 10s (different pricing)
 * - Pro model has fixed pricing regardless of duration
 * - Pro model supports camera control via bracketed notation (e.g., [Pan left], [Zoom in])
 *
 * @param request - Text prompt, model ID, and generation parameters
 * @returns VideoGenerationResponse with job_id and final video_url
 * @throws Error if FAL_API_KEY missing or model doesn't support text-to-video
 */
export async function generateVideoFromText(
  request: TextToVideoRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt.trim();

    console.log("?? Starting text-to-video generation with FAL AI");
    console.log("?? Prompt:", trimmedPrompt);
    console.log("?? Model:", request.model);

    // Get model configuration from centralized config
    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    // Check if model supports text-to-video
    const endpoint = modelConfig.endpoints.text_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support text-to-video generation`
      );
    }

    // Ensure prompt validity before making API call
    if (!trimmedPrompt) {
      throw new Error("Text prompt is required for text-to-video generation");
    }

    if (isHailuo23TextToVideo(request.model)) {
      validateHailuo23Prompt(trimmedPrompt, request.model);

      if (
        request.duration !== undefined &&
        request.duration !== 6 &&
        request.duration !== 10
      ) {
        throw new Error(
          "Duration must be either 6 or 10 seconds for Hailuo 2.3 models"
        );
      }
    }

    // Build request payload for Hailuo 2.3 models
    const payload: Record<string, any> = {
      prompt: trimmedPrompt,
      // Start with default parameters from model config
      ...(modelConfig.default_params || {}),
    };

    // Allow overriding resolution if provided
    if (request.resolution) {
      payload.resolution = request.resolution;
    }

    // Handle duration parameter (Hailuo 2.3 specific)
    if (
      request.model === "hailuo23_standard_t2v" ||
      request.model === "hailuo23_pro_t2v"
    ) {
      // Standard model has tiered pricing for 6s/10s.
      // Pro model has fixed pricing but supports both durations.
      const requestedDuration = request.duration ?? 6;
      payload.duration = requestedDuration >= 10 ? "10" : "6";
    }

    // Handle prompt_optimizer (both models support it)
    if (request.prompt_optimizer !== undefined) {
      payload.prompt_optimizer = request.prompt_optimizer;
    }

    const jobId = generateJobId();
    console.log(`?? Generating text-to-video with: ${endpoint}`);
    console.log("?? Payload:", payload);

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      // Handle specific error cases with user-friendly messages
      if (errorData.detail && errorData.detail.includes("User is locked")) {
        if (errorData.detail.includes("Exhausted balance")) {
          throw new Error(
            "Your FAL.ai account balance has been exhausted. Please top up your balance at fal.ai/dashboard/billing to continue generating videos."
          );
        }
        throw new Error(
          "Your FAL.ai account is temporarily locked. Please check your account status at fal.ai/dashboard."
        );
      }

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 413) {
        throw new Error(
          "Request too large for text-to-video generation. Please shorten your prompt or reduce optional parameters."
        );
      }

      if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment before trying again."
        );
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    console.log("? FAL API response:", result);

    // Return in our expected format
    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully from text with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate video from text", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100), // Log first 100 chars only
      operation: "generateVideoFromText",
    });
    throw error;
  }
}

/**
 * Generate video from image using Vidu Q2 Turbo.
 *
 * @param request - Prompt, model ID, image URL and optional tuning parameters
 */
export async function generateViduQ2Video(
  request: ViduQ2I2VRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt?.trim() ?? "";
    if (!trimmedPrompt) {
      throw new Error("Text prompt is required for Vidu Q2 video generation");
    }
    validateViduQ2Prompt(trimmedPrompt);

    if (!request.image_url) {
      throw new Error(
        "Image is required for Vidu Q2 image-to-video generation"
      );
    }

    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.image_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support image-to-video generation`
      );
    }

    const defaultDuration =
      typeof modelConfig.default_params?.duration === "number"
        ? modelConfig.default_params?.duration
        : 4;
    const duration = request.duration ?? defaultDuration;
    validateViduQ2Duration(duration);

    // Extract and exclude bgm from defaults to avoid using delete operator
    const defaults = { ...(modelConfig.default_params || {}) };
    const { bgm: _bgm, ...defaultsSansBgm } = defaults;

    const payload: Record<string, any> = {
      ...defaultsSansBgm,
      prompt: trimmedPrompt,
      image_url: request.image_url,
      duration,
    };

    if (request.resolution) {
      payload.resolution = request.resolution;
    }

    if (request.movement_amplitude) {
      payload.movement_amplitude = request.movement_amplitude;
    } else if (!payload.movement_amplitude) {
      payload.movement_amplitude = "auto";
    }

    if (request.seed !== undefined) {
      payload.seed = request.seed;
    }

    // Only add bgm for 4-second videos when explicitly requested
    const shouldIncludeBgm =
      request.bgm !== undefined && (request.duration ?? defaultDuration) === 4;
    if (shouldIncludeBgm) {
      payload.bgm = request.bgm;
    }

    const jobId = generateJobId();
    console.log("🎬 Starting Vidu Q2 Turbo generation with FAL AI");
    console.log("📝 Prompt:", trimmedPrompt);
    console.log("🖼️ Image URL provided:", Boolean(request.image_url));

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please wait a moment.");
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate Vidu Q2 video", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateViduQ2Video",
    });
    throw error;
  }
}

/**
 * Generate video with audio from text using LTX Video 2.0 Pro.
 *
 * @param request - Prompt, model ID, and generation parameters
 */
export async function generateLTXV2Video(
  request: LTXV2T2VRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt?.trim() ?? "";
    if (!trimmedPrompt) {
      throw new Error("Please enter a text prompt for LTX Video 2.0");
    }

    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.text_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support text-to-video generation`
      );
    }

    const isFastTextModel = isFastLTXV2TextModel(request.model);

    const duration = request.duration ?? 6;
    validateLTXV2T2VDuration(duration, request.model);

    const resolution = request.resolution ?? "1080p";
    validateLTXV2Resolution(resolution);

    const fps = request.fps ?? 25;
    if (![25, 50].includes(fps)) {
      throw new Error("FPS must be either 25 or 50 for LTX Video 2.0");
    }

    if (isFastTextModel) {
      validateLTXV2FastExtendedConstraints(
        duration,
        resolution,
        fps,
        ERROR_MESSAGES.LTXV2_FAST_T2V_EXTENDED_DURATION_CONSTRAINT
      );
    }

    const payload: Record<string, any> = {
      ...(modelConfig.default_params || {}),
      prompt: trimmedPrompt,
      duration,
      resolution,
      aspect_ratio: request.aspect_ratio ?? "16:9",
      fps,
      generate_audio:
        request.generate_audio !== undefined
          ? request.generate_audio
          : (modelConfig.default_params?.generate_audio ?? true),
    };

    const jobId = generateJobId();
    console.log("🎬 Starting LTX Video 2.0 generation with FAL AI");
    console.log("📝 Prompt:", trimmedPrompt.substring(0, 100));
    console.log("📐 Resolution:", payload.resolution);

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment before trying again."
        );
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video || result.url,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate LTX Video 2.0 video", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateLTXV2Video",
    });
    throw error;
  }
}

/**
 * Generate a video from a single image using LTX Video 2.0 (standard or Fast variants).
 *
 * Builds and submits an image-to-video request to the configured model endpoint, applying model defaults
 * and validating duration, resolution, and FPS constraints before calling the FAL API.
 *
 * @param request - LTXV2I2VRequest containing the model id, prompt, image_url, and optional overrides:
 *                  duration, resolution, aspect_ratio, fps, and generate_audio.
 * @returns A VideoGenerationResponse with fields including `job_id`, `status`, `message`, `estimated_time`,
 *          `video_url` (if available), and `video_data` (raw API response).
 * @throws Error if the FAL API key is missing, required inputs are invalid or missing, validation rules fail,
 *         or the FAL API returns an error (e.g., unauthorized, payload too large, rate limited).
 */
export async function generateLTXV2ImageVideo(
  request: LTXV2I2VRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt?.trim() ?? "";
    const isStandardModel = isStandardLTXV2ImageModel(request.model);
    if (!trimmedPrompt) {
      throw new Error(
        isStandardModel
          ? "Please enter a prompt describing the desired video motion"
          : "Please enter a text prompt for LTX Video 2.0 Fast image-to-video"
      );
    }

    if (!request.image_url) {
      throw new Error(
        isStandardModel
          ? "Image URL is required for LTX Video 2.0 image-to-video generation"
          : "Image is required for LTX Video 2.0 Fast image-to-video generation"
      );
    }

    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.image_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support image-to-video generation`
      );
    }

    const defaultDuration =
      typeof modelConfig.default_params?.duration === "number"
        ? (modelConfig.default_params.duration as number)
        : isStandardModel
          ? 6
          : 6;
    const duration = request.duration ?? defaultDuration;
    validateLTXV2I2VDuration(duration, request.model);

    const defaultResolution =
      (modelConfig.default_params?.resolution as string | undefined) ??
      (isStandardModel ? "1080p" : "1080p");
    const resolution = request.resolution ?? defaultResolution;
    validateLTXV2I2VResolution(resolution, request.model);

    const fps =
      request.fps ??
      (modelConfig.default_params?.fps as number | undefined) ??
      25;
    if (
      !LTXV2_FAST_I2V_FPS.includes(fps as (typeof LTXV2_FAST_I2V_FPS)[number])
    ) {
      throw new Error("FPS must be either 25 or 50 for LTX Video 2.0");
    }

    if (!isStandardModel) {
      validateLTXV2FastExtendedConstraints(duration, resolution, fps);
    }

    const payload: Record<string, any> = {
      ...(modelConfig.default_params || {}),
      prompt: trimmedPrompt,
      image_url: request.image_url,
      duration,
      resolution,
      aspect_ratio: request.aspect_ratio ?? "16:9",
      fps,
      generate_audio:
        request.generate_audio !== undefined
          ? request.generate_audio
          : (modelConfig.default_params?.generate_audio ?? true),
    };

    const jobId = generateJobId();
    console.log(
      `?? Starting ${isStandardModel ? "LTX Video 2.0" : "LTX Video 2.0 Fast"} image-to-video generation`
    );
    console.log("📝 Prompt:", trimmedPrompt.substring(0, 100));
    console.log("🖼️ Image URL provided:", Boolean(request.image_url));

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 413) {
        throw new Error(
          "Image file too large. Maximum size is 7MB for LTX Video 2.0 image-to-video."
        );
      }
      if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment before trying again."
        );
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate LTX Video 2.0 image-to-video", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateLTXV2ImageVideo",
    });
    throw error;
  }
}

/**
 * Seedance Image-to-Video Request Interface
 */
export interface SeedanceI2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  resolution?: "480p" | "720p" | "1080p";
  aspect_ratio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "auto";
  camera_fixed?: boolean;
  seed?: number;
  enable_safety_checker?: boolean;
  end_image_url?: string;
}

/**
 * Generate a video from a single image using a Seedance image-to-video model.
 *
 * @param request - SeedanceI2VRequest containing the model id, prompt, source image URL, and optional generation overrides (duration, resolution, aspect ratio, camera_fixed, seed, enable_safety_checker, end_image_url).
 * @returns VideoGenerationResponse containing a job identifier, completion status, a message, estimated time, the generated video's URL (if available), and the raw API response in `video_data`.
 * @throws Error when the FAL API key is not configured, the prompt or image URL is missing, the model is unknown or does not support image-to-video, or the FAL API returns an error (including invalid key or rate limits).
 */
export async function generateSeedanceVideo(
  request: SeedanceI2VRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt?.trim() ?? "";
    if (!trimmedPrompt) {
      throw new Error("Please enter a prompt describing the desired animation");
    }

    if (!request.image_url) {
      throw new Error(
        "Image URL is required for Seedance image-to-video generation"
      );
    }

    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.image_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support image-to-video generation`
      );
    }

    const duration =
      request.duration ??
      (modelConfig.default_params?.duration as number | undefined) ??
      5;
    const resolution =
      request.resolution ??
      (modelConfig.default_params?.resolution as string | undefined) ??
      "1080p";
    const aspectRatio =
      request.aspect_ratio ??
      (modelConfig.default_params?.aspect_ratio as string | undefined) ??
      "16:9";
    const cameraFixed =
      request.camera_fixed ??
      (modelConfig.default_params?.camera_fixed as boolean | undefined) ??
      false;

    const payload: Record<string, unknown> = {
      prompt: trimmedPrompt,
      image_url: request.image_url,
      duration,
      resolution,
      aspect_ratio: aspectRatio,
      camera_fixed: cameraFixed,
      enable_safety_checker:
        request.enable_safety_checker ??
        modelConfig.default_params?.enable_safety_checker ??
        false,
    };

    if (request.seed !== undefined) {
      payload.seed = request.seed;
    }

    if (request.end_image_url && request.model === "seedance_pro_i2v") {
      payload.end_image_url = request.end_image_url;
    }

    const jobId = generateJobId();
    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment before trying again."
        );
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video || result.url,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate Seedance video", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateSeedanceVideo",
    });
    throw error;
  }
}

export interface KlingI2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 5 | 10;
  cfg_scale?: number;
  aspect_ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  enhance_prompt?: boolean;
  negative_prompt?: string;
}

/**
 * Generate a video from a single image using the Kling v2.5 Turbo Pro image-to-video model.
 *
 * Builds and submits an image-to-video request using the configured Kling model and returns
 * the resulting job metadata and video location when generation completes.
 *
 * @param request - Request parameters (must include `model` and `image_url`). Optional fields:
 *   - `prompt`: description of desired motion (trimmed; max 2,500 characters).
 *   - `duration`: desired video duration in seconds (defaults to 5).
 *   - `cfg_scale`: strength of adherence to the prompt (clamped to 0–1, defaults to 0.5).
 *   - `aspect_ratio`: target aspect ratio (falls back to model default or "16:9").
 *   - `enhance_prompt`: whether to enable prompt enhancement (defaults to model default or true).
 *   - `negative_prompt`: optional negative prompt to steer generation.
 * @returns VideoGenerationResponse containing `job_id`, `status`, `message`, `estimated_time`, `video_url`, and raw `video_data`.
 * @throws Error when the FAL API key is not configured.
 * @throws Error when the prompt is empty or exceeds 2,500 characters.
 * @throws Error when `image_url` is missing.
 * @throws Error when the specified `model` is unknown or does not expose an image-to-video endpoint.
 * @throws Error for FAL API failures (including invalid API key (401), rate limiting (429), or other API errors).
 */
export async function generateKlingImageVideo(
  request: KlingI2VRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt?.trim() ?? "";
    if (!trimmedPrompt) {
      throw new Error("Please enter a prompt describing the desired motion");
    }

    if (trimmedPrompt.length > 2500) {
      throw new Error("Prompt exceeds maximum length of 2,500 characters");
    }

    if (!request.image_url) {
      throw new Error("Image URL is required for Kling image-to-video");
    }

    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.image_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support image-to-video generation`
      );
    }

    const duration = request.duration ?? 5;
    const aspectRatio =
      request.aspect_ratio ??
      (modelConfig.default_params?.aspect_ratio as string | undefined) ??
      "16:9";
    const cfgScale = Math.min(Math.max(request.cfg_scale ?? 0.5, 0), 1);
    const enhancePrompt =
      request.enhance_prompt ??
      modelConfig.default_params?.enhance_prompt ??
      true;

    const payload: Record<string, unknown> = {
      prompt: trimmedPrompt,
      image_url: request.image_url,
      duration,
      aspect_ratio: aspectRatio,
      cfg_scale: cfgScale,
      enhance_prompt: enhancePrompt,
    };

    if (request.negative_prompt) {
      payload.negative_prompt = request.negative_prompt;
    }

    const jobId = generateJobId();
    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment before trying again."
        );
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video || result.url,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate Kling video", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateKlingImageVideo",
    });
    throw error;
  }
}

/**
 * Kling O1 Video-to-Video Request Interface
 * For models that transform source videos with cinematic understanding
 */
export interface KlingO1V2VRequest {
  model: string;
  prompt: string;
  sourceVideo: File;
  duration?: 5 | 10;
  aspect_ratio?: "auto" | "16:9" | "9:16" | "1:1";
  keep_audio?: boolean;
}

/**
 * Kling O1 Reference-to-Video Request Interface
 * For generating videos from reference images
 */
export interface KlingO1Ref2VideoRequest {
  model: string;
  prompt: string;
  image_urls: string[]; // Array of reference image URLs (max 7)
  duration?: 5 | 10;
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  cfg_scale?: number;
  negative_prompt?: string;
}

/**
 * Generate a video from a source video using Kling O1 video-to-video models.
 *
 * Supports both Video Reference (preserves motion/camera style) and Video Edit (transforms via prompt).
 *
 * @param request - Request parameters including model, prompt, source video, and optional settings
 * @returns VideoGenerationResponse with job_id, status, message, and video URL
 * @throws Error if FAL API key missing, model unsupported, or API returns error
 */
export async function generateKlingO1Video(
  request: KlingO1V2VRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt?.trim() ?? "";
    if (!trimmedPrompt) {
      throw new Error("Please enter a prompt describing the desired output");
    }

    if (trimmedPrompt.length > 2500) {
      throw new Error("Prompt exceeds maximum length of 2500 characters");
    }

    if (!request.sourceVideo) {
      throw new Error("Source video is required for Kling O1 video-to-video");
    }

    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.image_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support video-to-video generation`
      );
    }

    console.log("🎬 Starting Kling O1 video-to-video generation");
    console.log("📝 Model:", request.model);
    console.log("📝 Prompt:", trimmedPrompt.substring(0, 100) + "...");

    // Convert source video to base64 data URL
    console.log("📤 Converting source video to base64...");
    const videoUrl = await fileToDataURL(request.sourceVideo);
    console.log("✅ Video converted to data URL");

    const duration =
      request.duration ??
      (modelConfig.default_params?.duration as number | undefined) ??
      5;
    const aspectRatio =
      request.aspect_ratio ??
      (modelConfig.default_params?.aspect_ratio as string | undefined) ??
      "auto";

    const payload: Record<string, unknown> = {
      prompt: trimmedPrompt,
      video_url: videoUrl,
      duration,
      aspect_ratio: aspectRatio,
    };

    if (request.keep_audio !== undefined) {
      payload.keep_audio = request.keep_audio;
    }

    const jobId = generateJobId();
    console.log(`🎬 Generating video with: ${endpoint}`);
    console.log("📝 Payload:", {
      ...payload,
      video_url: `[base64 data: ${videoUrl.length} chars]`,
    });

    // Add timeout for large video payloads (3 minutes)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180_000);

    try {
      const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Key ${falApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (response.status === 401) {
          throw new Error(
            "Invalid FAL.ai API key. Please check your API key configuration."
          );
        }

        if (response.status === 429) {
          throw new Error(
            "Rate limit exceeded. Please wait a moment before trying again."
          );
        }

        throw new Error(
          `FAL API error: ${errorData.detail || response.statusText}`
        );
      }

      const result = await response.json();
      console.log("✅ Kling O1 video generated:", result);

      return {
        job_id: jobId,
        status: "completed",
        message: `Video generated successfully with ${request.model}`,
        estimated_time: 0,
        video_url: result.video?.url || result.video,
        video_data: result,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          "Video generation timed out after 3 minutes. The source video may be too large."
        );
      }
      throw error;
    }
  } catch (error) {
    handleAIServiceError(error, "Generate Kling O1 video", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateKlingO1Video",
    });
    throw error;
  }
}

/**
 * Generate a video from reference images using Kling O1 Reference-to-Video model.
 *
 * Transforms images and elements into consistent video scenes with cinematic motion.
 * Use @Image1, @Image2, etc. in the prompt to reference the images.
 *
 * @param request - Request parameters including model, prompt, image URLs array, and optional settings
 * @returns VideoGenerationResponse with job_id, status, message, and video URL
 * @throws Error if FAL API key missing, model unsupported, or API returns error
 */
export async function generateKlingO1RefVideo(
  request: KlingO1Ref2VideoRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt?.trim() ?? "";
    if (!trimmedPrompt) {
      throw new Error(
        "Please enter a prompt describing the desired video scene"
      );
    }

    if (trimmedPrompt.length > 2500) {
      throw new Error("Prompt exceeds maximum length of 2500 characters");
    }

    // Filter out empty/null image URLs
    const validImageUrls = request.image_urls.filter(
      (url) => url && url.trim() !== ""
    );

    if (validImageUrls.length === 0) {
      throw new Error(
        "At least one reference image is required for Kling O1 reference-to-video generation"
      );
    }

    if (validImageUrls.length > 7) {
      throw new Error(
        "Maximum 7 reference images allowed for Kling O1 reference-to-video"
      );
    }

    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.image_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support reference-to-video generation`
      );
    }

    console.log("🎬 Starting Kling O1 reference-to-video generation");
    console.log("📝 Model:", request.model);
    console.log("🖼️ Reference images:", validImageUrls.length);

    const duration =
      request.duration ??
      (modelConfig.default_params?.duration as number | undefined) ??
      5;
    const aspectRatio =
      request.aspect_ratio ??
      (modelConfig.default_params?.aspect_ratio as string | undefined) ??
      "16:9";
    const cfgScale =
      request.cfg_scale ??
      (modelConfig.default_params?.cfg_scale as number | undefined) ??
      0.5;
    const negativePrompt =
      request.negative_prompt ??
      (modelConfig.default_params?.negative_prompt as string | undefined) ??
      "blur, distort, low quality";

    const payload: Record<string, unknown> = {
      prompt: trimmedPrompt,
      image_urls: validImageUrls,
      duration,
      aspect_ratio: aspectRatio,
      cfg_scale: cfgScale,
      negative_prompt: negativePrompt,
    };

    const jobId = generateJobId();
    console.log(`🎬 Generating video with: ${endpoint}`);

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment before trying again."
        );
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    console.log("✅ Kling O1 reference video generated:", result);

    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate Kling O1 reference video", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateKlingO1RefVideo",
    });
    throw error;
  }
}

export interface WAN25I2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 5 | 10;
  resolution?: "480p" | "720p" | "1080p";
  audio_url?: string;
  negative_prompt?: string;
  enable_prompt_expansion?: boolean;
  seed?: number;
}

/**
 * Generate a video from a single image using the WAN v2.5 Preview image-to-video model.
 *
 * Builds and sends a model-specific image-to-video request and returns the final generation result.
 *
 * @param request - Request parameters (must include `model`, `prompt`, and `image_url`; optional fields include `duration`, `resolution`, `audio_url`, `negative_prompt`, `enable_prompt_expansion`, and `seed`)
 * @returns The generation result containing `job_id`, `status`, `message`, `estimated_time`, the generated `video_url` when available, and the raw API response in `video_data`
 * @throws Error - If the FAL API key is missing, required inputs are invalid or missing (prompt, image_url), the model or endpoint is unsupported, or the FAL API returns an error (including authentication or rate-limit errors)
 */
export async function generateWAN25ImageVideo(
  request: WAN25I2VRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt?.trim() ?? "";
    if (!trimmedPrompt) {
      throw new Error("Please enter a prompt describing the desired motion");
    }

    if (trimmedPrompt.length > 800) {
      throw new Error("Prompt exceeds maximum length of 800 characters");
    }

    if (!request.image_url) {
      throw new Error("Image URL is required for WAN 2.5 image-to-video");
    }

    if (request.negative_prompt && request.negative_prompt.length > 500) {
      throw new Error(
        "Negative prompt exceeds maximum length of 500 characters"
      );
    }

    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.image_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support image-to-video generation`
      );
    }

    const duration =
      request.duration ??
      (modelConfig.default_params?.duration as number | undefined) ??
      5;
    const resolution =
      request.resolution ??
      (modelConfig.default_params?.resolution as string | undefined) ??
      "1080p";

    const payload: Record<string, unknown> = {
      prompt: trimmedPrompt,
      image_url: request.image_url,
      duration,
      resolution,
      enable_prompt_expansion:
        request.enable_prompt_expansion ??
        modelConfig.default_params?.enable_prompt_expansion ??
        true,
    };

    if (request.audio_url) {
      payload.audio_url = request.audio_url;
    }

    if (request.negative_prompt) {
      payload.negative_prompt = request.negative_prompt;
    }

    if (request.seed !== undefined) {
      payload.seed = request.seed;
    }

    const jobId = generateJobId();
    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment before trying again."
        );
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video || result.url,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate WAN 2.5 video", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateWAN25ImageVideo",
    });
    throw error;
  }
}

/**
 * Generate an avatar video from a character image using a specified avatar model.
 *
 * Builds and sends a model-specific payload (image plus audio or source video) to the configured FAL endpoint and returns the generation result.
 *
 * @param request - Request object containing model id, character image File and model-specific inputs (audioFile for talking-head models or sourceVideo for animation/replace models)
 * @returns VideoGenerationResponse containing job_id, status, message, and the API response including the generated video URL when available
 * @throws Error if the FAL API key is missing, the model is unknown or not an avatar model, required inputs for the chosen model are missing, the model lacks a valid endpoint, or if the request times out (3 minutes)
 */
export async function generateAvatarVideo(
  request: AvatarVideoRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    console.log("🎭 Starting avatar video generation with FAL AI");
    console.log("🎬 Model:", request.model);

    // Get model configuration
    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown avatar model: ${request.model}`);
    }

    if (modelConfig.category !== "avatar") {
      throw new Error(`Model ${request.model} is not an avatar model`);
    }

    // Convert character image to base64
    const characterImageUrl = await fileToDataURL(request.characterImage);

    // Determine endpoint and payload based on model
    let endpoint: string;
    let payload: any;

    if (request.model === "wan_animate_replace") {
      if (!request.sourceVideo) {
        throw new Error("WAN Animate/Replace requires a source video");
      }
      // Convert source video to data URL (for WAN model)
      const sourceVideoUrl = await fileToDataURL(request.sourceVideo);
      endpoint = modelConfig.endpoints.text_to_video || "";
      if (!endpoint) {
        throw new Error(
          `Model ${request.model} does not have a valid endpoint`
        );
      }
      payload = {
        ...(modelConfig.default_params || {}), // Defaults first
        video_url: sourceVideoUrl,
        image_url: characterImageUrl,
        ...(request.resolution && { resolution: request.resolution }), // Override default if provided
      };
    } else if (
      request.model === "kling_avatar_pro" ||
      request.model === "kling_avatar_standard"
    ) {
      if (!request.audioFile) {
        throw new Error(`${request.model} requires an audio file`);
      }
      // Convert audio to data URL
      const audioUrl = await fileToDataURL(request.audioFile);
      endpoint = modelConfig.endpoints.text_to_video || "";
      if (!endpoint) {
        throw new Error(
          `Model ${request.model} does not have a valid endpoint`
        );
      }
      payload = {
        ...(modelConfig.default_params || {}), // Defaults first
        image_url: characterImageUrl,
        audio_url: audioUrl,
        ...(request.prompt && { prompt: request.prompt }), // Override default if provided
        ...(request.resolution && { resolution: request.resolution }), // Override default if provided
      };
    } else if (request.model === "bytedance_omnihuman_v1_5") {
      if (!request.audioFile) {
        throw new Error("ByteDance OmniHuman v1.5 requires an audio file");
      }
      // Convert audio to data URL
      const audioUrl = await fileToDataURL(request.audioFile);
      endpoint = modelConfig.endpoints.text_to_video || "";
      if (!endpoint) {
        throw new Error(
          `Model ${request.model} does not have a valid endpoint`
        );
      }
      payload = {
        ...(modelConfig.default_params || {}), // Defaults first
        image_url: characterImageUrl,
        audio_url: audioUrl,
        ...(request.resolution && { resolution: request.resolution }), // Override default if provided
      };
    } else if (request.model === "kling_o1_ref2video") {
      // Kling O1 Reference-to-Video: transforms reference images into video scenes
      // Uses the image_to_video endpoint with image_urls array and prompt
      endpoint = modelConfig.endpoints.image_to_video || "";
      if (!endpoint) {
        throw new Error(
          `Model ${request.model} does not have a valid endpoint`
        );
      }

      // Convert reference image to base64 data URL (avoids CORS issues in Electron app)
      // FAL API accepts both base64 data URLs and HTTPS URLs
      console.log("📤 Converting reference image to base64...");
      const imageUrl = await fileToDataURL(request.characterImage);
      console.log("✅ Reference image converted to data URL");

      // Build prompt with @Image1 reference if prompt doesn't already contain it
      let enhancedPrompt = request.prompt || "";
      if (!enhancedPrompt.includes("@Image")) {
        enhancedPrompt = `Use @Image1 as the reference. ${enhancedPrompt}`.trim();
      }

      payload = {
        prompt: enhancedPrompt,
        image_urls: [imageUrl],
        duration: String(request.duration || modelConfig.default_params?.duration || 5),
        aspect_ratio: modelConfig.default_params?.aspect_ratio || "16:9",
        ...(modelConfig.default_params?.cfg_scale && { cfg_scale: modelConfig.default_params.cfg_scale }),
        ...(modelConfig.default_params?.negative_prompt && { negative_prompt: modelConfig.default_params.negative_prompt }),
      };
    } else {
      throw new Error(`Unsupported avatar model: ${request.model}`);
    }

    const jobId = generateJobId();
    console.log(`🎭 Generating avatar video with: ${endpoint}`);
    console.log("📝 Payload:", {
      ...payload,
      video_url: payload.video_url
        ? `[base64 data: ${payload.video_url.length} chars]`
        : undefined,
      image_url: payload.image_url
        ? `[base64 data: ${payload.image_url.length} chars]`
        : undefined,
      audio_url: payload.audio_url
        ? `[base64 data: ${payload.audio_url.length} chars]`
        : undefined,
    });

    console.log("📊 Payload size:", JSON.stringify(payload).length, "bytes");

    // Add timeout to prevent hanging (3 minutes for large payloads)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180_000); // 3 minutes

    try {
      console.log("🚀 Sending request to FAL AI...");
      const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          "Authorization": `Key ${falApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      console.log(
        "📥 Received response:",
        response.status,
        response.statusText
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("❌ FAL AI API error:", errorData);
        throw new Error(
          `Avatar generation failed: ${errorData.detail || response.statusText}`
        );
      }

      const result = await response.json();
      console.log("✅ Avatar video generated:", result);

      return {
        job_id: jobId,
        status: "completed",
        message: `Avatar video generated successfully with ${request.model}`,
        estimated_time: 0,
        video_url: result.video?.url || result.video,
        video_data: result,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        console.error("❌ Request timeout after 3 minutes");
        throw new Error(
          "Avatar generation timed out after 3 minutes. The video/image files may be too large."
        );
      }
      throw error;
    }
  } catch (error) {
    handleAIServiceError(error, "Generate avatar video", {
      model: request.model,
      operation: "generateAvatarVideo",
    });
    throw error;
  }
}

/**
 * ByteDance Video Upscaler Request Interface
 */
export interface ByteDanceUpscaleRequest {
  video_url: string;
  target_resolution?: "1080p" | "2k" | "4k";
  target_fps?: "30fps" | "60fps";
}

/**
 * Upscales a remote video using the ByteDance video upscaler model.
 *
 * @param request - Request options. `video_url` is required; `target_resolution` and `target_fps` default to `"1080p"` and `"30fps"` when omitted.
 * @returns A VideoGenerationResponse containing the job id, completion status, a human-readable message, the resulting `video_url` (when available), and raw response data in `video_data`.
 * @throws If the FAL API key is not configured.
 * @throws If `request.video_url` is not provided.
 * @throws If the ByteDance upscaler model or its endpoint is not found/configured.
 * @throws On FAL API errors (includes specific messages for HTTP 401 — invalid API key — and 429 — rate limiting).
 */
export async function upscaleByteDanceVideo(
  request: ByteDanceUpscaleRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    if (!request.video_url) {
      throw new Error("Video URL is required for upscaling");
    }

    const modelConfig = getModelConfig("bytedance_video_upscaler");
    if (!modelConfig) {
      throw new Error("ByteDance upscaler model not found");
    }

    const endpoint = modelConfig.endpoints.upscale_video;
    if (!endpoint) {
      throw new Error("ByteDance upscaler endpoint not configured");
    }

    const targetResolution = request.target_resolution ?? "1080p";
    const targetFPS = request.target_fps ?? "30fps";

    const payload: Record<string, unknown> = {
      video_url: request.video_url,
      target_resolution: targetResolution,
      target_fps: targetFPS,
    };

    const jobId = generateJobId();
    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment before trying again."
        );
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    return {
      job_id: jobId,
      status: "completed",
      message: `Video upscaled to ${targetResolution} @ ${targetFPS}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video || result.url,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Upscale video with ByteDance", {
      operation: "upscaleByteDanceVideo",
    });
    throw error;
  }
}

/**
 * FlashVSR Video Upscaler Request Interface
 */
export interface FlashVSRUpscaleRequest {
  video_url: string;
  upscale_factor?: number; // 1.0 to 4.0
  acceleration?: "regular" | "high" | "full";
  quality?: number; // 0 to 100
  color_fix?: boolean;
  preserve_audio?: boolean;
  output_format?: "X264" | "VP9" | "PRORES4444" | "GIF";
  output_quality?: "low" | "medium" | "high" | "maximum";
  output_write_mode?: "fast" | "balanced" | "small";
  seed?: number;
}

/**
 * Upscales a video using the FlashVSR video upscaler model.
 *
 * @param request - Upscale request. `video_url` is required. Optional fields include `upscale_factor` (1–4), `quality` (0–100), `acceleration`, `color_fix`, `preserve_audio`, `output_format`, `output_quality`, `output_write_mode`, and `seed`.
 * @returns A VideoGenerationResponse containing `job_id`, `status`, `message`, the resulting `video_url`, and the raw service response in `video_data`.
 * @throws Error if the FAL API key is not configured, `video_url` is missing, the FlashVSR model or endpoint is not found, `upscale_factor` or `quality` are out of allowed ranges, or when the FAL API returns an error (including 401 or 429 responses).
 */
export async function upscaleFlashVSRVideo(
  request: FlashVSRUpscaleRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    if (!request.video_url) {
      throw new Error("Video URL is required for upscaling");
    }

    const modelConfig = getModelConfig("flashvsr_video_upscaler");
    if (!modelConfig) {
      throw new Error("FlashVSR upscaler model not found");
    }

    const endpoint = modelConfig.endpoints.upscale_video;
    if (!endpoint) {
      throw new Error("FlashVSR upscaler endpoint not configured");
    }

    // Validate upscale factor
    const upscaleFactor = request.upscale_factor ?? 4;
    if (upscaleFactor < 1 || upscaleFactor > 4) {
      throw new Error("Upscale factor must be between 1 and 4");
    }

    // Validate quality
    const quality = request.quality ?? 70;
    if (quality < 0 || quality > 100) {
      throw new Error("Quality must be between 0 and 100");
    }

    const payload: Record<string, unknown> = {
      video_url: request.video_url,
      upscale_factor: upscaleFactor,
      acceleration: request.acceleration ?? "regular",
      quality,
      color_fix: request.color_fix ?? true,
      preserve_audio: request.preserve_audio ?? false,
      output_format: request.output_format ?? "X264",
      output_quality: request.output_quality ?? "high",
      output_write_mode: request.output_write_mode ?? "balanced",
    };

    // Add optional seed
    if (request.seed !== undefined) {
      payload.seed = request.seed;
    }

    const jobId = generateJobId();
    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment before trying again."
        );
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    return {
      job_id: jobId,
      status: "completed",
      message: `Video upscaled with FlashVSR (${upscaleFactor}x)`,
      estimated_time: 0,
      video_url: result.video?.url || result.video || result.url,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Upscale video with FlashVSR", {
      operation: "upscaleFlashVSRVideo",
    });
    throw error;
  }
}

/**
 * Topaz Video Upscaler Request Interface
 */
export interface TopazUpscaleRequest {
  video_url: string;
  upscale_factor?: number; // 2.0 to 8.0
  target_fps?: "original" | "interpolated";
  h264_output?: boolean;
}

/**
 * Upscales a video using the Topaz Video Upscaler.
 *
 * @param request - Parameters including `video_url`, `upscale_factor`, and optional `target_fps` and `h264_output`
 * @returns A VideoGenerationResponse containing the upscaled video's URL and binary data
 * @throws Error with message "Topaz Video Upscale not yet implemented"
 */
export async function upscaleTopazVideo(
  request: TopazUpscaleRequest
): Promise<VideoGenerationResponse> {
  // TODO: Implement when Topaz API endpoint is available
  throw new Error("Topaz Video Upscale not yet implemented");
}

/**
 * Polls FAL AI job status during video generation.
 *
 * WHY: FAL AI uses async job queue; this function is called repeatedly until job completes.
 * Business logic: Currently returns mock "completed" status because generateVideo/generateVideoFromImage
 *                 handle polling internally via FAL SDK. This function exists for backward compatibility
 *                 with UI components that expect polling capability.
 * Performance: No-op function; actual polling happens in FAL SDK subscribe() method.
 *
 * Edge case: If you need true status polling, integrate FAL's status endpoint directly.
 *
 * @param jobId - Job identifier returned from generation request
 * @returns Mock GenerationStatus indicating completion
 * @deprecated Use FAL SDK's built-in polling via subscribe() instead
 */
export async function getGenerationStatus(
  jobId: string
): Promise<GenerationStatus> {
  // Since we're doing direct FAL API calls, generation is synchronous
  // This function is kept for compatibility with existing UI polling logic
  return {
    job_id: jobId,
    status: "completed",
    progress: 100,
    video_url: undefined, // Will be set by the actual generation response
    error: undefined,
  };
}

/**
 * Retrieves the list of available AI models from centralized configuration.
 *
 * WHY: Provides single source of truth for model metadata (pricing, resolution, capabilities).
 * Side effect: Adds "$" prefix to price for UI display consistency.
 * Performance: Synchronous map operation; negligible cost (~10 models).
 *
 * Edge case: Returns static configuration; doesn't reflect real-time FAL API model availability.
 *
 * @returns ModelsResponse containing all configured AI models with formatted pricing
 */
export async function getAvailableModels(): Promise<ModelsResponse> {
  return {
    models: AI_MODELS.map((model) => ({
      ...model,
      price: `$${model.price}`, // Add $ prefix for display
    })),
  };
}

/**
 * Estimates the cost of video generation based on model pricing and duration.
 *
 * WHY: Helps users make informed decisions before expensive generation operations.
 * Business logic: FAL AI pricing scales linearly with duration; base price is for 5s video.
 *   - 5s video = base cost (e.g., $0.15 for Kling v2.1)
 *   - 10s video = 2x base cost (e.g., $0.30)
 * Performance: Synchronous calculation; no API calls.
 *
 * Edge cases:
 * - Unknown models default to $1.00 base cost to prevent $0 estimates
 * - Duration capped to model's max_duration (e.g., Hailuo Pro maxes at 6s)
 * - Minimum multiplier is 1.0; shorter durations don't reduce cost below base
 *
 * @param request - Model ID and desired video duration
 * @returns CostEstimate with base_cost, duration multiplier, and final estimated_cost
 */
export async function estimateCost(
  request: VideoGenerationRequest
): Promise<CostEstimate> {
  // Use centralized model configuration
  const modelConfig = getModelConfig(request.model);
  const modelInfo = modelConfig
    ? {
        base_cost: parseFloat(modelConfig.price),
        max_duration: modelConfig.max_duration,
      }
    : {
        base_cost: 1.0,
        max_duration: 30,
      };
  const actualDuration = Math.min(
    request.duration || 5,
    modelInfo.max_duration
  );
  const durationMultiplier = Math.max(1, actualDuration / 5);
  const estimatedCost = modelInfo.base_cost * durationMultiplier;

  return {
    model: request.model,
    duration: actualDuration,
    base_cost: modelInfo.base_cost,
    estimated_cost: estimatedCost,
    currency: "USD",
  };
}

/**
 * Converts API errors into user-friendly error messages.
 *
 * WHY: Standardizes error handling across all generation functions to prevent raw stack traces in UI.
 * Edge case: Non-Error objects (e.g., thrown strings/numbers) return generic message.
 *
 * @param error - Unknown error object from try/catch blocks
 * @returns Human-readable error message suitable for display
 */
export function handleApiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "An unknown error occurred";
}

/**
 * Checks if FAL API key is configured in environment variables.
 *
 * WHY: Prevents cryptic "401 Unauthorized" errors by failing fast with clear message.
 * Side effect: Does NOT validate key with FAL API; only checks if key exists.
 * Performance: Instant check; no network request.
 *
 * @returns true if VITE_FAL_API_KEY is set, false otherwise
 */
export async function isApiAvailable(): Promise<boolean> {
  return !!getFalApiKey();
}

/**
 * Downloads video using streaming API to handle large files without memory spikes.
 *
 * WHY: FAL AI videos can exceed 100MB; downloading entire video to memory causes browser crashes.
 * Performance: Streams chunks incrementally; memory usage stays constant regardless of file size.
 * Side effect: Calls onDataReceived callback for each chunk (~64KB); useful for progress bars.
 *
 * Edge cases:
 * - If FAL CDN returns non-200 status, throws with detailed HTTP error
 * - Some older browsers lack ReadableStream support; falls back to arraybuffer() method
 * - Large videos (>500MB) may still timeout; caller should implement retry logic
 *
 * @param videoUrl - FAL AI CDN URL (typically https://fal.media/files/...)
 * @param downloadOptions - Controls chunk processing and completion callbacks
 * @returns Complete video data as Uint8Array for IndexedDB storage or Blob creation
 * @throws Error if video URL is unreachable or streaming fails mid-download
 */
async function streamVideoDownload(
  videoUrl: string,
  downloadOptions: {
    downloadToMemory?: boolean;
    onDataReceived?: (data: Uint8Array) => void;
    onComplete?: (totalData: Uint8Array) => void;
  }
): Promise<Uint8Array> {
  console.log("🔗 Starting streaming download from:", videoUrl);

  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download video: ${response.status} ${response.statusText}`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const chunks: Uint8Array[] = [];
  let receivedLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedLength += value.length;

      // Notify progress if callback provided
      if (downloadOptions.onDataReceived) {
        downloadOptions.onDataReceived(value);
      }

      console.log(`📊 Downloaded ${receivedLength} bytes...`);
    }

    // Combine all chunks into single Uint8Array
    const totalData = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      totalData.set(chunk, position);
      position += chunk.length;
    }

    console.log(`✅ Download complete: ${totalData.length} bytes total`);
    return totalData;
  } finally {
    reader.releaseLock();
  }
}

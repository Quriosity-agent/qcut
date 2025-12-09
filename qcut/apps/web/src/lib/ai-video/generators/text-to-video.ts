/**
 * Text-to-Video Generators
 *
 * Functions for generating videos from text prompts.
 * Includes support for multiple AI models with different capabilities.
 */

import { handleAIServiceError } from "@/lib/error-handler";
import type {
  VideoGenerationRequest,
  VideoGenerationResponse,
  TextToVideoRequest,
  LTXV2T2VRequest,
  ProgressCallback,
} from "@/components/editor/media-panel/views/ai/types/ai-types";
import type { Sora2Duration } from "@/types/sora2";
import {
  getFalApiKey,
  generateJobId,
  makeFalRequest,
  handleFalResponse,
} from "../core/fal-request";
import { pollQueueStatus, handleQueueError } from "../core/polling";
import { streamVideoDownload, type StreamOptions } from "../core/streaming";
import { getModelConfig, withErrorHandling } from "./base-generator";
import {
  isSora2Model,
  getSora2ModelType,
  convertSora2Parameters,
  parseSora2Response,
} from "../models/sora2";
import {
  validateHailuo23Prompt,
  isHailuo23TextToVideo,
  validateLTXV2Resolution,
  validateLTXV2T2VDuration,
  validateLTXV2FastExtendedConstraints,
  isFastLTXV2TextModel,
} from "../validation/validators";
import { ERROR_MESSAGES } from "@/components/editor/media-panel/views/ai/constants/ai-constants";

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
  downloadOptions?: StreamOptions
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "AI Video Generation",
    { operation: "generateVideo", model: request.model },
    async () => {
      const falApiKey = getFalApiKey();
      if (!falApiKey) {
        throw new Error(
          "FAL API key not configured. Please set VITE_FAL_API_KEY in your environment variables."
        );
      }

      console.log(
        `FAL API Key present: ${falApiKey ? "Yes (length: " + falApiKey.length + ")" : "No"}`
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

      console.log(`Generating video with FAL AI: ${endpoint}`);
      console.log(`Prompt: ${request.prompt}`);

      // Build request payload
      const payload = buildTextToVideoPayload(request, modelConfig);

      console.log(`Sending request to ${endpoint} with payload:`, payload);

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

      // Try queue mode first using centralized request helper
      const queueResponse = await makeFalRequest(endpoint, payload, {
        queueMode: true,
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

        const errorMessage = handleQueueError(
          queueResponse,
          errorData,
          endpoint
        );
        throw new Error(errorMessage);
      }

      const queueResult = await queueResponse.json();
      console.log("FAL Response received:", queueResult);

      // Check if we got a request_id (queue mode) or direct result
      const requestId = queueResult.request_id;

      if (requestId) {
        console.log("Queue mode: polling for result...");
        return await pollQueueStatus(requestId, {
          endpoint,
          startTime,
          onProgress,
          jobId,
          modelName: request.model,
          downloadOptions,
        });
      }

      if (queueResult.video && queueResult.video.url) {
        console.log("Direct mode: video ready immediately");

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
          } catch {
            console.warn(
              "Failed to parse as Sora 2 response, using default format"
            );
          }
        }

        // Handle streaming download if requested
        if (downloadOptions?.downloadToMemory) {
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
          video_data: queueResult,
        };
      }

      // Fallback: Try direct API call without queue headers
      console.warn("Queue mode failed, trying direct API call...");

      const directResponse = await makeFalRequest(endpoint, payload);

      if (!directResponse.ok) {
        const errorData = await directResponse.json().catch(() => ({}));
        throw new Error(
          `Both queue and direct modes failed. Status: ${directResponse.status}, Error: ${JSON.stringify(errorData)}`
        );
      }

      const directResult = await directResponse.json();

      if (directResult.video && directResult.video.url) {
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
          } catch {
            console.warn(
              "Failed to parse as Sora 2 response, using default format"
            );
          }
        }

        if (downloadOptions?.downloadToMemory) {
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

      throw new Error(
        "No video URL received from either queue or direct API mode."
      );
    }
  );
}

/**
 * Generates AI video from text prompt using FAL AI's Hailuo 2.3 text-to-video models.
 *
 * @param request - Text prompt, model ID, and generation parameters
 * @returns VideoGenerationResponse with job_id and final video_url
 * @throws Error if FAL_API_KEY missing or model doesn't support text-to-video
 */
export async function generateVideoFromText(
  request: TextToVideoRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate video from text",
    { operation: "generateVideoFromText", model: request.model },
    async () => {
      const falApiKey = getFalApiKey();
      if (!falApiKey) {
        throw new Error("FAL API key not configured");
      }

      const trimmedPrompt = request.prompt.trim();

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
      const payload: Record<string, unknown> = {
        prompt: trimmedPrompt,
        ...(modelConfig.default_params || {}),
      };

      if (request.resolution) {
        payload.resolution = request.resolution;
      }

      if (
        request.model === "hailuo23_standard_t2v" ||
        request.model === "hailuo23_pro_t2v"
      ) {
        const requestedDuration = request.duration ?? 6;
        payload.duration = requestedDuration >= 10 ? "10" : "6";
      }

      if (request.prompt_optimizer !== undefined) {
        payload.prompt_optimizer = request.prompt_optimizer;
      }

      const jobId = generateJobId();

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate video from text");
      }

      const result = await response.json();

      return {
        job_id: jobId,
        status: "completed",
        message: `Video generated successfully from text with ${request.model}`,
        estimated_time: 0,
        video_url: result.video?.url || result.video,
        video_data: result,
      };
    }
  );
}

/**
 * Generate video with audio from text using LTX Video 2.0.
 *
 * @param request - Prompt, model ID, and generation parameters
 */
export async function generateLTXV2Video(
  request: LTXV2T2VRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate LTX Video 2.0 video",
    { operation: "generateLTXV2Video", model: request.model },
    async () => {
      const falApiKey = getFalApiKey();
      if (!falApiKey) {
        throw new Error("FAL API key not configured");
      }

      const trimmedPrompt = request.prompt?.trim() ?? "";
      if (!trimmedPrompt) {
        throw new Error(
          "Please enter a text prompt for LTX Video 2.0 text-to-video generation"
        );
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

      // Validate and use defaults
      const duration =
        request.duration ??
        (modelConfig.default_params?.duration as number) ??
        6;
      const resolution =
        request.resolution ??
        (modelConfig.default_params?.resolution as string) ??
        "1080p";
      const fps =
        request.fps ?? (modelConfig.default_params?.fps as number) ?? 25;
      const generateAudio = request.generate_audio ?? true;

      validateLTXV2Resolution(resolution);
      validateLTXV2T2VDuration(duration, request.model);

      // For Fast T2V, validate extended constraints
      if (isFastLTXV2TextModel(request.model)) {
        validateLTXV2FastExtendedConstraints(
          duration,
          resolution,
          fps,
          ERROR_MESSAGES.LTXV2_FAST_T2V_EXTENDED_DURATION_CONSTRAINT
        );
      }

      const payload: Record<string, unknown> = {
        prompt: trimmedPrompt,
        duration,
        resolution,
        fps,
        generate_audio: generateAudio,
        ...(request.aspect_ratio && { aspect_ratio: request.aspect_ratio }),
      };

      const jobId = generateJobId();

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate LTX Video 2.0 video");
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
    }
  );
}

// ============================================
// Private Helper Functions
// ============================================

/**
 * Builds the payload for text-to-video generation based on model type.
 */
function buildTextToVideoPayload(
  request: VideoGenerationRequest,
  modelConfig: ReturnType<typeof getModelConfig>
): Record<string, unknown> {
  if (!modelConfig) {
    throw new Error(`Unknown model: ${request.model}`);
  }

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
        } as Parameters<typeof convertSora2Parameters>[0],
        modelType
      );

      // Strip the 'type' discriminator before sending to API
      const { type, ...apiPayload } = sora2Payload;
      return apiPayload;
    }
  }

  // Existing models use default payload structure
  const payload: Record<string, unknown> = {
    prompt: request.prompt,
    ...(modelConfig.default_params || {}),
    ...(request.duration && { duration: request.duration }),
    ...(request.resolution && { resolution: request.resolution }),
  };

  // Special handling for specific models
  if (request.model === "hailuo" || request.model === "hailuo_pro") {
    const requestedDuration = (payload.duration as number) || 6;
    payload.duration = requestedDuration >= 10 ? "10" : "6";
    payload.resolution = undefined;
  } else if (request.model === "wan_turbo") {
    const validResolutions = ["480p", "580p", "720p"];
    if (
      payload.resolution &&
      !validResolutions.includes(payload.resolution as string)
    ) {
      payload.resolution = "720p";
    }
  } else if (request.model === "wan_25_preview") {
    const validResolutions = ["720p", "1080p", "1440p"];
    if (
      payload.resolution &&
      !validResolutions.includes(payload.resolution as string)
    ) {
      payload.resolution = "1080p";
    }
  }

  // Validate duration doesn't exceed model's max
  if (
    payload.duration &&
    (payload.duration as number) > modelConfig.max_duration
  ) {
    console.warn(
      `${modelConfig.name}: Duration capped at ${modelConfig.max_duration} seconds`
    );
    payload.duration = modelConfig.max_duration;
  }

  // Kling v2.6 expects duration as string
  if (request.model === "kling_v26_pro_t2v" && payload.duration) {
    payload.duration = String(payload.duration);
  }

  return payload;
}

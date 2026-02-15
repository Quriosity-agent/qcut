/**
 * WAN Image-to-Video Generators
 */

import type {
  VideoGenerationResponse,
  WAN25I2VRequest,
  WAN26I2VRequest,
  WAN26Ref2VideoRequest,
} from "@/components/editor/media-panel/views/ai/types/ai-types";
import { ERROR_MESSAGES } from "@/components/editor/media-panel/views/ai/constants/ai-constants";
import {
  generateJobId,
  getFalApiKeyAsync,
  handleFalResponse,
  makeFalRequest,
} from "../core/fal-request";
import {
  validateWAN25NegativePrompt,
  validateWAN25Prompt,
  validateWAN26AspectRatio,
  validateWAN26Duration,
  validateWAN26NegativePrompt,
  validateWAN26Prompt,
  validateWAN26RefVideoUrl,
  validateWAN26Resolution,
} from "../validation/validators";
import { getModelConfig, withErrorHandling } from "./base-generator";

/**
 * Generate video from image using WAN 2.5 Preview.
 */
export async function generateWAN25ImageVideo(
  request: WAN25I2VRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate WAN 2.5 video",
    { operation: "generateWAN25ImageVideo", model: request.model },
    async () => {
      const falApiKey = await getFalApiKeyAsync();
      if (!falApiKey) {
        throw new Error(
          "FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
        );
      }

      const trimmedPrompt = request.prompt?.trim() ?? "";
      if (!trimmedPrompt) {
        throw new Error("Please enter a prompt describing the desired motion");
      }
      validateWAN25Prompt(trimmedPrompt);

      if (!request.image_url) {
        throw new Error("Image URL is required for WAN 2.5 image-to-video");
      }

      if (request.negative_prompt) {
        validateWAN25NegativePrompt(request.negative_prompt);
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
        (modelConfig.default_params?.duration as number) ??
        5;
      const resolution =
        request.resolution ??
        (modelConfig.default_params?.resolution as string) ??
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

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate WAN 2.5 video");
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

/**
 * Generate video from image using WAN v2.6.
 *
 * Supports 15-second duration, aspect ratio control, and audio sync.
 *
 * @param request - Image URL, prompt, and generation parameters
 * @returns VideoGenerationResponse with job_id and final video_url
 * @throws Error if FAL_API_KEY missing or validation fails
 */
export async function generateWAN26ImageVideo(
  request: WAN26I2VRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate WAN v2.6 video",
    { operation: "generateWAN26ImageVideo", model: request.model },
    async () => {
      const falApiKey = await getFalApiKeyAsync();
      if (!falApiKey) {
        throw new Error(
          "FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
        );
      }

      const trimmedPrompt = request.prompt?.trim() ?? "";
      if (!trimmedPrompt) {
        throw new Error(ERROR_MESSAGES.WAN26_EMPTY_PROMPT);
      }
      validateWAN26Prompt(trimmedPrompt);

      if (!request.image_url) {
        throw new Error(ERROR_MESSAGES.WAN26_I2V_MISSING_IMAGE);
      }

      if (request.negative_prompt) {
        validateWAN26NegativePrompt(request.negative_prompt);
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

      // Apply defaults
      const duration =
        request.duration ??
        (modelConfig.default_params?.duration as number) ??
        5;
      const resolution =
        request.resolution ??
        (modelConfig.default_params?.resolution as string) ??
        "1080p";
      const aspectRatio =
        request.aspect_ratio ??
        (modelConfig.default_params?.aspect_ratio as string) ??
        "16:9";

      // Validate parameters
      validateWAN26Duration(duration);
      validateWAN26Resolution(resolution);
      validateWAN26AspectRatio(aspectRatio);

      const payload: Record<string, unknown> = {
        prompt: trimmedPrompt,
        image_url: request.image_url,
        duration,
        resolution,
        aspect_ratio: aspectRatio,
        enable_prompt_expansion:
          request.enable_prompt_expansion ??
          modelConfig.default_params?.enable_prompt_expansion ??
          true,
        enable_safety_checker: request.enable_safety_checker ?? true,
      };

      // Optional parameters
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

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate WAN v2.6 video");
      }

      const result = await response.json();

      return {
        job_id: jobId,
        status: "completed",
        message: "Video generated successfully with WAN v2.6",
        estimated_time: 0,
        video_url: result.video?.url || result.video || result.url,
        video_data: result,
      };
    }
  );
}

/**
 * Generate video from reference video using WAN v2.6.
 *
 * Uses a reference video to guide the motion/style of the generated video.
 * Similar to image-to-video but takes video input for motion guidance.
 *
 * @param request - Reference video URL, prompt, and generation parameters
 * @returns VideoGenerationResponse with job_id and final video_url
 * @throws Error if FAL_API_KEY missing or validation fails
 */
export async function generateWAN26RefVideo(
  request: WAN26Ref2VideoRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate WAN v2.6 Ref2Video",
    { operation: "generateWAN26RefVideo", model: request.model },
    async () => {
      const falApiKey = await getFalApiKeyAsync();
      if (!falApiKey) {
        throw new Error(
          "FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
        );
      }

      const trimmedPrompt = request.prompt?.trim() ?? "";
      if (!trimmedPrompt) {
        throw new Error(
          "Please enter a prompt for WAN v2.6 reference-to-video generation"
        );
      }
      validateWAN26Prompt(trimmedPrompt);

      // Validate reference video URL
      validateWAN26RefVideoUrl(request.reference_video_url);

      if (request.negative_prompt) {
        validateWAN26NegativePrompt(request.negative_prompt);
      }

      const modelConfig = getModelConfig(request.model);
      if (!modelConfig) {
        throw new Error(`Unknown model: ${request.model}`);
      }

      const endpoint = modelConfig.endpoints.reference_to_video;
      if (!endpoint) {
        throw new Error(
          `Model ${request.model} does not support reference-to-video generation`
        );
      }

      // Apply defaults
      const duration =
        request.duration ??
        (modelConfig.default_params?.duration as number) ??
        5;
      const resolution =
        request.resolution ??
        (modelConfig.default_params?.resolution as string) ??
        "1080p";
      const aspectRatio =
        request.aspect_ratio ??
        (modelConfig.default_params?.aspect_ratio as string) ??
        "16:9";

      // Validate parameters (reuse WAN v2.6 validators)
      validateWAN26Duration(duration);
      validateWAN26Resolution(resolution);
      validateWAN26AspectRatio(aspectRatio);

      const payload: Record<string, unknown> = {
        prompt: trimmedPrompt,
        reference_video_url: request.reference_video_url,
        duration,
        resolution,
        aspect_ratio: aspectRatio,
        enable_prompt_expansion:
          request.enable_prompt_expansion ??
          modelConfig.default_params?.enable_prompt_expansion ??
          true,
        enable_safety_checker: request.enable_safety_checker ?? true,
      };

      // Optional parameters
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

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate WAN v2.6 Ref2Video");
      }

      const result = await response.json();

      return {
        job_id: jobId,
        status: "completed",
        message: "Video generated successfully with WAN v2.6 Ref2Video",
        estimated_time: 0,
        video_url: result.video?.url || result.video || result.url,
        video_data: result,
      };
    }
  );
}

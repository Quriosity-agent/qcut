/**
 * LTX and Seedance Image-to-Video Generators
 */

import type {
  LTXV2I2VRequest,
  SeedanceI2VRequest,
  VideoGenerationResponse,
} from "@/components/editor/media-panel/views/ai/types/ai-types";
import { ERROR_MESSAGES } from "@/components/editor/media-panel/views/ai/constants/ai-constants";
import {
  generateJobId,
  getFalApiKeyAsync,
  handleFalResponse,
  makeFalRequest,
} from "../core/fal-request";
import {
  isStandardLTXV2ImageModel,
  validateLTXV2FastExtendedConstraints,
  validateLTXV2I2VDuration,
  validateLTXV2I2VResolution,
} from "../validation/validators";
import { getModelConfig, withErrorHandling } from "./base-generator";

/**
 * Generate video from image using LTX Video 2.0.
 */
export async function generateLTXV2ImageVideo(
  request: LTXV2I2VRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate LTX Video 2.0 I2V",
    { operation: "generateLTXV2ImageVideo", model: request.model },
    async () => {
      const falApiKey = await getFalApiKeyAsync();
      if (!falApiKey) {
        throw new Error(
          "FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
        );
      }

      const isStandardModel = isStandardLTXV2ImageModel(request.model);
      const trimmedPrompt = request.prompt?.trim() ?? "";
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

      validateLTXV2I2VDuration(duration, request.model);
      validateLTXV2I2VResolution(resolution, request.model);

      // Validate extended constraints for Fast variant
      if (!isStandardLTXV2ImageModel(request.model)) {
        validateLTXV2FastExtendedConstraints(
          duration,
          resolution,
          fps,
          ERROR_MESSAGES.LTXV2_I2V_EXTENDED_DURATION_CONSTRAINT
        );
      }

      const payload: Record<string, unknown> = {
        prompt: trimmedPrompt,
        image_url: request.image_url,
        duration,
        resolution,
        fps,
        generate_audio: generateAudio,
        ...(request.aspect_ratio && { aspect_ratio: request.aspect_ratio }),
      };

      const jobId = generateJobId();

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate LTX Video 2.0 I2V");
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
 * Generate video from image using Seedance models.
 */
export async function generateSeedanceVideo(
  request: SeedanceI2VRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate Seedance video",
    { operation: "generateSeedanceVideo", model: request.model },
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
          "Please enter a prompt describing the desired animation"
        );
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
      const cameraFixed =
        request.camera_fixed ??
        (modelConfig.default_params?.camera_fixed as boolean) ??
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

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate Seedance video");
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

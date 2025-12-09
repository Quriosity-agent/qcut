/**
 * Video Upscale Generators
 *
 * Functions for upscaling videos using various AI models.
 * Includes ByteDance, FlashVSR, and Topaz upscalers.
 */

import { handleAIServiceError } from "@/lib/error-handler";
import type {
  VideoGenerationResponse,
  ByteDanceUpscaleRequest,
  FlashVSRUpscaleRequest,
  TopazUpscaleRequest,
} from "@/components/editor/media-panel/views/ai/types/ai-types";
import {
  getFalApiKey,
  FAL_API_BASE,
  generateJobId,
  handleFalResponse,
} from "../core/fal-request";
import { getModelConfig, withErrorHandling } from "./base-generator";

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
  return withErrorHandling(
    "Upscale video with ByteDance",
    { operation: "upscaleByteDanceVideo" },
    async () => {
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
        await handleFalResponse(response, "Upscale video with ByteDance");
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
    }
  );
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
  return withErrorHandling(
    "Upscale video with FlashVSR",
    { operation: "upscaleFlashVSRVideo" },
    async () => {
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
        await handleFalResponse(response, "Upscale video with FlashVSR");
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
    }
  );
}

/**
 * Upscales a video using the Topaz Video Upscaler.
 *
 * @param request - Parameters including `video_url`, `upscale_factor`, and optional `target_fps` and `h264_output`
 * @returns A VideoGenerationResponse containing the upscaled video's URL and binary data
 * @throws Error with message "Topaz Video Upscale not yet implemented"
 */
export async function upscaleTopazVideo(
  _request: TopazUpscaleRequest
): Promise<VideoGenerationResponse> {
  // TODO: Implement when Topaz API endpoint is available
  throw new Error("Topaz Video Upscale not yet implemented");
}

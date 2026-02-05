/**
 * Image-to-Video Generators
 *
 * Functions for generating videos from images using various AI models.
 */

import { handleAIServiceError } from "@/lib/error-handler";
import type {
  ImageToVideoRequest,
  VideoGenerationResponse,
  ViduQ2I2VRequest,
  ViduQ3I2VRequest,
  LTXV2I2VRequest,
  SeedanceI2VRequest,
  KlingI2VRequest,
  Kling26I2VRequest,
  KlingO1V2VRequest,
  KlingO1Ref2VideoRequest,
  WAN25I2VRequest,
  WAN26I2VRequest,
  WAN26Ref2VideoRequest,
} from "@/components/editor/media-panel/views/ai/types/ai-types";
import type { Sora2Duration } from "@/types/sora2";
import {
  getFalApiKey,
  getFalApiKeyAsync,
  generateJobId,
  makeFalRequest,
  handleFalResponse,
} from "../core/fal-request";
import {
  getModelConfig,
  fileToDataURL,
  withErrorHandling,
} from "./base-generator";
import {
  isSora2Model,
  getSora2ModelType,
  convertSora2Parameters,
  parseSora2Response,
} from "../models/sora2";
import {
  validateViduQ2Prompt,
  validateViduQ2Duration,
  validateViduQ3Prompt,
  validateViduQ3Duration,
  validateViduQ3Resolution,
  validateLTXV2I2VDuration,
  validateLTXV2I2VResolution,
  validateLTXV2FastExtendedConstraints,
  isStandardLTXV2ImageModel,
  validateKlingPrompt,
  validateWAN25Prompt,
  validateWAN25NegativePrompt,
  validateWAN26Prompt,
  validateWAN26NegativePrompt,
  validateWAN26Duration,
  validateWAN26Resolution,
  validateWAN26AspectRatio,
  validateWAN26RefVideoUrl,
} from "../validation/validators";
import { ERROR_MESSAGES } from "@/components/editor/media-panel/views/ai/constants/ai-constants";

/**
 * Generates AI video from a static image using FAL AI's image-to-video models.
 *
 * @param request - Image file, model ID, optional prompt, and generation parameters
 * @returns VideoGenerationResponse with job_id for polling
 * @throws Error if model doesn't support image-to-video or FAL_API_KEY missing
 */
export async function generateVideoFromImage(
  request: ImageToVideoRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate video from image",
    { operation: "generateVideoFromImage", model: request.model },
    async () => {
      const falApiKey = await getFalApiKeyAsync();
      if (!falApiKey) {
        throw new Error(
          "FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
        );
      }

      // Convert image to base64 data URL
      const imageUrl = await fileToDataURL(request.image);

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

      // Build payload based on model type
      let payload: Record<string, unknown>;

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
            } as Parameters<typeof convertSora2Parameters>[0],
            modelType
          );
          const { type, ...apiPayload } = sora2Payload;
          payload = apiPayload;
        } else {
          payload = {
            prompt:
              request.prompt || "Create a cinematic video from this image",
            image_url: imageUrl,
            ...(modelConfig.default_params || {}),
            ...(request.duration && { duration: request.duration }),
            ...(request.resolution && { resolution: request.resolution }),
          };
        }
      } else {
        payload = {
          prompt: request.prompt || "Create a cinematic video from this image",
          image_url: imageUrl,
          ...(modelConfig.default_params || {}),
          ...(request.duration && { duration: request.duration }),
          ...(request.resolution && { resolution: request.resolution }),
        };

        // Model-specific adjustments
        if (request.model === "wan_turbo") {
          payload.resolution =
            request.resolution &&
            ["480p", "580p", "720p"].includes(request.resolution)
              ? request.resolution
              : "720p";
          payload.seed = Math.floor(Math.random() * 1_000_000);
        } else if (request.model === "wan_25_preview") {
          payload.quality = "high";
        } else if (request.model === "seedance_pro") {
          payload.duration = request.duration?.toString() || "5";
        }
      }

      const jobId = generateJobId();

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate video from image");
      }

      const result = await response.json();

      // Parse Sora 2 response if needed
      let videoUrl = result.video?.url || result.video || result.url;
      if (isSora2Model(request.model)) {
        try {
          const parsed = parseSora2Response(
            result,
            (request.duration || 4) as Sora2Duration,
            request.resolution,
            request.aspect_ratio
          );
          videoUrl = parsed.videoUrl;
        } catch {
          // Use default format
        }
      }

      return {
        job_id: jobId,
        status: "completed",
        message: `Video generated successfully with ${request.model}`,
        estimated_time: 0,
        video_url: videoUrl,
        video_data: result,
      };
    }
  );
}

/**
 * Generate video from image using Vidu Q2 Turbo.
 */
export async function generateViduQ2Video(
  request: ViduQ2I2VRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate Vidu Q2 video",
    { operation: "generateViduQ2Video", model: request.model },
    async () => {
      const falApiKey = await getFalApiKeyAsync();
      if (!falApiKey) {
        throw new Error(
          "FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
        );
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
          ? modelConfig.default_params.duration
          : 4;
      const duration = request.duration ?? defaultDuration;
      validateViduQ2Duration(duration);

      // Build payload
      const defaults = { ...(modelConfig.default_params || {}) };
      const { bgm: _bgm, ...defaultsSansBgm } = defaults;

      const payload: Record<string, unknown> = {
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

      const shouldIncludeBgm =
        request.bgm !== undefined &&
        (request.duration ?? defaultDuration) === 4;
      if (shouldIncludeBgm) {
        payload.bgm = request.bgm;
      }

      const jobId = generateJobId();

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate Vidu Q2 video");
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
    }
  );
}

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

/**
 * Generate video from image using Kling v2.5 Turbo Pro.
 */
export async function generateKlingImageVideo(
  request: KlingI2VRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate Kling video",
    { operation: "generateKlingImageVideo", model: request.model },
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
      validateKlingPrompt(trimmedPrompt);

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
        (modelConfig.default_params?.aspect_ratio as string) ??
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

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate Kling video");
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
 * Generate video from image using Kling v2.6 Pro.
 */
export async function generateKling26ImageVideo(
  request: Kling26I2VRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate Kling 2.6 video",
    { operation: "generateKling26ImageVideo", model: request.model },
    async () => {
      const falApiKey = await getFalApiKeyAsync();
      if (!falApiKey) {
        throw new Error(
          "FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
        );
      }

      const trimmedPrompt = request.prompt?.trim() ?? "";
      if (!trimmedPrompt) {
        throw new Error("Please enter a prompt for Kling 2.6 video generation");
      }
      validateKlingPrompt(trimmedPrompt);

      if (!request.image_url) {
        throw new Error(
          "Image is required for Kling 2.6 image-to-video generation"
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

      const duration = request.duration ?? 5;
      const generateAudio = request.generate_audio ?? true;

      const payload: Record<string, unknown> = {
        prompt: trimmedPrompt,
        image_url: request.image_url,
        duration: String(duration),
        generate_audio: generateAudio,
        negative_prompt:
          request.negative_prompt ?? "blur, distort, and low quality",
      };

      const jobId = generateJobId();

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate Kling 2.6 video");
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
 * Generate video from source video using Kling O1.
 */
export async function generateKlingO1Video(
  request: KlingO1V2VRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate Kling O1 video",
    { operation: "generateKlingO1Video", model: request.model },
    async () => {
      const falApiKey = await getFalApiKeyAsync();
      if (!falApiKey) {
        throw new Error(
          "FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
        );
      }

      const trimmedPrompt = request.prompt?.trim() ?? "";
      if (!trimmedPrompt) {
        throw new Error("Please enter a prompt describing the desired output");
      }
      validateKlingPrompt(trimmedPrompt);

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

      // Upload video via Electron IPC if available
      let videoUrl: string;

      if (window.electronAPI?.fal?.uploadVideo) {
        const videoBuffer = await request.sourceVideo.arrayBuffer();
        const uploadResult = await window.electronAPI.fal.uploadVideo(
          new Uint8Array(videoBuffer),
          request.sourceVideo.name,
          falApiKey
        );

        if (!uploadResult.success || !uploadResult.url) {
          throw new Error(
            uploadResult.error || "Failed to upload video to FAL"
          );
        }
        videoUrl = uploadResult.url;
      } else {
        // Fallback to data URL - validate size to avoid memory issues
        // 50MB limit accounts for ~33% base64 overhead (50MB -> ~67MB in memory)
        const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;
        if (request.sourceVideo.size > MAX_VIDEO_SIZE_BYTES) {
          throw new Error(ERROR_MESSAGES.VIDEO_FILE_TOO_LARGE_FOR_FALLBACK);
        }
        videoUrl = await fileToDataURL(request.sourceVideo);
      }

      const payload: Record<string, unknown> = {
        prompt: trimmedPrompt,
        video_url: videoUrl,
        duration: request.duration ?? 5,
        aspect_ratio: request.aspect_ratio ?? "auto",
        keep_audio: request.keep_audio ?? false,
      };

      const jobId = generateJobId();

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate Kling O1 video");
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
 * Generate video from reference images using Kling O1.
 */
export async function generateKlingO1RefVideo(
  request: KlingO1Ref2VideoRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate Kling O1 Ref video",
    { operation: "generateKlingO1RefVideo", model: request.model },
    async () => {
      const falApiKey = await getFalApiKeyAsync();
      if (!falApiKey) {
        throw new Error(
          "FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
        );
      }

      const trimmedPrompt = request.prompt?.trim() ?? "";
      if (!trimmedPrompt) {
        throw new Error("Please enter a prompt");
      }
      validateKlingPrompt(trimmedPrompt);

      if (!request.image_urls || request.image_urls.length === 0) {
        throw new Error("At least one reference image is required");
      }

      if (request.image_urls.length > 7) {
        throw new Error("Maximum 7 reference images allowed");
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

      const payload: Record<string, unknown> = {
        prompt: trimmedPrompt,
        image_urls: request.image_urls,
        duration: request.duration ?? 5,
        aspect_ratio: request.aspect_ratio ?? "16:9",
        cfg_scale: Math.min(Math.max(request.cfg_scale ?? 0.5, 0), 1),
      };

      if (request.negative_prompt) {
        payload.negative_prompt = request.negative_prompt;
      }

      const jobId = generateJobId();

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate Kling O1 Ref video");
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

/**
 * Generate video from image using Vidu Q3.
 *
 * Features: Multi-resolution (360p-1080p), audio generation.
 *
 * @param request - Image URL, prompt, and generation parameters
 * @returns VideoGenerationResponse with job_id and video_url
 * @throws Error if FAL_API_KEY missing or validation fails
 */
export async function generateViduQ3ImageVideo(
  request: ViduQ3I2VRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate Vidu Q3 image-to-video",
    { operation: "generateViduQ3ImageVideo", model: request.model },
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
          "Text prompt is required for Vidu Q3 image-to-video generation"
        );
      }
      validateViduQ3Prompt(trimmedPrompt);

      if (!request.image_url) {
        throw new Error(
          "Image is required for Vidu Q3 image-to-video generation"
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

      // Apply defaults
      const duration = request.duration ?? 5;
      const resolution =
        request.resolution ??
        (modelConfig.default_params?.resolution as string) ??
        "720p";
      const audio = request.audio ?? true;

      // Validate parameters
      validateViduQ3Duration(duration);
      validateViduQ3Resolution(resolution);

      const payload: Record<string, unknown> = {
        prompt: trimmedPrompt,
        image_url: request.image_url,
        duration,
        resolution,
        audio,
      };

      if (request.seed !== undefined) {
        payload.seed = request.seed;
      }

      const jobId = generateJobId();

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate Vidu Q3 image-to-video");
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
    }
  );
}
